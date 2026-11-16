/**
 * AppRoot: the composition root and navigation owner.
 *
 * - Builds every dependency once and injects it into screens.
 * - Owns one StackNavigator per tab (like a native tab bar).
 * - Exposes the *visible* screen as a ReflexNode, adding "lent" actions the
 *   screen doesn't own but the user can still do there: goBack, selectTab,
 *   openURL (camelCase by convention, vs PascalCase for a screen's own actions).
 */
import { describeAction, InvalidPayloadError, ActionNotAvailableError, type ActionDef, type AnyViewModel, type ReflexNode, validatePayload } from "../foundation/reflex";
import { StackNavigator } from "../foundation/navigator";
import { Runtime } from "../foundation/runtime";
import { EventBus } from "../foundation/events";
import type { Platform } from "../foundation/platform";
import { AdminApi } from "../services/admin-api";
import { TABS, ORDER_FILTERS, PRODUCT_FILTERS, type Navigation, type Route, type ScreenContext, type Tab, type OrderFilter, type ProductFilter } from "./context";
import { HomeViewModel } from "../features/home/HomeViewModel";
import { OrdersListViewModel } from "../features/orders/OrdersListViewModel";
import { OrderDetailViewModel } from "../features/orders/OrderDetailViewModel";
import { ProductsListViewModel } from "../features/products/ProductsListViewModel";
import { ProductDetailViewModel } from "../features/products/ProductDetailViewModel";

export interface AppState {
  tab: Tab;
  /** Screen names per tab, bottom -> top. Handy for agents to see "where am I". */
  stacks: Record<Tab, string[]>;
}

type LentState = { tab: Tab; depth: number };
const LENT: Record<string, ActionDef<LentState>> = {
  goBack: { enabled: (s) => s.depth > 1 },
  selectTab: { payload: { tab: { enum: TABS } } },
  openURL: { payload: { url: "string" } },
};

export class AppRoot {
  readonly runtime: Runtime;
  readonly events = new EventBus();
  readonly api: AdminApi;
  #stacks: Record<Tab, StackNavigator>;
  #tab: Tab = "home";
  #listeners = new Set<() => void>();
  #state: AppState;

  constructor(readonly platform: Platform) {
    this.runtime = new Runtime(platform);
    this.api = new AdminApi(platform.transport);
    this.#stacks = { home: new StackNavigator(), orders: new StackNavigator(), products: new StackNavigator() };
    // Tabs are created up front but only *started* (i.e. load data) when first shown.
    this.#stacks.home.push(this.#make("home", { screen: "Home" }));
    this.#seed("orders", { screen: "OrdersList" });
    this.#seed("products", { screen: "ProductsList" });
    this.#state = this.#snapshot();
  }

  // ------------------------------------------------------------ for views
  get state(): AppState {
    return this.#state;
  }
  subscribe = (l: () => void) => {
    this.#listeners.add(l);
    return () => void this.#listeners.delete(l);
  };
  getState = () => this.#state;

  stack(tab: Tab): readonly AnyViewModel[] {
    return this.#stacks[tab].screens;
  }
  get visible(): AnyViewModel {
    return this.#stacks[this.#tab].top;
  }

  selectTab(tab: Tab): void {
    this.#tab = tab;
    this.visible.start(); // idempotent
    this.#changed();
  }

  goBack(): void {
    if (this.#stacks[this.#tab].pop()) this.#changed();
  }

  /** Deep links. Returns false for URLs the app doesn't understand. */
  open(url: string): boolean {
    const routes = parseDeepLink(url);
    if (!routes) {
      this.platform.logger.log("warn", `Unhandled deep link: ${url}`);
      return false;
    }
    const tab = tabFor(routes[0]!);
    this.#tab = tab;
    this.#stacks[tab].reset(routes.map((r) => this.#make(tab, r)));
    this.#changed();
    return true;
  }

  // ------------------------------------------------------- Reflex contract
  /** What `ls` returns: the visible screen + lent actions. */
  node(): ReflexNode {
    const screen = this.visible.node();
    const lentState = { tab: this.#tab, depth: this.#stacks[this.#tab].depth };
    return {
      ...screen,
      actions: [
        ...screen.actions,
        ...Object.entries(LENT).map(([name, def]) => describeAction(name, def, lentState)),
      ],
    };
  }

  /** What `tree` returns: everything, including off-screen tabs. */
  tree(): unknown {
    return {
      name: "App",
      state: this.#state,
      tabs: Object.fromEntries(TABS.map((t) => [t, this.#stacks[t].screens.map((vm) => vm.node())])),
    };
  }

  /** What `do` calls. Screen actions first, then lent ones. */
  perform(name: string, payload: unknown = {}): void {
    if (this.visible.hasAction(name)) return this.visible.dispatch(name, payload);
    const def = LENT[name];
    if (!def) throw new ActionNotAvailableError(`No action "${name}" on ${this.visible.name}`);
    const problem = validatePayload(def.payload ?? {}, payload);
    if (problem) throw new InvalidPayloadError(`${name}: ${problem}`);
    const p = payload as Record<string, string>;
    const lentState = { tab: this.#tab, depth: this.#stacks[this.#tab].depth };
    if (def.enabled && !def.enabled(lentState)) throw new ActionNotAvailableError(`${name} is not available right now`);
    if (name === "goBack") return this.goBack();
    if (name === "selectTab") return this.selectTab(p.tab as Tab);
    if (name === "openURL" && !this.open(p.url!)) throw new InvalidPayloadError(`openURL: can't open ${p.url}`);
  }

  // -------------------------------------------------------------- private
  #seed(tab: Tab, route: Route): void {
    this.#stacks[tab].seed(this.#make(tab, route));
  }

  #navFor(tab: Tab): Navigation {
    return {
      push: (route) => {
        this.#stacks[tab].push(this.#make(tab, route));
        this.#changed();
      },
      goBack: () => {
        if (this.#stacks[tab].pop()) this.#changed();
      },
      open: (url) => void this.open(url),
    };
  }

  #make(tab: Tab, route: Route): AnyViewModel {
    const ctx: ScreenContext = {
      runtime: this.runtime,
      platform: this.platform,
      api: this.api,
      events: this.events,
      nav: this.#navFor(tab),
    };
    switch (route.screen) {
      case "Home":
        return new HomeViewModel(ctx);
      case "OrdersList":
        return new OrdersListViewModel(ctx, route);
      case "OrderDetail":
        return new OrderDetailViewModel(ctx, route.id);
      case "ProductsList":
        return new ProductsListViewModel(ctx, route);
      case "ProductDetail":
        return new ProductDetailViewModel(ctx, route.id);
    }
  }

  #snapshot(): AppState {
    return {
      tab: this.#tab,
      stacks: Object.fromEntries(TABS.map((t) => [t, this.#stacks[t].screens.map((s) => s.name)])) as Record<Tab, string[]>,
    };
  }

  #changed(): void {
    this.#state = this.#snapshot();
    this.#listeners.forEach((l) => l());
  }
}

// ------------------------------------------------------------- deep links
function tabFor(route: Route): Tab {
  if (route.screen === "Home") return "home";
  if (route.screen === "OrdersList" || route.screen === "OrderDetail") return "orders";
  return "products";
}

/**
 * shop://home
 * shop://orders?filter=unfulfilled&q=jane
 * shop://orders/1001                -> [OrdersList, OrderDetail]
 * shop://products?filter=lowStock
 * shop://products/42                -> [ProductsList, ProductDetail]
 */
export function parseDeepLink(url: string): Route[] | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "shop:") return null;
  // For custom schemes the first segment is the host: shop://orders/1001
  const segments = [u.hostname, ...u.pathname.split("/")].filter(Boolean);
  const [section, id] = segments;
  const search = u.searchParams.get("q") ?? undefined;
  if (section === "home" && !id) return [{ screen: "Home" }];
  if (section === "orders") {
    const f = u.searchParams.get("filter") ?? "all";
    if (!(ORDER_FILTERS as readonly string[]).includes(f)) return null;
    const list: Route = { screen: "OrdersList", filter: f as OrderFilter, search };
    if (!id) return [list];
    if (!/^\d+$/.test(id)) return null;
    return [list, { screen: "OrderDetail", id: `gid://shopify/Order/${id}` }];
  }
  if (section === "products") {
    const f = u.searchParams.get("filter") ?? "all";
    if (!(PRODUCT_FILTERS as readonly string[]).includes(f)) return null;
    const list: Route = { screen: "ProductsList", filter: f as ProductFilter, search };
    if (!id) return [list];
    if (!/^\d+$/.test(id)) return null;
    return [list, { screen: "ProductDetail", id: `gid://shopify/Product/${id}` }];
  }
  return null;
}
