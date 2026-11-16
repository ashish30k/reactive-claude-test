import { useSyncExternalStore } from "react";

interface Observable<S> {
  subscribe(listener: () => void): () => void;
  getState(): S;
}

/** The only glue between core and React: re-render when state changes. */
export function useStore<S>(store: Observable<S>): S {
  return useSyncExternalStore(store.subscribe, store.getState);
}
