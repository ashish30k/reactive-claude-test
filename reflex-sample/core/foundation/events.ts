/**
 * App-wide events, so one screen can react to changes made on another
 * (e.g. the orders list updates a row after the order is fulfilled on the
 * detail screen) without screens knowing about each other.
 */
export interface AppEvents {
  "order.fulfilled": { orderId: string; fulfillmentStatus: string };
  "product.changed": { productId: string; status: string; totalInventory: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  #handlers = new Map<keyof AppEvents, Set<Handler<never>>>();

  on<K extends keyof AppEvents>(event: K, handler: Handler<AppEvents[K]>): () => void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.#handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    this.#handlers.get(event)?.forEach((h) => (h as Handler<AppEvents[K]>)(payload));
  }
}
