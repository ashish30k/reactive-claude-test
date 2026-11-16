import type { Platform } from "./platform";

/**
 * Runs effects and tracks what is in flight.
 *
 * `idle()` resolves once every effect (and every effect those effects
 * triggered) has finished. The host awaits it after each `do`, which is why
 * behavior tests never need sleeps or polling.
 */
export class Runtime {
  #pending = new Set<Promise<void>>();

  constructor(readonly platform: Platform) {}

  run(task: () => Promise<void>): void {
    const p: Promise<void> = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        // Effects are expected to catch their own errors (see `attempt`).
        // Anything reaching here is a programming bug: surface it loudly.
        this.platform.logger.log("error", `Unhandled effect error: ${String(error)}`);
        this.#crashes.push(error);
      })
      .finally(() => this.#pending.delete(p));
    this.#pending.add(p);
  }

  #crashes: unknown[] = [];
  takeCrashes(): unknown[] {
    return this.#crashes.splice(0);
  }

  async idle(): Promise<void> {
    while (this.#pending.size > 0) {
      await Promise.allSettled([...this.#pending]);
    }
  }
}
