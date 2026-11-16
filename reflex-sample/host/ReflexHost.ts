/**
 * The Reflex host: speaks a line-delimited JSON protocol (NDJSON, v1) so any
 * process - a CLI, a test runner in another language, an AI agent - can drive
 * the app without a screen.
 *
 * Requests (one JSON object per line):
 *   {"id":1,"cmd":"session.create","fixtures":["Orders.browse"],"url":"shop://orders"}
 *   {"id":2,"cmd":"ls","session":"s1"}
 *   {"id":3,"cmd":"do","session":"s1","action":"OpenOrder","payload":{"id":"gid://shopify/Order/1046"}}
 *   {"id":4,"cmd":"tree","session":"s1"}
 *   {"id":5,"cmd":"session.close","session":"s1"}
 *
 * Responses:  {"id":3,"ok":true,"node":{...}}  or  {"id":3,"ok":false,"error":{"code":"ACTION_NOT_AVAILABLE","message":"..."}}
 * Events:     {"event":"ready","protocol":1} | fixture_miss | network_violation | log | crash
 *
 * `do` returns only after every effect it triggered has settled (Runtime.idle),
 * so callers never sleep or poll.
 */
import { AppRoot } from "../core/app/AppRoot";
import type { GraphQLTransport, Platform, LogLevel } from "../core/foundation/platform";

export const PROTOCOL_VERSION = 1;

export type HostEvent =
  | { event: "ready"; protocol: number }
  | { event: "fixture_miss"; session: string; operationName: string; variables: unknown }
  | { event: "network_violation"; session: string; url: string }
  | { event: "log"; session: string; level: LogLevel; message: string }
  | { event: "crash"; session: string; message: string };

export interface SessionOptions {
  fixtures: string[];
  /** Override "now" (ISO). Fixture sessions default to FIXTURE_NOW. */
  now?: string;
  timeZone?: string;
}

/** Each host environment decides where data comes from. */
export interface TransportFactory {
  (opts: SessionOptions, report: { miss(op: string, vars: unknown): void }): GraphQLTransport;
}

/** The frozen moment every fixture was recorded at. */
export const FIXTURE_NOW = "2026-11-16T20:30:00.000Z";
export const SHOP_TIME_ZONE = "America/New_York";

interface Session {
  app: AppRoot;
}

class ProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class ReflexHost {
  #sessions = new Map<string, Session>();
  #seq = 0;

  constructor(
    private readonly makeTransport: TransportFactory,
    private readonly emit: (e: HostEvent) => void,
  ) {
    emit({ event: "ready", protocol: PROTOCOL_VERSION });
  }

  /** Handle one request line; returns one response line. */
  async handle(line: string): Promise<string> {
    let id: unknown = null;
    try {
      const req = JSON.parse(line) as Record<string, unknown>;
      id = req.id ?? null;
      const result = await this.#dispatch(req);
      return JSON.stringify({ id, ok: true, ...result });
    } catch (e) {
      const code = e instanceof ProtocolError ? e.code : ((e as { code?: string }).code ?? "INTERNAL");
      const message = e instanceof SyntaxError ? `Malformed JSON: ${e.message}` : (e as Error).message;
      return JSON.stringify({ id, ok: false, error: { code: e instanceof SyntaxError ? "BAD_REQUEST" : code, message } });
    }
  }

  async #dispatch(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (req.cmd) {
      case "session.create": {
        const name = `s${++this.#seq}`;
        const opts: SessionOptions = {
          fixtures: (req.fixtures as string[] | undefined) ?? [],
          now: req.now as string | undefined,
          timeZone: req.timeZone as string | undefined,
        };
        const transport = this.makeTransport(opts, {
          miss: (operationName, variables) => this.emit({ event: "fixture_miss", session: name, operationName, variables }),
        });
        const fixedNow = opts.now ?? (opts.fixtures.length ? FIXTURE_NOW : undefined);
        const platform: Platform = {
          transport,
          clock: { now: () => (fixedNow ? new Date(fixedNow) : new Date()) },
          logger: { log: (level, message) => this.emit({ event: "log", session: name, level, message }) },
          timeZone: opts.timeZone ?? SHOP_TIME_ZONE,
          locale: "en-US",
        };
        const app = new AppRoot(platform);
        this.#sessions.set(name, { app });
        if (typeof req.url === "string" && !app.open(req.url)) {
          throw new ProtocolError("INVALID_PAYLOAD", `Can't open ${req.url}`);
        }
        await this.#settle(name, app);
        return { session: name, node: app.node() };
      }
      case "ls": {
        const { app } = this.#session(req.session);
        return { node: app.node() };
      }
      case "do": {
        const name = String(req.session);
        const { app } = this.#session(name);
        if (typeof req.action !== "string") throw new ProtocolError("BAD_REQUEST", `"action" is required`);
        app.perform(req.action, req.payload ?? {});
        await this.#settle(name, app);
        return { node: app.node() };
      }
      case "tree": {
        const { app } = this.#session(req.session);
        return { tree: app.tree() };
      }
      case "session.close": {
        this.#session(req.session);
        this.#sessions.delete(String(req.session));
        return {};
      }
      default:
        throw new ProtocolError("BAD_REQUEST", `Unknown cmd ${JSON.stringify(req.cmd)}`);
    }
  }

  async #settle(name: string, app: AppRoot): Promise<void> {
    await app.runtime.idle();
    for (const crash of app.runtime.takeCrashes()) {
      this.emit({ event: "crash", session: name, message: String(crash) });
    }
  }

  #session(id: unknown): Session {
    const s = this.#sessions.get(String(id));
    if (!s) throw new ProtocolError("UNKNOWN_SESSION", `No session ${JSON.stringify(id)}`);
    return s;
  }
}
