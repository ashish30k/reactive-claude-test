import { ViewModel, type Next } from "../../foundation/reflex";
import { attempt, type AppError } from "../../foundation/result";
import { formatMoney, formatOrderDate, humanize } from "../../foundation/format";
import type { OrderSummary, Page } from "../../services/admin-api";
import { ORDER_FILTERS, type OrderFilter, type ScreenContext } from "../../app/context";

export interface OrderRow {
  id: string;
  name: string;
  customer: string;
  total: string;
  date: string;
  payment: string;
  fulfillment: string;
  /** Unfulfilled or unpaid: the admin highlights these. */
  needsAttention: boolean;
}

export interface OrdersListState {
  status: "loading" | "loaded" | "error";
  filter: OrderFilter;
  search: string;
  orders: OrderRow[];
  hasMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  emptyMessage: string | null;
  // internal
  _endCursor: string | null;
  /** Bumped per fresh query so late responses for an old filter are dropped. */
  _requestId: number;
}

export type OrdersListAction =
  | { type: "Refresh" }
  | { type: "SetFilter"; filter: OrderFilter }
  | { type: "Search"; query: string }
  | { type: "LoadMore" }
  | { type: "OpenOrder"; id: string };

type OrdersListMessage =
  | { type: "PageLoaded"; requestId: number; append: boolean; page: Page<OrderSummary> }
  | { type: "PageFailed"; requestId: number; append: boolean; error: AppError }
  | { type: "OrderFulfilled"; orderId: string; fulfillmentStatus: string };

const FILTER_QUERY: Record<OrderFilter, string> = {
  all: "",
  unfulfilled: "status:open fulfillment_status:unfulfilled",
  unpaid: "financial_status:pending",
};

export class OrdersListViewModel extends ViewModel<OrdersListState, OrdersListAction, OrdersListMessage> {
  readonly name = "OrdersList";

  protected readonly actions = {
    Refresh: { enabled: (s: OrdersListState) => s.status !== "loading" && !s.refreshing },
    SetFilter: { payload: { filter: { enum: ORDER_FILTERS } } },
    Search: { payload: { query: "string" as const } },
    LoadMore: { enabled: (s: OrdersListState) => s.hasMore && !s.loadingMore && s.status === "loaded" },
    OpenOrder: {
      payload: { id: "string" as const },
      enabled: (s: OrdersListState) => s.orders.length > 0,
    },
  };

  constructor(private readonly ctx: ScreenContext, initial: { filter?: OrderFilter; search?: string } = {}) {
    super(
      {
        status: "loading",
        filter: initial.filter ?? "all",
        search: initial.search ?? "",
        orders: [],
        hasMore: false,
        loadingMore: false,
        refreshing: false,
        error: null,
        emptyMessage: null,
        _endCursor: null,
        _requestId: 1,
      },
      ctx.runtime,
    );
    this.onDispose(
      ctx.events.on("order.fulfilled", (e) => this.deliver({ type: "OrderFulfilled", ...e })),
    );
  }

  protected onStart() {
    return [this.#fetch(this.state, false)];
  }

  #fetch(s: OrdersListState, append: boolean) {
    const requestId = s._requestId;
    const query = [FILTER_QUERY[s.filter], s.search.trim()].filter(Boolean).join(" ");
    const after = append ? s._endCursor : null;
    return async (): Promise<OrdersListMessage> => {
      const r = await attempt(() => this.ctx.api.orders({ query, after }));
      return r.ok
        ? { type: "PageLoaded", requestId, append, page: r.value }
        : { type: "PageFailed", requestId, append, error: r.error };
    };
  }

  /** Start a brand-new query (filter/search change): reset rows, bump request id. */
  #restart(s: OrdersListState, patch: Partial<OrdersListState>): Next<OrdersListState, OrdersListMessage> {
    const next: OrdersListState = {
      ...s,
      ...patch,
      status: "loading",
      orders: [],
      hasMore: false,
      loadingMore: false,
      refreshing: false,
      error: null,
      emptyMessage: null,
      _endCursor: null,
      _requestId: s._requestId + 1,
    };
    return { state: next, effects: [this.#fetch(next, false)] };
  }

  #row(o: OrderSummary): OrderRow {
    const { clock, timeZone, locale } = this.ctx.platform;
    return {
      id: o.id,
      name: o.name,
      customer: o.customerName ?? "No customer",
      total: formatMoney(o.total, locale),
      date: formatOrderDate(o.createdAt, clock.now(), timeZone, locale),
      payment: humanize(o.financialStatus),
      fulfillment: humanize(o.fulfillmentStatus),
      needsAttention: o.fulfillmentStatus === "UNFULFILLED" || o.financialStatus === "PENDING",
    };
  }

  protected update(
    s: OrdersListState,
    input: OrdersListAction | OrdersListMessage,
  ): Next<OrdersListState, OrdersListMessage> {
    switch (input.type) {
      case "Refresh":
        if (s.status === "error") return this.#restart(s, {});
        // Pull-to-refresh keeps rows visible while reloading page 1.
        return {
          state: { ...s, refreshing: true, _requestId: s._requestId + 1 },
          effects: [this.#fetch({ ...s, _requestId: s._requestId + 1 }, false)],
        };

      case "SetFilter":
        return input.filter === s.filter ? { state: s } : this.#restart(s, { filter: input.filter });

      case "Search":
        return input.query.trim() === s.search ? { state: s } : this.#restart(s, { search: input.query.trim() });

      case "LoadMore":
        return { state: { ...s, loadingMore: true }, effects: [this.#fetch(s, true)] };

      case "OpenOrder":
        return { state: s, effects: [() => this.ctx.nav.push({ screen: "OrderDetail", id: input.id })] };

      case "PageLoaded": {
        if (input.requestId !== s._requestId) return { state: s }; // stale response
        const rows = input.page.items.map((o) => this.#row(o));
        const orders = input.append ? [...s.orders, ...rows] : rows;
        return {
          state: {
            ...s,
            status: "loaded",
            refreshing: false,
            loadingMore: false,
            error: null,
            orders,
            hasMore: input.page.hasNextPage,
            _endCursor: input.page.endCursor,
            emptyMessage: orders.length === 0 ? emptyMessage(s.filter, s.search) : null,
          },
        };
      }

      case "PageFailed":
        if (input.requestId !== s._requestId) return { state: s };
        return {
          state: {
            ...s,
            status: s.status === "loading" ? "error" : s.status,
            refreshing: false,
            loadingMore: false,
            error: input.error.message,
          },
        };

      case "OrderFulfilled": {
        const label = humanize(input.fulfillmentStatus);
        const orders = s.orders
          // In the "unfulfilled" view, a fulfilled order no longer belongs.
          .filter((o) => !(s.filter === "unfulfilled" && o.id === input.orderId))
          .map((o) =>
            o.id === input.orderId ? { ...o, fulfillment: label, needsAttention: o.payment === "Pending" } : o,
          );
        return {
          state: { ...s, orders, emptyMessage: orders.length === 0 ? emptyMessage(s.filter, s.search) : null },
        };
      }
    }
  }
}

function emptyMessage(filter: OrderFilter, search: string): string {
  if (search) return `No orders match “${search}”`;
  if (filter === "unfulfilled") return "All caught up! No orders to fulfill.";
  if (filter === "unpaid") return "No unpaid orders.";
  return "Your orders will show here once customers start buying.";
}
