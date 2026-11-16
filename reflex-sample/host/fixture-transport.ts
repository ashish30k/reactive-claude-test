/**
 * Replays recorded GraphQL responses. No network, fully deterministic.
 *
 * Fixture file: fixtures/<Domain>/<scenario>.json, referenced as "Domain.scenario".
 *
 *   {
 *     "description": "...",
 *     "operations": {
 *       "OrdersList": [
 *         { "variables": { "query": null }, "data": { ... } },   // optional variable match
 *         { "networkError": "offline" },                        // simulate failure
 *         { "errors": [{ "message": "Throttled" }] }            // top-level GraphQL error
 *       ]
 *     }
 *   }
 *
 * Rules:
 *  - Entries are keyed by operationName (shared by every platform/host).
 *  - When several fixtures are loaded, a LATER fixture's entries for an
 *    operation REPLACE all earlier entries for it (layering scenarios).
 *  - Among entries whose `variables` match the request (subset match; no
 *    `variables` = matches anything), the first unused one is served. When
 *    all matching entries are used, the last one repeats.
 *  - Anything unmatched is a fixture miss: the request fails AND the host
 *    reports a `fixture_miss` event, which fails the test.
 */
import { GraphQLError, NetworkError, type GraphQLRequest, type GraphQLTransport } from "../core/foundation/platform";

export interface FixtureEntry {
  variables?: Record<string, unknown>;
  data?: unknown;
  errors?: Array<{ message: string }>;
  networkError?: string;
}
export interface FixtureFile {
  description?: string;
  operations: Record<string, FixtureEntry[]>;
}

export class FixtureMissError extends Error {}

export class FixtureTransport implements GraphQLTransport {
  #entries = new Map<string, Array<FixtureEntry & { used: boolean }>>();
  readonly calls: GraphQLRequest[] = [];
  onMiss: (operationName: string, variables: unknown) => void = () => {};

  constructor(fixtures: FixtureFile[]) {
    for (const f of fixtures) {
      for (const [op, entries] of Object.entries(f.operations)) {
        this.#entries.set(op, entries.map((e) => ({ ...e, used: false })));
      }
    }
  }

  async execute<T>(req: GraphQLRequest): Promise<T> {
    this.calls.push(req);
    const candidates = (this.#entries.get(req.operationName) ?? []).filter((e) =>
      matches(e.variables, req.variables ?? {}),
    );
    const entry = candidates.find((e) => !e.used) ?? candidates[candidates.length - 1];
    if (!entry) {
      this.onMiss(req.operationName, req.variables);
      throw new FixtureMissError(`No fixture for ${req.operationName} ${JSON.stringify(req.variables ?? {})}`);
    }
    entry.used = true;
    // Yield like a real network call would, so "loading" states are observable.
    await Promise.resolve();
    if (entry.networkError) throw new NetworkError(entry.networkError);
    if (entry.errors?.length) throw new GraphQLError(entry.errors.map((e) => e.message).join("; "));
    return structuredClone(entry.data) as T;
  }
}

function matches(expected: Record<string, unknown> | undefined, actual: Record<string, unknown>): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([k, v]) => JSON.stringify(v ?? null) === JSON.stringify(actual[k] ?? null));
}
