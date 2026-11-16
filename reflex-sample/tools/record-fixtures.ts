/**
 * Records fixtures by running user journeys against a data source and saving
 * every GraphQL response, keyed by operationName.
 *
 *   npm run fixtures:record            # against the deterministic MockShop
 *   npm run fixtures:record -- --live  # against your dev store (SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN)
 *
 * Queries keep their variables (so e.g. page 2 only answers page-2 requests);
 * mutations are recorded without variables (they answer any input).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AppRoot } from "../core/app/AppRoot";
import type { GraphQLRequest, GraphQLTransport } from "../core/foundation/platform";
import { MockShop } from "../host/mock-shop/MockShop";
import { fixturePath } from "../host/fixtures-fs";
import { FIXTURE_NOW, SHOP_TIME_ZONE } from "../host/ReflexHost";
import { liveTransport } from "../host/node-transports";
import type { FixtureEntry, FixtureFile } from "../host/fixture-transport";

type Step = (app: AppRoot) => void;
const doo = (action: string, payload: object = {}): Step => (app) => app.perform(action, payload);
const firstRow = (key: "orders" | "products", where: (r: Record<string, unknown>) => boolean = () => true): Step => (app) => {
  const rows = (app.visible.state as Record<string, Array<Record<string, unknown>>>)[key]!;
  const row = rows.find(where);
  if (!row) throw new Error(`No ${key} row matched`);
  app.perform(key === "orders" ? "OpenOrder" : "OpenProduct", { id: row.id });
};

const JOURNEYS: Record<string, { description: string; url?: string; steps: Step[] }> = {
  "Home.default": {
    description: "Dashboard on launch.",
    steps: [],
  },
  "Orders.browse": {
    description: "Orders tab: all pages, each filter, a search, and the three newest order details.",
    steps: [
      doo("selectTab", { tab: "orders" }),
      doo("LoadMore"),
      doo("LoadMore"),
      firstRow("orders"),
      doo("goBack"),
      doo("SetFilter", { filter: "unfulfilled" }),
      doo("SetFilter", { filter: "unpaid" }),
      doo("SetFilter", { filter: "all" }),
      doo("Search", { query: "jane" }),
      firstRow("orders"),
    ],
  },
  "Orders.fulfill": {
    description: "Fulfill the newest unfulfilled order with UPS tracking; dashboard and lists refresh.",
    steps: [
      doo("openURL", { url: "shop://orders?filter=unfulfilled" }),
      firstRow("orders"),
      doo("StartFulfillment"),
      doo("SetTrackingNumber", { value: "1Z999AA10123456784" }),
      doo("ConfirmFulfillment"),
      doo("selectTab", { tab: "home" }),
      doo("Refresh"),
    ],
  },
  "Products.browse": {
    description: "Products tab: both pages, low-stock filter, and a product detail.",
    steps: [
      doo("selectTab", { tab: "products" }),
      doo("LoadMore"),
      doo("SetFilter", { filter: "lowStock" }),
      firstRow("products", (r) => r.title === "Glass Carafe"),
    ],
  },
  "Products.inventory": {
    description: "Deep link to a product, receive 5 units of a variant, set it to draft, go back to the list.",
    url: "shop://products/8004",
    steps: [
      (app) => {
        const v = (app.visible.state as { variants: Array<{ id: string }> }).variants[1]!;
        app.perform("AdjustInventory", { variantId: v.id, delta: 5 });
      },
      doo("SetStatus", { status: "DRAFT" }),
      doo("goBack"),
    ],
  },
};

const live = process.argv.includes("--live");

class Recorder implements GraphQLTransport {
  log: Array<{ req: GraphQLRequest; data: unknown }> = [];
  constructor(private inner: GraphQLTransport) {}
  async execute<T>(req: GraphQLRequest): Promise<T> {
    const data = await this.inner.execute<T>(req);
    this.log.push({ req, data });
    return data;
  }
}

for (const [name, journey] of Object.entries(JOURNEYS)) {
  const recorder = new Recorder(live ? liveTransport() : new MockShop({ now: new Date(FIXTURE_NOW) }));
  const app = new AppRoot({
    transport: recorder,
    clock: { now: () => new Date(FIXTURE_NOW) },
    logger: { log: () => {} },
    timeZone: SHOP_TIME_ZONE,
    locale: "en-US",
  });
  if (journey.url) app.open(journey.url);
  await app.runtime.idle();
  for (const step of journey.steps) {
    step(app);
    await app.runtime.idle();
  }

  const operations: Record<string, FixtureEntry[]> = {};
  for (const { req, data } of recorder.log) {
    const isMutation = req.query.trim().startsWith("mutation");
    (operations[req.operationName] ??= []).push(isMutation ? { data } : { variables: req.variables, data });
  }
  const file: FixtureFile = { description: journey.description, operations };
  const path = fixturePath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`recorded ${name.padEnd(20)} ${recorder.log.length} responses -> ${path}`);
}
