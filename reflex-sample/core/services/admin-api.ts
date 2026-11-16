/**
 * Typed wrapper around the Shopify Admin GraphQL API (API version 2025-10).
 *
 * ViewModels never see GraphQL: they call these methods and get domain types.
 * The documents below are real Admin API queries; every operation has a
 * stable `operationName` that fixtures and the mock shop are keyed by.
 */
import type { GraphQLTransport } from "../foundation/platform";
import { NotFoundError, UserErrors } from "../foundation/result";
import type { Money } from "../foundation/format";

// ----------------------------------------------------------------- domain
export type FinancialStatus = "PAID" | "PENDING" | "AUTHORIZED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "VOIDED";
export type FulfillmentStatus = "UNFULFILLED" | "FULFILLED" | "PARTIALLY_FULFILLED" | "IN_PROGRESS" | "ON_HOLD";
export type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

export interface Page<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface ShopOverview {
  shopName: string;
  currencyCode: string;
  todaySales: Money;
  todayOrderCount: number;
  unfulfilledCount: number;
  lowStockCount: number;
}

export interface OrderSummary {
  id: string;
  name: string;
  createdAt: string;
  customerName: string | null;
  total: Money;
  financialStatus: FinancialStatus;
  fulfillmentStatus: FulfillmentStatus;
}

export interface OrderLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: Money;
}

export interface Order extends OrderSummary {
  email: string | null;
  note: string | null;
  shippingAddress: {
    name: string;
    address1: string;
    city: string;
    provinceCode: string | null;
    zip: string;
    countryCodeV2: string;
  } | null;
  lineItems: OrderLineItem[];
  subtotal: Money;
  shipping: Money;
  tax: Money;
  openFulfillmentOrderIds: string[];
  tracking: Array<{ company: string | null; number: string | null }>;
}

export interface ProductSummary {
  id: string;
  title: string;
  status: ProductStatus;
  vendor: string;
  totalInventory: number;
  imageUrl: string | null;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number;
  inventoryItemId: string;
}

export interface Product extends ProductSummary {
  productType: string;
  variants: ProductVariant[];
  locationId: string;
  locationName: string;
  currencyCode: string;
}

// ------------------------------------------------------------ documents
const MONEY = `shopMoney { amount currencyCode }`;

export const Documents = {
  ShopOverview: /* GraphQL */ `
    query ShopOverview($todayQuery: String!) {
      shop { name currencyCode }
      todayOrders: orders(first: 250, query: $todayQuery) { nodes { totalPriceSet { ${MONEY} } } }
      unfulfilled: ordersCount(query: "status:open fulfillment_status:unfulfilled") { count }
      lowStock: productsCount(query: "status:active inventory_total:<5") { count }
    }`,
  OrdersList: /* GraphQL */ `
    query OrdersList($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id name createdAt displayFinancialStatus displayFulfillmentStatus
          totalPriceSet { ${MONEY} }
          customer { displayName }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  OrderDetail: /* GraphQL */ `
    query OrderDetail($id: ID!) {
      order(id: $id) {
        id name createdAt email note displayFinancialStatus displayFulfillmentStatus
        customer { displayName }
        shippingAddress { name address1 city provinceCode zip countryCodeV2 }
        lineItems(first: 50) {
          nodes { id title variantTitle sku quantity originalUnitPriceSet { ${MONEY} } }
        }
        subtotalPriceSet { ${MONEY} }
        totalShippingPriceSet { ${MONEY} }
        totalTaxSet { ${MONEY} }
        totalPriceSet { ${MONEY} }
        fulfillmentOrders(first: 10, query: "status:open") { nodes { id status } }
        fulfillments { trackingInfo { company number } }
      }
    }`,
  FulfillOrder: /* GraphQL */ `
    mutation FulfillOrder($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`,
  ProductsList: /* GraphQL */ `
    query ProductsList($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id title status vendor totalInventory
          featuredMedia { preview { image { url } } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
  ProductDetail: /* GraphQL */ `
    query ProductDetail($id: ID!) {
      product(id: $id) {
        id title status vendor productType totalInventory
        featuredMedia { preview { image { url } } }
        variants(first: 50) {
          nodes { id title sku price inventoryQuantity inventoryItem { id } }
        }
      }
      location { id name }
      shop { currencyCode }
    }`,
  AdjustInventory: /* GraphQL */ `
    mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup { reason changes { name delta } }
        userErrors { field message }
      }
    }`,
  UpdateProductStatus: /* GraphQL */ `
    mutation UpdateProductStatus($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status }
        userErrors { field message }
      }
    }`,
} as const;

export type OperationName = keyof typeof Documents;

// ------------------------------------------------------------ raw shapes
type RawMoney = { shopMoney: Money };
type UserError = { field: string[] | null; message: string };
interface RawOrderSummary {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: FinancialStatus;
  displayFulfillmentStatus: FulfillmentStatus;
  totalPriceSet: RawMoney;
  customer: { displayName: string } | null;
}
interface RawProductSummary {
  id: string;
  title: string;
  status: ProductStatus;
  vendor: string;
  totalInventory: number;
  featuredMedia: { preview: { image: { url: string } | null } } | null;
}

// ------------------------------------------------------------- client
export const PAGE_SIZE = 20;

export class AdminApi {
  constructor(private readonly transport: GraphQLTransport) {}

  private run<T>(operationName: OperationName, variables?: Record<string, unknown>): Promise<T> {
    return this.transport.execute<T>({ operationName, query: Documents[operationName], variables });
  }

  async shopOverview(todayStartISO: string): Promise<ShopOverview> {
    const d = await this.run<{
      shop: { name: string; currencyCode: string };
      todayOrders: { nodes: Array<{ totalPriceSet: RawMoney }> };
      unfulfilled: { count: number };
      lowStock: { count: number };
    }>("ShopOverview", { todayQuery: `created_at:>='${todayStartISO}'` });
    const cents = d.todayOrders.nodes.reduce((a, o) => a + Math.round(Number(o.totalPriceSet.shopMoney.amount) * 100), 0);
    return {
      shopName: d.shop.name,
      currencyCode: d.shop.currencyCode,
      todaySales: { amount: (cents / 100).toFixed(2), currencyCode: d.shop.currencyCode },
      todayOrderCount: d.todayOrders.nodes.length,
      unfulfilledCount: d.unfulfilled.count,
      lowStockCount: d.lowStock.count,
    };
  }

  async orders(opts: { query?: string; after?: string | null }): Promise<Page<OrderSummary>> {
    const d = await this.run<{
      orders: { nodes: RawOrderSummary[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>("OrdersList", { first: PAGE_SIZE, after: opts.after ?? null, query: opts.query || null });
    return {
      items: d.orders.nodes.map(mapOrderSummary),
      hasNextPage: d.orders.pageInfo.hasNextPage,
      endCursor: d.orders.pageInfo.endCursor,
    };
  }

  async order(id: string): Promise<Order> {
    const d = await this.run<{
      order:
        | (RawOrderSummary & {
            email: string | null;
            note: string | null;
            shippingAddress: Order["shippingAddress"];
            lineItems: {
              nodes: Array<{
                id: string;
                title: string;
                variantTitle: string | null;
                sku: string | null;
                quantity: number;
                originalUnitPriceSet: RawMoney;
              }>;
            };
            subtotalPriceSet: RawMoney;
            totalShippingPriceSet: RawMoney;
            totalTaxSet: RawMoney;
            fulfillmentOrders: { nodes: Array<{ id: string; status: string }> };
            fulfillments: Array<{ trackingInfo: Array<{ company: string | null; number: string | null }> }>;
          })
        | null;
    }>("OrderDetail", { id });
    const o = d.order;
    if (!o) throw new NotFoundError("This order no longer exists.");
    return {
      ...mapOrderSummary(o),
      email: o.email,
      note: o.note,
      shippingAddress: o.shippingAddress,
      lineItems: o.lineItems.nodes.map((li) => ({
        id: li.id,
        title: li.title,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        unitPrice: li.originalUnitPriceSet.shopMoney,
      })),
      subtotal: o.subtotalPriceSet.shopMoney,
      shipping: o.totalShippingPriceSet.shopMoney,
      tax: o.totalTaxSet.shopMoney,
      openFulfillmentOrderIds: o.fulfillmentOrders.nodes.map((f) => f.id),
      tracking: o.fulfillments.flatMap((f) => f.trackingInfo),
    };
  }

  async fulfill(input: {
    fulfillmentOrderIds: string[];
    notifyCustomer: boolean;
    trackingNumber: string;
    trackingCompany: string;
  }): Promise<void> {
    const d = await this.run<{ fulfillmentCreate: { userErrors: UserError[] } }>("FulfillOrder", {
      fulfillment: {
        lineItemsByFulfillmentOrder: input.fulfillmentOrderIds.map((fulfillmentOrderId) => ({ fulfillmentOrderId })),
        notifyCustomer: input.notifyCustomer,
        trackingInfo: input.trackingNumber
          ? { number: input.trackingNumber, company: input.trackingCompany }
          : undefined,
      },
    });
    throwIfUserErrors(d.fulfillmentCreate.userErrors);
  }

  async products(opts: { query?: string; after?: string | null }): Promise<Page<ProductSummary>> {
    const d = await this.run<{
      products: { nodes: RawProductSummary[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>("ProductsList", { first: PAGE_SIZE, after: opts.after ?? null, query: opts.query || null });
    return {
      items: d.products.nodes.map(mapProductSummary),
      hasNextPage: d.products.pageInfo.hasNextPage,
      endCursor: d.products.pageInfo.endCursor,
    };
  }

  async product(id: string): Promise<Product> {
    const d = await this.run<{
      product:
        | (RawProductSummary & {
            productType: string;
            variants: {
              nodes: Array<{
                id: string;
                title: string;
                sku: string | null;
                price: string;
                inventoryQuantity: number;
                inventoryItem: { id: string };
              }>;
            };
          })
        | null;
      location: { id: string; name: string };
      shop: { currencyCode: string };
    }>("ProductDetail", { id });
    const p = d.product;
    if (!p) throw new NotFoundError("This product no longer exists.");
    return {
      ...mapProductSummary(p),
      productType: p.productType,
      locationId: d.location.id,
      locationName: d.location.name,
      currencyCode: d.shop.currencyCode,
      variants: p.variants.nodes.map((v) => ({
        id: v.id,
        title: v.title,
        sku: v.sku,
        price: v.price,
        inventoryQuantity: v.inventoryQuantity,
        inventoryItemId: v.inventoryItem.id,
      })),
    };
  }

  async adjustInventory(input: { inventoryItemId: string; locationId: string; delta: number }): Promise<void> {
    const d = await this.run<{ inventoryAdjustQuantities: { userErrors: UserError[] } }>("AdjustInventory", {
      input: {
        reason: "correction",
        name: "available",
        changes: [{ delta: input.delta, inventoryItemId: input.inventoryItemId, locationId: input.locationId }],
      },
    });
    throwIfUserErrors(d.inventoryAdjustQuantities.userErrors);
  }

  async setProductStatus(id: string, status: ProductStatus): Promise<void> {
    const d = await this.run<{ productUpdate: { userErrors: UserError[] } }>("UpdateProductStatus", {
      product: { id, status },
    });
    throwIfUserErrors(d.productUpdate.userErrors);
  }
}

function throwIfUserErrors(errors: UserError[]): void {
  if (errors.length > 0) throw new UserErrors(errors);
}

function mapOrderSummary(o: RawOrderSummary): OrderSummary {
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    customerName: o.customer?.displayName ?? null,
    total: o.totalPriceSet.shopMoney,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
  };
}

function mapProductSummary(p: RawProductSummary): ProductSummary {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    vendor: p.vendor,
    totalInventory: p.totalInventory,
    imageUrl: p.featuredMedia?.preview.image?.url ?? null,
  };
}
