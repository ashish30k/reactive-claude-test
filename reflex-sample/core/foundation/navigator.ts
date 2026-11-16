import type { AnyViewModel } from "./reflex";

/**
 * Navigation lives in the core. Views never push screens themselves: they
 * render whatever the navigator's stacks say is on top.
 */
export class StackNavigator {
  #stack: AnyViewModel[] = [];

  get screens(): readonly AnyViewModel[] {
    return this.#stack;
  }
  get top(): AnyViewModel {
    const top = this.#stack[this.#stack.length - 1];
    if (!top) throw new Error("Empty navigation stack");
    return top;
  }
  get depth(): number {
    return this.#stack.length;
  }

  push(vm: AnyViewModel): void {
    this.#stack.push(vm);
    vm.start();
  }

  /** Put a screen on the stack without starting it (lazy tabs). */
  seed(vm: AnyViewModel): void {
    this.#stack.push(vm);
  }

  pop(): boolean {
    if (this.#stack.length <= 1) return false;
    this.#stack.pop()?.dispose();
    this.top.start(); // no-op if it already loaded
    return true;
  }

  /**
   * Replace the whole stack (used by deep links). Only the top screen starts
   * now; screens underneath load when the user goes back to them.
   */
  reset(screens: AnyViewModel[]): void {
    this.#stack.splice(0).forEach((vm) => vm.dispose());
    screens.forEach((vm) => this.seed(vm));
    this.top.start();
  }
}
