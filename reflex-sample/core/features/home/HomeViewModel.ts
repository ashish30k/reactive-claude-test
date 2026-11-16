import { ViewModel, type Next } from "../../foundation/reflex";
import { attempt, type AppError } from "../../foundation/result";
import { formatMoney, startOfDayISO } from "../../foundation/format";
import type { ShopOverview } from "../../services/admin-api";
import type { ScreenContext } from "../../app/context";

export interface HomeState {
  status: "loading" | "loaded" | "error";
  refreshing: boolean;
  shopName: string | null;
  todaySales: string | null;
  todayOrders: number | null;
  ordersToFulfill: number | null;
  lowStockProducts: number | null;
  /** Full-screen error (nothing loaded yet) or banner (stale data shown). */
  error: string | null;
}

export type HomeAction =
  | { type: "Refresh" }
  | { type: "ViewOrdersToFulfill" }
  | { type: "ViewLowStock" };

type HomeMessage =
  | { type: "OverviewLoaded"; overview: ShopOverview }
  | { type: "OverviewFailed"; error: AppError };

export class HomeViewModel extends ViewModel<HomeState, HomeAction, HomeMessage> {
  readonly name = "Home";

  protected readonly actions = {
    Refresh: { enabled: (s: HomeState) => s.status !== "loading" && !s.refreshing },
    ViewOrdersToFulfill: { enabled: (s: HomeState) => (s.ordersToFulfill ?? 0) > 0 },
    ViewLowStock: { enabled: (s: HomeState) => (s.lowStockProducts ?? 0) > 0 },
  };

  constructor(private readonly ctx: ScreenContext) {
    super(
      {
        status: "loading",
        refreshing: false,
        shopName: null,
        todaySales: null,
        todayOrders: null,
        ordersToFulfill: null,
        lowStockProducts: null,
        error: null,
      },
      ctx.runtime,
    );
    // Dashboard counts change when work happens elsewhere in the app.
    this.onDispose(ctx.events.on("order.fulfilled", () => this.#silentRefresh()));
    this.onDispose(ctx.events.on("product.changed", () => this.#silentRefresh()));
  }

  #silentRefresh(): void {
    if (this.state.status === "loaded") this.send({ type: "Refresh" });
  }

  protected onStart() {
    return [this.#load()];
  }

  #load() {
    return async (): Promise<HomeMessage> => {
      const { clock, timeZone } = this.ctx.platform;
      const r = await attempt(() => this.ctx.api.shopOverview(startOfDayISO(clock.now(), timeZone)));
      return r.ok ? { type: "OverviewLoaded", overview: r.value } : { type: "OverviewFailed", error: r.error };
    };
  }

  protected update(s: HomeState, input: HomeAction | HomeMessage): Next<HomeState, HomeMessage> {
    switch (input.type) {
      case "Refresh":
        return s.status === "error"
          ? { state: { ...s, status: "loading", error: null }, effects: [this.#load()] }
          : { state: { ...s, refreshing: true }, effects: [this.#load()] };

      case "OverviewLoaded": {
        const o = input.overview;
        return {
          state: {
            status: "loaded",
            refreshing: false,
            shopName: o.shopName,
            todaySales: formatMoney(o.todaySales, this.ctx.platform.locale),
            todayOrders: o.todayOrderCount,
            ordersToFulfill: o.unfulfilledCount,
            lowStockProducts: o.lowStockCount,
            error: null,
          },
        };
      }

      case "OverviewFailed":
        // Keep showing stale numbers if we have them; only blank the screen on first load.
        return {
          state: { ...s, status: s.status === "loading" ? "error" : s.status, refreshing: false, error: input.error.message },
        };

      case "ViewOrdersToFulfill":
        return { state: s, effects: [() => this.ctx.nav.open("shop://orders?filter=unfulfilled")] };

      case "ViewLowStock":
        return { state: s, effects: [() => this.ctx.nav.open("shop://products?filter=lowStock")] };
    }
  }
}
