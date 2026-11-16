import { GraphQLError, NetworkError } from "./platform";

/** A user-presentable failure. Effects never throw; they return one of these. */
export interface AppError {
  kind: "network" | "graphql" | "userErrors" | "notFound" | "unknown";
  message: string;
}

export class UserErrors extends Error {
  constructor(readonly errors: Array<{ field?: string[] | null; message: string }>) {
    super(errors.map((e) => e.message).join("; "));
  }
}
export class NotFoundError extends Error {}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** Run an async call and turn any failure into a typed, displayable AppError. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

export function toAppError(e: unknown): AppError {
  if (e instanceof NetworkError) {
    return { kind: "network", message: "You appear to be offline. Check your connection and try again." };
  }
  if (e instanceof UserErrors) return { kind: "userErrors", message: e.message };
  if (e instanceof NotFoundError) return { kind: "notFound", message: e.message };
  if (e instanceof GraphQLError) return { kind: "graphql", message: `Shopify returned an error: ${e.message}` };
  return { kind: "unknown", message: "Something went wrong. Please try again." };
}
