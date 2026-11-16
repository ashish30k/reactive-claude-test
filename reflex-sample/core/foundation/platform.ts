/**
 * Ports: everything the core needs from the outside world.
 *
 * The core only ever talks to these interfaces. Each host plugs in its own
 * implementation:
 *   - tests / CLI : FixtureTransport (recorded responses), fixed clock
 *   - web demo    : MockShopTransport (in-memory store with latency)
 *   - production  : ShopifyAdminTransport (real Admin GraphQL API)
 */
export interface GraphQLRequest {
  /** Must match the `query Name` in the document; fixtures are keyed by it. */
  operationName: string;
  query: string;
  variables?: Record<string, unknown>;
}

export interface GraphQLTransport {
  /** Resolves with the response `data`. Rejects with NetworkError or GraphQLError. */
  execute<T>(request: GraphQLRequest): Promise<T>;
}

export class NetworkError extends Error {
  readonly kind = "network";
}
export class GraphQLError extends Error {
  readonly kind = "graphql";
}

export interface Clock {
  now(): Date;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  log(level: LogLevel, message: string): void;
}

export interface Platform {
  transport: GraphQLTransport;
  clock: Clock;
  logger: Logger;
  /** IANA zone used for every date shown to the merchant (the shop's zone). */
  timeZone: string;
  locale: string;
}

export const systemClock: Clock = { now: () => new Date() };
export const consoleLogger: Logger = {
  log: (level, message) => (level === "error" ? console.error : console.log)(`[${level}] ${message}`),
};
