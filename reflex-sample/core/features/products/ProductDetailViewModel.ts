import { ViewModel, type Next } from "../../foundation/reflex";
import { attempt, type AppError } from "../../foundation/result";
import { formatMoney, humanize } from "../../foundation/format";
import type { Product, ProductStatus } from "../../services/admin-api";
import type { ScreenContext } from "../../app/context";
import { inventoryLabel } from "./ProductsListViewModel";

export const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;

export interface VariantRow {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  available: number;
  /** A change for this variant is still being saved. */
  saving: boolean;
}

export interface ProductDetailState {
  status: "loading" | "loaded" | "error";
  product: {
    title: string;
    vendor: string;
    productType: string;
    status: ProductStatus;
    statusLabel: string;
    imageUrl: string | null;
    inventory: string;
    location: string;
  } | null;
  variants: VariantRow[];
  savingStatus: boolean;
  toast: string | null;
  error: string | null;
  _productId: string;
  _locationId: string;
  _inventoryItemIds: Record<string, string>;
  /** In-flight inventory saves per variant (optimistic updates). */
  _pending: Record<string, number>;
}

export type ProductDetailAction =
  | { type: "Refresh" }
  | { type: "AdjustInventory"; variantId: string; delta: number }
  | { type: "SetStatus"; status: ProductStatus }
  | { type: "DismissToast" };

type ProductDetailMessage =
  | { type: "ProductLoaded"; product: Product }
  | { type: "ProductFailed"; error: AppError }
  | { type: "InventorySaved"; variantId: string }
  | { type: "InventoryFailed"; variantId: string; delta: number; error: AppError }
  | { type: "StatusSaved"; status: ProductStatus }
  | { type: "StatusFailed"; error: AppError };

const loaded = (s: ProductDetailState) => s.status === "loaded";

export class ProductDetailViewModel extends ViewModel<ProductDetailState, ProductDetailAction, ProductDetailMessage> {
  readonly name = "ProductDetail";

  protected readonly actions = {
    Refresh: { enabled: (s: ProductDetailState) => s.status !== "loading" },
    AdjustInventory: { payload: { variantId: "string" as const, delta: "int" as const }, enabled: loaded },
    SetStatus: {
      payload: { status: { enum: PRODUCT_STATUSES } },
      enabled: (s: ProductDetailState) => loaded(s) && !s.savingStatus,
    },
    DismissToast: { enabled: (s: ProductDetailState) => s.toast !== null },
  };

  constructor(private readonly ctx: ScreenContext, productId: string) {
    super(
      {
        status: "loading",
        product: null,
        variants: [],
        savingStatus: false,
        toast: null,
        error: null,
        _productId: productId,
        _locationId: "",
        _inventoryItemIds: {},
        _pending: {},
      },
      ctx.runtime,
    );
  }

  protected onStart() {
    return [this.#load()];
  }

  #load() {
    const id = this.state._productId;
    return async (): Promise<ProductDetailMessage> => {
      const r = await attempt(() => this.ctx.api.product(id));
      return r.ok ? { type: "ProductLoaded", product: r.value } : { type: "ProductFailed", error: r.error };
    };
  }

  /** Tell the rest of the app (list, dashboard) what this product looks like now. */
  #announce(s: ProductDetailState) {
    return () =>
      this.ctx.events.emit("product.changed", {
        productId: s._productId,
        status: s.product!.status,
        totalInventory: s.variants.reduce((n, v) => n + v.available, 0),
      });
  }

  protected update(
    s: ProductDetailState,
    input: ProductDetailAction | ProductDetailMessage,
  ): Next<ProductDetailState, ProductDetailMessage> {
    switch (input.type) {
      case "Refresh":
        return { state: { ...s, status: s.product ? s.status : "loading", error: null }, effects: [this.#load()] };

      case "ProductLoaded": {
        const p = input.product;
        const { locale } = this.ctx.platform;
        return {
          state: {
            ...s,
            status: "loaded",
            error: null,
            product: {
              title: p.title,
              vendor: p.vendor,
              productType: p.productType,
              status: p.status,
              statusLabel: humanize(p.status),
              imageUrl: p.imageUrl,
              inventory: inventoryLabel(p.totalInventory),
              location: p.locationName,
            },
            variants: p.variants.map((v) => ({
              id: v.id,
              title: v.title,
              sku: v.sku,
              price: formatMoney({ amount: v.price, currencyCode: p.currencyCode }, locale),
              available: v.inventoryQuantity,
              saving: false,
            })),
            _locationId: p.locationId,
            _inventoryItemIds: Object.fromEntries(p.variants.map((v) => [v.id, v.inventoryItemId])),
            _pending: {},
          },
        };
      }

      case "ProductFailed":
        return { state: { ...s, status: s.product ? "loaded" : "error", error: input.error.message } };

      case "AdjustInventory": {
        const variant = s.variants.find((v) => v.id === input.variantId);
        if (!variant) return { state: { ...s, toast: "That variant no longer exists." } };
        if (input.delta === 0) return { state: s };
        if (variant.available + input.delta < 0) {
          return { state: { ...s, toast: "Inventory can’t go below 0." } };
        }
        // Optimistic: show the new number immediately, roll back if the save fails.
        const next = withVariant(s, input.variantId, (v) => ({ ...v, available: v.available + input.delta }), +1);
        const inventoryItemId = s._inventoryItemIds[input.variantId]!;
        const { variantId, delta } = input;
        return {
          state: next,
          effects: [
            async () => {
              const r = await attempt(() =>
                this.ctx.api.adjustInventory({ inventoryItemId, locationId: s._locationId, delta }),
              );
              return r.ok
                ? { type: "InventorySaved", variantId }
                : { type: "InventoryFailed", variantId, delta, error: r.error };
            },
          ],
        };
      }

      case "InventorySaved": {
        const next = withVariant(s, input.variantId, (v) => v, -1);
        return { state: next, effects: [this.#announce(next)] };
      }

      case "InventoryFailed": {
        const next = withVariant(s, input.variantId, (v) => ({ ...v, available: v.available - input.delta }), -1);
        return { state: { ...next, toast: `Couldn’t update inventory. ${input.error.message}` } };
      }

      case "SetStatus": {
        if (s.product?.status === input.status) return { state: s };
        const status = input.status;
        return {
          state: { ...s, savingStatus: true },
          effects: [
            async () => {
              const r = await attempt(() => this.ctx.api.setProductStatus(s._productId, status));
              return r.ok ? { type: "StatusSaved", status } : { type: "StatusFailed", error: r.error };
            },
          ],
        };
      }

      case "StatusSaved": {
        const next: ProductDetailState = {
          ...s,
          savingStatus: false,
          product: { ...s.product!, status: input.status, statusLabel: humanize(input.status) },
          toast: input.status === "ARCHIVED" ? "Product archived" : `Product set to ${humanize(input.status).toLowerCase()}`,
        };
        return { state: next, effects: [this.#announce(next)] };
      }

      case "StatusFailed":
        return { state: { ...s, savingStatus: false, toast: input.error.message } };

      case "DismissToast":
        return { state: { ...s, toast: null } };
    }
  }
}

function withVariant(
  s: ProductDetailState,
  variantId: string,
  change: (v: VariantRow) => VariantRow,
  pendingDelta: number,
): ProductDetailState {
  const pending = { ...s._pending, [variantId]: (s._pending[variantId] ?? 0) + pendingDelta };
  const variants = s.variants.map((v) =>
    v.id === variantId ? { ...change(v), saving: (pending[variantId] ?? 0) > 0 } : v,
  );
  const total = variants.reduce((n, v) => n + v.available, 0);
  return {
    ...s,
    variants,
    _pending: pending,
    product: s.product ? { ...s.product, inventory: inventoryLabel(total) } : null,
  };
}
