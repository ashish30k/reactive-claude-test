/**
 * Reflex foundation: the ViewModel contract.
 *
 * Every screen is a ViewModel with:
 *   - State   : everything the user can SEE (plain, JSON-serialisable data)
 *   - Action  : everything the user can DO (button taps, text input, ...)
 *   - Message : results coming back from async work (network responses, timers)
 *   - update  : (state, action | message) -> { state, effects }
 *
 * `update` is the ONLY place state changes. It is pure: side effects are
 * returned as `effects` and executed by the Runtime, which feeds their result
 * back into `update` as a Message.
 *
 * Because state + actions are plain data, the same ViewModel can be driven by
 * a React view, a terminal CLI, an AI agent, or a behavior test - none of
 * them need to render anything.
 *
 * RULE: nothing under core/ may import UI code (react, react-dom, DOM APIs).
 * tests/unit/architecture.test.ts enforces this.
 */
import type { Runtime } from "./runtime";

// ---------------------------------------------------------------------------
// Payload schema: a tiny, explicit schema language for action inputs.
// It is what agents/CLIs see in `ls`, and what the host validates against.
// ---------------------------------------------------------------------------
export type FieldType = "string" | "int" | "boolean" | { enum: readonly string[] };
export type PayloadSchema = Record<string, FieldType>;

export interface ActionDef<S> {
  /** Input the action takes, if any. */
  payload?: PayloadSchema;
  /** Whether the user can trigger it right now (e.g. a disabled button). */
  enabled?: (state: S) => boolean;
}

/** One action as published in the JSON contract. */
export interface ActionDescriptor {
  name: string;
  enabled: boolean;
  payload?: Record<string, string>;
}

/** The JSON contract for one screen: what `ls` returns. */
export interface ReflexNode {
  name: string;
  state: unknown;
  actions: ActionDescriptor[];
}

export type Effect<M> = () => Promise<M | void> | M | void;

export interface Next<S, M> {
  state: S;
  effects?: Effect<M>[];
}

export class ActionNotAvailableError extends Error {
  readonly code = "ACTION_NOT_AVAILABLE";
}
export class InvalidPayloadError extends Error {
  readonly code = "INVALID_PAYLOAD";
}

type Tagged = { type: string };

export abstract class ViewModel<S, A extends Tagged, M extends Tagged = never> {
  /** Node name, e.g. OrderDetailViewModel -> "OrderDetail". */
  abstract readonly name: string;

  /**
   * Every action, always listed (no conditionals). The mapped type makes the
   * compiler reject a ViewModel that forgets to describe one of its actions.
   */
  protected abstract readonly actions: { [K in A["type"]]: ActionDef<S> };

  protected abstract update(state: S, input: A | M): Next<S, M>;

  /** Effects to run when the screen first appears (initial load, subscriptions). */
  protected onStart(): Effect<M>[] {
    return [];
  }

  #state: S;
  #listeners = new Set<() => void>();
  #cleanups: Array<() => void> = [];
  #started = false;

  constructor(initial: S, protected readonly runtime: Runtime) {
    this.#state = initial;
  }

  get state(): S {
    return this.#state;
  }

  /** For views: subscribe to state changes (works with React's useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  getState = (): S => this.#state;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#runEffects(this.onStart());
  }

  /** Views call this. Nothing else. */
  send(action: A): void {
    const def = this.actions[action.type as A["type"]];
    if (!def) throw new ActionNotAvailableError(`${this.name} has no action ${action.type}`);
    if (def.enabled && !def.enabled(this.#state)) {
      throw new ActionNotAvailableError(`${action.type} is not available right now`);
    }
    this.#apply(action);
  }

  /** Untyped entry point used by the host/CLI: validates, then sends. */
  dispatch(name: string, payload: unknown = {}): void {
    const def = (this.actions as Record<string, ActionDef<S> | undefined>)[name];
    if (!def) throw new ActionNotAvailableError(`${this.name} has no action ${name}`);
    const problem = validatePayload(def.payload ?? {}, payload);
    if (problem) throw new InvalidPayloadError(`${name}: ${problem}`);
    this.send({ type: name, ...(payload as object) } as A);
  }

  hasAction(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.actions, name);
  }

  /** The JSON contract. Override `encodeState` to hide internal-only fields. */
  node(): ReflexNode {
    return {
      name: this.name,
      state: this.encodeState(this.#state),
      actions: Object.entries(this.actions as Record<string, ActionDef<S>>).map(([name, def]) =>
        describeAction(name, def, this.#state),
      ),
    };
  }

  /**
   * By convention, top-level state keys starting with "_" are internal
   * bookkeeping (cursors, request ids, ids the user never sees) and are left
   * out of the contract. Override for anything fancier.
   */
  protected encodeState(state: S): unknown {
    if (state === null || typeof state !== "object") return state;
    return Object.fromEntries(Object.entries(state).filter(([k]) => !k.startsWith("_")));
  }

  /** Register cleanup to run when the screen is popped (event subscriptions...). */
  protected onDispose(fn: () => void): void {
    this.#cleanups.push(fn);
  }

  dispose(): void {
    this.#cleanups.splice(0).forEach((fn) => fn());
    this.#listeners.clear();
  }

  /** Feed a message from outside the update loop (e.g. an app-wide event). */
  protected deliver(message: M): void {
    this.#apply(message);
  }

  #apply(input: A | M): void {
    const next = this.update(this.#state, input);
    if (next.state !== this.#state) {
      this.#state = next.state;
      this.#listeners.forEach((l) => l());
    }
    this.#runEffects(next.effects ?? []);
  }

  #runEffects(effects: Effect<M>[]): void {
    for (const effect of effects) {
      this.runtime.run(async () => {
        const message = await effect();
        if (message) this.#apply(message);
      });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyViewModel = ViewModel<any, any, any>;

export function describeAction<S>(name: string, def: ActionDef<S>, state: S): ActionDescriptor {
  const d: ActionDescriptor = { name, enabled: def.enabled ? def.enabled(state) : true };
  if (def.payload) {
    d.payload = Object.fromEntries(
      Object.entries(def.payload).map(([k, t]) => [k, typeof t === "string" ? t : t.enum.join("|")]),
    );
  }
  return d;
}

export function validatePayload(schema: PayloadSchema, payload: unknown): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return "payload must be a JSON object";
  }
  const p = payload as Record<string, unknown>;
  for (const key of Object.keys(p)) {
    if (!(key in schema)) return `unexpected field "${key}"`;
  }
  for (const [key, type] of Object.entries(schema)) {
    const v = p[key];
    if (v === undefined) return `missing field "${key}"`;
    if (type === "string" && typeof v !== "string") return `"${key}" must be a string`;
    if (type === "boolean" && typeof v !== "boolean") return `"${key}" must be a boolean`;
    if (type === "int" && !Number.isInteger(v)) return `"${key}" must be an integer`;
    if (typeof type === "object" && !type.enum.includes(v as string)) {
      return `"${key}" must be one of ${type.enum.join(", ")}`;
    }
  }
  return null;
}
