/**
 * Test SDK: drives the app through the same NDJSON protocol an external
 * agent/CLI would use (requests are serialized to JSON strings and back),
 * so tests exercise the real contract, not internals.
 *
 * Tests can only see what a user sees: the screen name, its state, and its
 * actions. Anything else is an implementation detail.
 */
import { afterEach, expect } from "vitest";
import { ReflexHost, type HostEvent } from "../../host/ReflexHost";
import { transportFactory } from "../../host/node-transports";
import type { ReflexNode } from "../../core";

export interface Screen<S = Record<string, unknown>> extends ReflexNode {
  state: S;
}

const open: ReflexApp[] = [];

export class ReflexApp {
  events: HostEvent[] = [];
  #host: ReflexHost;
  #session = "";
  #id = 0;
  #allowMisses = false;
  screen!: Screen;

  private constructor() {
    this.#host = new ReflexHost(transportFactory("fixtures"), (e) => this.events.push(e));
  }

  static async launch(fixtures: string[], opts: { url?: string } = {}): Promise<ReflexApp> {
    const app = new ReflexApp();
    open.push(app);
    const res = await app.#send({ cmd: "session.create", fixtures, url: opts.url });
    app.#session = res.session as string;
    app.screen = res.node as Screen;
    return app;
  }

  /** Perform an action exactly as a user would; resolves once everything settled. */
  async do(action: string, payload?: Record<string, unknown>): Promise<Screen> {
    const res = await this.#send({ cmd: "do", session: this.#session, action, payload });
    this.screen = res.node as Screen;
    return this.screen;
  }

  /** Like `do`, but expects the host to refuse; returns the error code. */
  async doExpectingError(action: string, payload?: Record<string, unknown>): Promise<string> {
    const raw = await this.#host.handle(JSON.stringify({ id: ++this.#id, cmd: "do", session: this.#session, action, payload }));
    const res = JSON.parse(raw);
    expect(res.ok, `expected ${action} to be refused`).toBe(false);
    return res.error.code;
  }

  async tree(): Promise<{ name: string; state: { tab: string; stacks: Record<string, string[]> } }> {
    return (await this.#send({ cmd: "tree", session: this.#session })).tree as never;
  }

  state<S = Record<string, unknown>>(): S {
    return this.screen.state as S;
  }

  enabled(action: string): boolean {
    const a = this.screen.actions.find((x) => x.name === action);
    if (!a) throw new Error(`${this.screen.name} has no action ${action}`);
    return a.enabled;
  }

  /** For tests that deliberately exercise a missing fixture. */
  allowFixtureMisses(): void {
    this.#allowMisses = true;
  }

  verifyClean(): void {
    const bad = this.events.filter(
      (e) => e.event === "crash" || e.event === "network_violation" || (e.event === "fixture_miss" && !this.#allowMisses),
    );
    expect(bad, "unexpected host events").toEqual([]);
  }

  async #send(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    const raw = await this.#host.handle(JSON.stringify({ id: ++this.#id, ...req }));
    const res = JSON.parse(raw);
    if (!res.ok) throw new Error(`${req.cmd} ${req.action ?? ""} failed: ${res.error.code} ${res.error.message}`);
    return res;
  }
}

export const launch = ReflexApp.launch;

// Every test: no fixture misses, no crashes, no real network.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  for (const app of open) app.events.push({ event: "network_violation", session: "*", url: String(input) });
  throw new Error(`Network access is not allowed in tests: ${String(input)}`);
}) as typeof fetch;
void realFetch;

afterEach(() => {
  for (const app of open.splice(0)) app.verifyClean();
});
