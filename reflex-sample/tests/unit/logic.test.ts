import { describe, expect, it } from "vitest";
import { parseDeepLink } from "../../core/app/AppRoot";
import { validateTracking } from "../../core/features/orders/OrderDetailViewModel";
import { validatePayload } from "../../core/foundation/reflex";
import { formatOrderDate, startOfDayISO } from "../../core/foundation/format";
import { parseSearch } from "../../host/mock-shop/MockShop";
import { ShopifyAdminTransport } from "../../host/shopify-transport";
import { GraphQLError, NetworkError } from "../../core/foundation/platform";

describe("deep links", () => {
  it.each([
    ["shop://home", [{ screen: "Home" }]],
    ["shop://orders?filter=unpaid", [{ screen: "OrdersList", filter: "unpaid", search: undefined }]],
    ["shop://orders/1001", [{ screen: "OrdersList", filter: "all", search: undefined }, { screen: "OrderDetail", id: "gid://shopify/Order/1001" }]],
    ["shop://products/42?q=mug", [{ screen: "ProductsList", filter: "all", search: "mug" }, { screen: "ProductDetail", id: "gid://shopify/Product/42" }]],
  ])("%s", (url, routes) => expect(parseDeepLink(url)).toEqual(routes));

  it.each(["https://orders/1", "shop://orders/abc", "shop://orders?filter=shipped", "shop://checkout", "nonsense"])(
    "rejects %s",
    (url) => expect(parseDeepLink(url)).toBeNull(),
  );
});

describe("tracking validation", () => {
  it("accepts empty (fulfil without tracking) and well-formed numbers", () => {
    expect(validateTracking("UPS", "")).toBeNull();
    expect(validateTracking("UPS", "1Z999AA10123456784")).toBeNull();
    expect(validateTracking("USPS", "92748999999999999999")).toBeNull();
    expect(validateTracking("FedEx", "123456789012")).toBeNull();
  });
  it("rejects obvious typos", () => {
    expect(validateTracking("UPS", "1Z999")).toMatch(/UPS/);
    expect(validateTracking("USPS", "ABC")).toMatch(/USPS/);
    expect(validateTracking("Other", "12")).toMatch(/too short/);
  });
});

describe("payload validation", () => {
  const schema = { id: "string", delta: "int", mode: { enum: ["a", "b"] } } as const;
  it("explains what is wrong", () => {
    expect(validatePayload(schema, { id: "x", delta: 1, mode: "a" })).toBeNull();
    expect(validatePayload(schema, { id: "x", delta: 1 })).toBe('missing field "mode"');
    expect(validatePayload(schema, { id: "x", delta: 1.5, mode: "a" })).toBe('"delta" must be an integer');
    expect(validatePayload(schema, { id: "x", delta: 1, mode: "c" })).toBe('"mode" must be one of a, b');
    expect(validatePayload(schema, { id: "x", delta: 1, mode: "a", extra: 1 })).toBe('unexpected field "extra"');
    expect(validatePayload(schema, [])).toBe("payload must be a JSON object");
  });
});

describe("dates are shown in the shop's time zone", () => {
  const now = new Date("2026-11-16T20:30:00Z"); // 3:30 PM in New York
  it("formats relative days", () => {
    expect(formatOrderDate("2026-11-16T05:30:00Z", now, "America/New_York", "en-US")).toBe("Today at 12:30 AM");
    expect(formatOrderDate("2026-11-16T04:30:00Z", now, "America/New_York", "en-US")).toBe("Yesterday at 11:30 PM");
    expect(formatOrderDate("2026-11-02T15:00:00Z", now, "America/New_York", "en-US")).toBe("Nov 2 at 10:00 AM");
  });
  it("computes the start of the shop's day", () => {
    expect(startOfDayISO(now, "America/New_York")).toBe("2026-11-16T05:00:00.000Z");
    expect(startOfDayISO(now, "UTC")).toBe("2026-11-16T00:00:00.000Z");
    expect(startOfDayISO(now, "Asia/Kolkata")).toBe("2026-11-16T18:30:00.000Z");
  });
});

describe("Shopify search syntax (mock shop)", () => {
  it("parses filters, comparisons and free text", () => {
    expect(parseSearch("status:open created_at:>='2026-11-16T05:00:00Z' Jane")).toEqual([
      { key: "status", op: "=", value: "open" },
      { key: "created_at", op: ">=", value: "2026-11-16t05:00:00z" },
      { key: "text", op: "~", value: "jane" },
    ]);
  });
});

describe("ShopifyAdminTransport", () => {
  const req = { operationName: "ShopOverview", query: "query ShopOverview { shop { name } }" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("sends the token and returns data", async () => {
    let seen: RequestInit | undefined;
    const t = new ShopifyAdminTransport({
      shopDomain: "demo.myshopify.com",
      accessToken: "shpat_test",
      fetchImpl: async (_url, init) => ((seen = init), json({ data: { shop: { name: "Demo" } } })),
    });
    await expect(t.execute(req)).resolves.toEqual({ shop: { name: "Demo" } });
    expect(t.endpoint).toBe("https://demo.myshopify.com/admin/api/2025-10/graphql.json");
    expect((seen?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_test");
  });

  it("waits for the bucket to refill when THROTTLED, then retries", async () => {
    const sleeps: number[] = [];
    const responses = [
      json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 102, throttleStatus: { currentlyAvailable: 2, restoreRate: 50 } } },
      }),
      json({ data: { ok: true } }),
    ];
    const t = new ShopifyAdminTransport({
      shopDomain: "demo.myshopify.com",
      accessToken: "x",
      fetchImpl: async () => responses.shift()!,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await expect(t.execute(req)).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([2000]); // (102 - 2) / 50 points per second
  });

  it("maps failures to errors the UI understands", async () => {
    const make = (fetchImpl: typeof fetch) =>
      new ShopifyAdminTransport({ shopDomain: "d", accessToken: "x", fetchImpl, maxRetries: 1, sleep: async () => {} });
    await expect(make(async () => { throw new TypeError("fetch failed"); }).execute(req)).rejects.toBeInstanceOf(NetworkError);
    await expect(make(async () => json({}, 503)).execute(req)).rejects.toBeInstanceOf(NetworkError);
    await expect(make(async () => json({}, 401)).execute(req)).rejects.toBeInstanceOf(GraphQLError);
    await expect(make(async () => json({ errors: [{ message: "Field 'x' doesn't exist" }] })).execute(req)).rejects.toThrow("doesn't exist");
  });
});
