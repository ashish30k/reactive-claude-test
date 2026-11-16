import type { Runtime } from "../foundation/runtime";
import type { EventBus } from "../foundation/events";
import type { AdminApi } from "../services/admin-api";
import type { Platform } from "../foundation/platform";

export const TABS = ["home", "orders", "products"] as const;
export type Tab = (typeof TABS)[number];

export const ORDER_FILTERS = ["all", "unfulfilled", "unpaid"] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];

export const PRODUCT_FILTERS = ["all", "active", "draft", "lowStock"] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number];

export type Route =
  | { screen: "Home" }
  | { screen: "OrdersList"; filter?: OrderFilter; search?: string }
  | { screen: "OrderDetail"; id: string }
  | { screen: "ProductsList"; filter?: ProductFilter; search?: string }
  | { screen: "ProductDetail"; id: string };

/** What a screen may ask of navigation. Screens never touch stacks directly. */
export interface Navigation {
  push(route: Route): void;
  goBack(): void;
  /** Deep link, e.g. shop://orders?filter=unfulfilled or shop://products/42 */
  open(url: string): void;
}

/** Dependencies handed to every screen (constructor injection, no globals). */
export interface ScreenContext {
  runtime: Runtime;
  platform: Platform;
  api: AdminApi;
  events: EventBus;
  nav: Navigation;
}
