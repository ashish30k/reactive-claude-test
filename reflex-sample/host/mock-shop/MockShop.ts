/**
 * An in-memory stand-in for the Shopify Admin GraphQL API.
 *
 * It does NOT parse GraphQL: it dispatches on `operationName` and returns
 * data shaped exactly like the real API's response for our documents.
 * It supports Shopify's search syntax subset we use (status:, fulfillment_status:,
 * financial_status:, created_at:>=, inventory_total:<, free text), cursor
 * pagination, and mutations that really change the data.
 *
 * Browser-safe (no Node APIs): the web demo runs it in the page.
 */
import { GraphQLError, NetworkError, type GraphQLRequest, type GraphQLTransport } from "../../core/foundation/platform";
import { seed, type Db, type DbOrder, type DbProduct } from "./seed";

type Vars = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface MockShopOptions {
  now?: Date;
  /** Random latency range in ms, to feel like a real network. */
  latency?: [number, number];
}

export class MockShop implements GraphQLTransport {
  db: Db;
  latency: [number, number];
  /** Simulate airplane mode: every request fails with a NetworkError. */
  offline = false;
  /** Fail just the next request (great for trying retry flows). */
  failNext = false;
  /** Every request, for inspectors and for recording fixtures. */
  readonly log: Array<{ operationName: string; variables?: Vars; response: unknown; at: number; ok: boolean }> = [];
  #listeners = new Set<() => void>();
  /** For inspectors: called after every request. */
  subscribe = (l: () => void) => {
    this.#listeners.add(l);
    return () => void this.#listeners.delete(l);
  };

  constructor(opts: MockShopOptions = {}) {
    this.db = seed(opts.now ?? new Date());
    this.latency = opts.latency ?? [0, 0];
  }

  async execute<T>(req: GraphQLRequest): Promise<T> {
    const [min, max] = this.latency;
    if (max > 0) await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    if (this.offline || this.failNext) {
      this.failNext = false;
      this.log.push({ operationName: req.operationName, variables: req.variables, response: null, at: Date.now(), ok: false });
      this.#listeners.forEach((l) => l());
      throw new NetworkError("The Internet connection appears to be offline.");
    }
    const resolver = (this as unknown as Record<string, ((v: Vars) => unknown) | undefined>)[`op${req.operationName}`];
    if (!resolver) throw new GraphQLError(`MockShop does not implement ${req.operationName}`);
    const data = structuredClone(resolver.call(this, req.variables ?? {}));
    this.log.push({ operationName: req.operationName, variables: req.variables, response: { data }, at: Date.now(), ok: true });
    this.#listeners.forEach((l) => l());
    return data as T;
  }

  // ------------------------------------------------------------ queries
  opShopOverview(v: Vars) {
    const today = this.#orders(v.todayQuery);
    return {
      shop: this.db.shop,
      todayOrders: { nodes: today.map((o) => ({ totalPriceSet: money(total(o)) })) },
      unfulfilled: { count: this.#orders("status:open fulfillment_status:unfulfilled").length },
      lowStock: { count: this.#products("status:active inventory_total:<5").length },
    };
  }

  opOrdersList(v: Vars) {
    const all = this.#orders(v.query).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const { slice, pageInfo } = paginate(all, v.first, v.after);
    return {
      orders: {
        nodes: slice.map((o) => ({
          id: o.id, name: `#${o.number}`, createdAt: o.createdAt,
          displayFinancialStatus: o.financial, displayFulfillmentStatus: o.fulfillment,
          totalPriceSet: money(total(o)), customer: { displayName: o.customer },
        })),
        pageInfo,
      },
    };
  }

  opOrderDetail(v: Vars) {
    const o = this.db.orders.find((x) => x.id === v.id);
    if (!o) return { order: null };
    const sub = subtotal(o);
    return {
      order: {
        id: o.id, name: `#${o.number}`, createdAt: o.createdAt, email: o.email, note: o.note,
        displayFinancialStatus: o.financial, displayFulfillmentStatus: o.fulfillment,
        customer: { displayName: o.customer },
        shippingAddress: o.address,
        lineItems: {
          nodes: o.lineItems.map((li) => ({
            id: li.id, title: li.title, variantTitle: li.variantTitle, sku: li.sku,
            quantity: li.quantity, originalUnitPriceSet: money(li.price),
          })),
        },
        subtotalPriceSet: money(sub), totalShippingPriceSet: money(o.shipping),
        totalTaxSet: money(tax(o)), totalPriceSet: money(total(o)),
        fulfillmentOrders: { nodes: o.fulfillmentOrderOpen ? [{ id: o.fulfillmentOrderId, status: "OPEN" }] : [] },
        fulfillments: o.fulfillment === "FULFILLED" ? [{ trackingInfo: o.tracking }] : [],
      },
    };
  }

  opProductsList(v: Vars) {
    const all = this.#products(v.query).sort((a, b) => a.title.localeCompare(b.title));
    const { slice, pageInfo } = paginate(all, v.first, v.after);
    return { products: { nodes: slice.map(productSummary), pageInfo } };
  }

  opProductDetail(v: Vars) {
    const p = this.db.products.find((x) => x.id === v.id);
    return {
      product: p
        ? {
            ...productSummary(p),
            productType: p.productType,
            variants: {
              nodes: p.variants.map((x) => ({
                id: x.id, title: x.title, sku: x.sku, price: x.price,
                inventoryQuantity: x.qty, inventoryItem: { id: x.inventoryItemId },
              })),
            },
          }
        : null,
      location: this.db.location,
      shop: { currencyCode: this.db.shop.currencyCode },
    };
  }

  // ---------------------------------------------------------- mutations
  opFulfillOrder(v: Vars) {
    const ids: string[] = v.fulfillment.lineItemsByFulfillmentOrder.map((x: { fulfillmentOrderId: string }) => x.fulfillmentOrderId);
    const userErrors: Array<{ field: string[]; message: string }> = [];
    for (const id of ids) {
      const o = this.db.orders.find((x) => x.fulfillmentOrderId === id);
      if (!o) userErrors.push({ field: ["fulfillment"], message: `Fulfillment order ${id} does not exist.` });
      else if (!o.fulfillmentOrderOpen) {
        userErrors.push({ field: ["fulfillment"], message: "Fulfillment order has an unfulfillable status= closed." });
      }
    }
    if (userErrors.length) return { fulfillmentCreate: { fulfillment: null, userErrors } };
    for (const id of ids) {
      const o = this.db.orders.find((x) => x.fulfillmentOrderId === id)!;
      o.fulfillmentOrderOpen = false;
      o.fulfillment = "FULFILLED";
      const t = v.fulfillment.trackingInfo;
      o.tracking = t ? [{ company: t.company ?? null, number: t.number ?? null }] : [];
    }
    return { fulfillmentCreate: { fulfillment: { id: `gid://shopify/Fulfillment/${Date.now()}`, status: "SUCCESS" }, userErrors: [] } };
  }

  opAdjustInventory(v: Vars) {
    const userErrors: Array<{ field: string[]; message: string }> = [];
    for (const c of v.input.changes as Array<{ delta: number; inventoryItemId: string; locationId: string }>) {
      const variant = this.db.products.flatMap((p) => p.variants).find((x) => x.inventoryItemId === c.inventoryItemId);
      if (!variant) userErrors.push({ field: ["input", "changes"], message: "The specified inventory item could not be found." });
      else if (c.locationId !== this.db.location.id) userErrors.push({ field: ["input", "changes"], message: "The specified location could not be found." });
      else variant.qty += c.delta;
    }
    return {
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup: userErrors.length ? null : { reason: v.input.reason, changes: v.input.changes.map((c: { delta: number }) => ({ name: "available", delta: c.delta })) },
        userErrors,
      },
    };
  }

  opUpdateProductStatus(v: Vars) {
    const p = this.db.products.find((x) => x.id === v.product.id);
    if (!p) return { productUpdate: { product: null, userErrors: [{ field: ["id"], message: "Product does not exist" }] } };
    p.status = v.product.status;
    return { productUpdate: { product: { id: p.id, status: p.status }, userErrors: [] } };
  }

  // --------------------------------------------------- search filtering
  #orders(query?: string | null): DbOrder[] {
    const terms = parseSearch(query);
    return this.db.orders.filter((o) =>
      terms.every((t) => {
        switch (t.key) {
          case "status": return t.value === "open" ? o.financial !== "REFUNDED" : true;
          case "fulfillment_status": return o.fulfillment.toLowerCase() === t.value;
          case "financial_status": return o.financial.toLowerCase() === t.value;
          case "created_at": return compare(o.createdAt, t.op, t.value);
          case "text": {
            const hay = `#${o.number} ${o.number} ${o.customer} ${o.email}`.toLowerCase();
            return hay.includes(t.value);
          }
          default: return true;
        }
      }),
    );
  }

  #products(query?: string | null): DbProduct[] {
    const terms = parseSearch(query);
    return this.db.products.filter((p) =>
      terms.every((t) => {
        switch (t.key) {
          case "status": return p.status.toLowerCase() === t.value;
          case "inventory_total": return compare(inventory(p), t.op, Number(t.value));
          case "text": return `${p.title} ${p.vendor} ${p.productType} ${p.variants.map((x) => x.sku).join(" ")}`.toLowerCase().includes(t.value);
          default: return true;
        }
      }),
    );
  }
}

// --------------------------------------------------------------- helpers
type Term = { key: string; op: string; value: string };

/** Parses `status:open created_at:>='2026-11-16T05:00:00Z' jane` */
export function parseSearch(q?: string | null): Term[] {
  if (!q) return [];
  const tokens = q.match(/[^\s']+(?:'[^']*')?/g) ?? [];
  return tokens.map((tok) => {
    const m = tok.match(/^([a-z_]+):(>=|<=|>|<)?'?([^']*)'?$/i);
    return m ? { key: m[1]!.toLowerCase(), op: m[2] ?? "=", value: m[3]!.toLowerCase() } : { key: "text", op: "~", value: tok.toLowerCase() };
  });
}

function compare<T extends string | number>(a: T, op: string, b: T | string): boolean {
  const x = typeof a === "string" ? a.toLowerCase() : a;
  const y = typeof a === "number" ? Number(b) : String(b);
  switch (op) {
    case ">=": return x >= y;
    case "<=": return x <= y;
    case ">": return x > y;
    case "<": return x < y;
    default: return x === y;
  }
}

function paginate<T>(all: T[], first: number, after?: string | null) {
  const start = after ? Number(atob(after)) : 0;
  const slice = all.slice(start, start + first);
  const end = start + slice.length;
  return { slice, pageInfo: { hasNextPage: end < all.length, endCursor: slice.length ? btoa(String(end)) : null } };
}

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const cents = (s: string) => Math.round(Number(s) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);
const subtotal = (o: DbOrder) => fmt(o.lineItems.reduce((n, li) => n + cents(li.price) * li.quantity, 0));
const tax = (o: DbOrder) => fmt(Math.round(cents(subtotal(o)) * 0.0825));
const total = (o: DbOrder) => fmt(cents(subtotal(o)) + cents(tax(o)) + cents(o.shipping));
const inventory = (p: DbProduct) => p.variants.reduce((n, v) => n + v.qty, 0);
const productSummary = (p: DbProduct) => ({
  id: p.id, title: p.title, status: p.status, vendor: p.vendor, totalInventory: inventory(p),
  featuredMedia: p.imageUrl ? { preview: { image: { url: p.imageUrl } } } : null,
});
