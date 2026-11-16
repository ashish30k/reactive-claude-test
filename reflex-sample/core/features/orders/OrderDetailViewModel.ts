import { ViewModel, type Next } from "../../foundation/reflex";
import { attempt, type AppError } from "../../foundation/result";
import { formatMoney, formatOrderDate, humanize, sumMoney } from "../../foundation/format";
import type { Order } from "../../services/admin-api";
import type { ScreenContext } from "../../app/context";

export const CARRIERS = ["UPS", "USPS", "FedEx", "DHL Express", "Canada Post", "Other"] as const;
export type Carrier = (typeof CARRIERS)[number];

export interface OrderView {
  name: string;
  date: string;
  customer: string;
  email: string | null;
  payment: string;
  fulfillment: string;
  note: string | null;
  shippingAddress: string[];
  items: Array<{ title: string; variant: string | null; sku: string | null; quantity: number; unitPrice: string; lineTotal: string }>;
  itemCount: number;
  subtotal: string;
  shipping: string;
  tax: string;
  total: string;
  tracking: string[];
}

export interface FulfillSheet {
  trackingNumber: string;
  carrier: Carrier;
  notifyCustomer: boolean;
  submitting: boolean;
  error: string | null;
}

export interface OrderDetailState {
  status: "loading" | "loaded" | "error";
  order: OrderView | null;
  canFulfill: boolean;
  /** The "Fulfill items" bottom sheet; null when closed. */
  fulfillSheet: FulfillSheet | null;
  toast: string | null;
  error: string | null;
  _orderId: string;
  _fulfillmentOrderIds: string[];
}

export type OrderDetailAction =
  | { type: "Refresh" }
  | { type: "StartFulfillment" }
  | { type: "SetTrackingNumber"; value: string }
  | { type: "SetCarrier"; carrier: Carrier }
  | { type: "SetNotifyCustomer"; value: boolean }
  | { type: "ConfirmFulfillment" }
  | { type: "CancelFulfillment" }
  | { type: "DismissToast" };

type OrderDetailMessage =
  | { type: "OrderLoaded"; order: Order }
  | { type: "OrderFailed"; error: AppError }
  | { type: "FulfillSucceeded" }
  | { type: "FulfillFailed"; error: AppError };

const sheetOpen = (s: OrderDetailState) => s.fulfillSheet !== null && !s.fulfillSheet.submitting;

export class OrderDetailViewModel extends ViewModel<OrderDetailState, OrderDetailAction, OrderDetailMessage> {
  readonly name = "OrderDetail";

  protected readonly actions = {
    Refresh: { enabled: (s: OrderDetailState) => s.status !== "loading" },
    StartFulfillment: { enabled: (s: OrderDetailState) => s.canFulfill && s.fulfillSheet === null },
    SetTrackingNumber: { payload: { value: "string" as const }, enabled: sheetOpen },
    SetCarrier: { payload: { carrier: { enum: CARRIERS } }, enabled: sheetOpen },
    SetNotifyCustomer: { payload: { value: "boolean" as const }, enabled: sheetOpen },
    ConfirmFulfillment: { enabled: sheetOpen },
    CancelFulfillment: { enabled: sheetOpen },
    DismissToast: { enabled: (s: OrderDetailState) => s.toast !== null },
  };

  constructor(private readonly ctx: ScreenContext, orderId: string) {
    super(
      {
        status: "loading",
        order: null,
        canFulfill: false,
        fulfillSheet: null,
        toast: null,
        error: null,
        _orderId: orderId,
        _fulfillmentOrderIds: [],
      },
      ctx.runtime,
    );
  }

  protected onStart() {
    return [this.#load()];
  }

  #load() {
    const id = this.state._orderId;
    return async (): Promise<OrderDetailMessage> => {
      const r = await attempt(() => this.ctx.api.order(id));
      return r.ok ? { type: "OrderLoaded", order: r.value } : { type: "OrderFailed", error: r.error };
    };
  }

  #view(o: Order): OrderView {
    const { clock, timeZone, locale } = this.ctx.platform;
    const a = o.shippingAddress;
    return {
      name: o.name,
      date: formatOrderDate(o.createdAt, clock.now(), timeZone, locale),
      customer: o.customerName ?? "No customer",
      email: o.email,
      payment: humanize(o.financialStatus),
      fulfillment: humanize(o.fulfillmentStatus),
      note: o.note,
      shippingAddress: a
        ? [a.name, a.address1, [a.city, a.provinceCode, a.zip].filter(Boolean).join(" "), a.countryCodeV2]
        : [],
      items: o.lineItems.map((li) => ({
        title: li.title,
        variant: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        unitPrice: formatMoney(li.unitPrice, locale),
        lineTotal: formatMoney(
          sumMoney(Array(li.quantity).fill(li.unitPrice), li.unitPrice.currencyCode),
          locale,
        ),
      })),
      itemCount: o.lineItems.reduce((n, li) => n + li.quantity, 0),
      subtotal: formatMoney(o.subtotal, locale),
      shipping: formatMoney(o.shipping, locale),
      tax: formatMoney(o.tax, locale),
      total: formatMoney(o.total, locale),
      tracking: o.tracking.map((t) => [t.company, t.number].filter(Boolean).join(" · ")),
    };
  }

  protected update(
    s: OrderDetailState,
    input: OrderDetailAction | OrderDetailMessage,
  ): Next<OrderDetailState, OrderDetailMessage> {
    const sheet = s.fulfillSheet;
    switch (input.type) {
      case "Refresh":
        return { state: { ...s, status: s.order ? s.status : "loading", error: null }, effects: [this.#load()] };

      case "OrderLoaded":
        return {
          state: {
            ...s,
            status: "loaded",
            error: null,
            order: this.#view(input.order),
            canFulfill: input.order.openFulfillmentOrderIds.length > 0,
            _fulfillmentOrderIds: input.order.openFulfillmentOrderIds,
          },
        };

      case "OrderFailed":
        return { state: { ...s, status: s.order ? "loaded" : "error", error: input.error.message } };

      case "StartFulfillment":
        return {
          state: {
            ...s,
            fulfillSheet: { trackingNumber: "", carrier: "UPS", notifyCustomer: true, submitting: false, error: null },
          },
        };

      case "SetTrackingNumber":
        return { state: { ...s, fulfillSheet: { ...sheet!, trackingNumber: input.value.toUpperCase().trim(), error: null } } };

      case "SetCarrier":
        return { state: { ...s, fulfillSheet: { ...sheet!, carrier: input.carrier, error: null } } };

      case "SetNotifyCustomer":
        return { state: { ...s, fulfillSheet: { ...sheet!, notifyCustomer: input.value } } };

      case "CancelFulfillment":
        return { state: { ...s, fulfillSheet: null } };

      case "ConfirmFulfillment": {
        const problem = validateTracking(sheet!.carrier, sheet!.trackingNumber);
        if (problem) return { state: { ...s, fulfillSheet: { ...sheet!, error: problem } } };
        const { trackingNumber, carrier, notifyCustomer } = sheet!;
        const fulfillmentOrderIds = s._fulfillmentOrderIds;
        return {
          state: { ...s, fulfillSheet: { ...sheet!, submitting: true, error: null } },
          effects: [
            async () => {
              const r = await attempt(() =>
                this.ctx.api.fulfill({ fulfillmentOrderIds, notifyCustomer, trackingNumber, trackingCompany: carrier }),
              );
              return r.ok ? { type: "FulfillSucceeded" } : { type: "FulfillFailed", error: r.error };
            },
          ],
        };
      }

      case "FulfillSucceeded":
        return {
          state: {
            ...s,
            fulfillSheet: null,
            canFulfill: false,
            // Show the outcome right away; the reload below fills in tracking details.
            order: s.order ? { ...s.order, fulfillment: "Fulfilled" } : null,
            toast: `${s.order?.name ?? "Order"} fulfilled`,
          },
          effects: [
            () => this.ctx.events.emit("order.fulfilled", { orderId: s._orderId, fulfillmentStatus: "FULFILLED" }),
            this.#load(), // pick up tracking info + new status from the server
          ],
        };

      case "FulfillFailed":
        return { state: { ...s, fulfillSheet: { ...sheet!, submitting: false, error: input.error.message } } };

      case "DismissToast":
        return { state: { ...s, toast: null } };
    }
  }
}

/** Catch obvious typos before hitting the network. */
export function validateTracking(carrier: Carrier, number: string): string | null {
  if (!number) return null; // fulfilling without tracking is allowed
  if (carrier === "UPS" && !/^1Z[0-9A-Z]{16}$/.test(number)) {
    return "UPS tracking numbers start with 1Z and are 18 characters long.";
  }
  if (carrier === "USPS" && !/^\d{20,22}$/.test(number)) {
    return "USPS tracking numbers are 20–22 digits.";
  }
  if (number.length < 6) return "Tracking number looks too short.";
  return null;
}
