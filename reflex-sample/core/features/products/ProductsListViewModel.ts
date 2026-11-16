import { ViewModel, type Next } from "../../foundation/reflex";
import { attempt, type AppError } from "../../foundation/result";
import { humanize } from "../../foundation/format";
import type { Page, ProductSummary } from "../../services/admin-api";
import { PRODUCT_FILTERS, type ProductFilter, type ScreenContext } from "../../app/context";

export const LOW_STOCK_THRESHOLD = 5;

export interface ProductRow {
  id: string;
  title: string;
  vendor: string;
  status: string;
  inventory: string;
  lowStock: boolean;
  imageUrl: string | null;
}

export interface ProductsListState {
  status: "loading" | "loaded" | "error";
  filter: ProductFilter;
  search: string;
  products: ProductRow[];
  hasMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  emptyMessage: string | null;
  _endCursor: string | null;
  _requestId: number;
}

export type ProductsListAction =
  | { type: "Refresh" }
  | { type: "SetFilter"; filter: ProductFilter }
  | { type: "Search"; query: string }
  | { type: "LoadMore" }
  | { type: "OpenProduct"; id: string };

type ProductsListMessage =
  | { type: "PageLoaded"; requestId: number; append: boolean; page: Page<ProductSummary> }
  | { type: "PageFailed"; requestId: number; append: boolean; error: AppError }
  | { type: "ProductChanged"; productId: string; status: string; totalInventory: number };

const FILTER_QUERY: Record<ProductFilter, string> = {
  all: "",
  active: "status:active",
  draft: "status:draft",
  lowStock: `status:active inventory_total:<${LOW_STOCK_THRESHOLD}`,
};

export function inventoryLabel(total: number): string {
  if (total <= 0) return "Out of stock";
  return `${total} in stock`;
}

export class ProductsListViewModel extends ViewModel<ProductsListState, ProductsListAction, ProductsListMessage> {
  readonly name = "ProductsList";

  protected readonly actions = {
    Refresh: { enabled: (s: ProductsListState) => s.status !== "loading" && !s.refreshing },
    SetFilter: { payload: { filter: { enum: PRODUCT_FILTERS } } },
    Search: { payload: { query: "string" as const } },
    LoadMore: { enabled: (s: ProductsListState) => s.hasMore && !s.loadingMore && s.status === "loaded" },
    OpenProduct: { payload: { id: "string" as const }, enabled: (s: ProductsListState) => s.products.length > 0 },
  };

  constructor(private readonly ctx: ScreenContext, initial: { filter?: ProductFilter; search?: string } = {}) {
    super(
      {
        status: "loading",
        filter: initial.filter ?? "all",
        search: initial.search ?? "",
        products: [],
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
    this.onDispose(ctx.events.on("product.changed", (e) => this.deliver({ type: "ProductChanged", ...e })));
  }

  protected onStart() {
    return [this.#fetch(this.state, false)];
  }

  #fetch(s: ProductsListState, append: boolean) {
    const requestId = s._requestId;
    const query = [FILTER_QUERY[s.filter], s.search.trim()].filter(Boolean).join(" ");
    const after = append ? s._endCursor : null;
    return async (): Promise<ProductsListMessage> => {
      const r = await attempt(() => this.ctx.api.products({ query, after }));
      return r.ok
        ? { type: "PageLoaded", requestId, append, page: r.value }
        : { type: "PageFailed", requestId, append, error: r.error };
    };
  }

  #restart(s: ProductsListState, patch: Partial<ProductsListState>): Next<ProductsListState, ProductsListMessage> {
    const next: ProductsListState = {
      ...s,
      ...patch,
      status: "loading",
      products: [],
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

  protected update(
    s: ProductsListState,
    input: ProductsListAction | ProductsListMessage,
  ): Next<ProductsListState, ProductsListMessage> {
    switch (input.type) {
      case "Refresh":
        if (s.status === "error") return this.#restart(s, {});
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
      case "OpenProduct":
        return { state: s, effects: [() => this.ctx.nav.push({ screen: "ProductDetail", id: input.id })] };

      case "PageLoaded": {
        if (input.requestId !== s._requestId) return { state: s };
        const rows = input.page.items.map(toRow);
        const products = input.append ? [...s.products, ...rows] : rows;
        return {
          state: {
            ...s,
            status: "loaded",
            refreshing: false,
            loadingMore: false,
            error: null,
            products,
            hasMore: input.page.hasNextPage,
            _endCursor: input.page.endCursor,
            emptyMessage: products.length === 0 ? emptyMessage(s.filter, s.search) : null,
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

      case "ProductChanged":
        return {
          state: {
            ...s,
            products: s.products.map((p) =>
              p.id === input.productId
                ? {
                    ...p,
                    status: humanize(input.status),
                    inventory: inventoryLabel(input.totalInventory),
                    lowStock: input.totalInventory < LOW_STOCK_THRESHOLD,
                  }
                : p,
            ),
          },
        };
    }
  }
}

function toRow(p: ProductSummary): ProductRow {
  return {
    id: p.id,
    title: p.title,
    vendor: p.vendor,
    status: humanize(p.status),
    inventory: inventoryLabel(p.totalInventory),
    lowStock: p.totalInventory < LOW_STOCK_THRESHOLD,
    imageUrl: p.imageUrl,
  };
}

function emptyMessage(filter: ProductFilter, search: string): string {
  if (search) return `No products match “${search}”`;
  if (filter === "lowStock") return "Nothing is running low. Nice!";
  if (filter === "draft") return "No draft products.";
  return "Add your first product to start selling.";
}
