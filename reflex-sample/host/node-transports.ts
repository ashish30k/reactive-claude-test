// Node-side transport selection shared by the CLI, the stdio host and tests.
import type { GraphQLTransport } from "../core/foundation/platform";
import { FixtureTransport } from "./fixture-transport";
import { loadFixture } from "./fixtures-fs";
import { MockShop } from "./mock-shop/MockShop";
import { ShopifyAdminTransport } from "./shopify-transport";
import { FIXTURE_NOW, type TransportFactory } from "./ReflexHost";

export type DataSource = "fixtures" | "mock" | "live";

export function transportFactory(source: DataSource): TransportFactory {
  return (opts, report) => {
    if (source === "live") return liveTransport();
    if (source === "mock") return new MockShop({ now: new Date(opts.now ?? Date.now()) });
    const t = new FixtureTransport(opts.fixtures.map(loadFixture));
    t.onMiss = report.miss;
    return t;
  };
}

export function liveTransport(): GraphQLTransport {
  const shopDomain = process.env.SHOPIFY_SHOP;
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shopDomain || !accessToken) {
    throw new Error("Set SHOPIFY_SHOP (my-store.myshopify.com) and SHOPIFY_ADMIN_TOKEN (shpat_...) for --live");
  }
  return new ShopifyAdminTransport({ shopDomain, accessToken });
}

export { FIXTURE_NOW };
