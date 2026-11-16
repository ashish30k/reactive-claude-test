import { describe, expect, it } from "vitest";
import { launch } from "../sdk/reflex";
import type { HomeState } from "../../core";

describe("Home", () => {
  it("given a shop with orders today, the merchant sees today's sales and what needs doing", async () => {
    const app = await launch(["Home.default"]);

    expect(app.screen.name).toBe("Home");
    expect(app.state<HomeState>()).toMatchObject({
      status: "loaded",
      shopName: "Maple & Pine Goods",
      todaySales: "$649.25",
      todayOrders: 5,
      ordersToFulfill: 9,
      lowStockProducts: 4,
    });
    expect(app.enabled("ViewOrdersToFulfill")).toBe(true);
    expect(app.enabled("goBack")).toBe(false);
  });

  it("given a brand-new shop, there is nothing to act on and money uses the shop currency", async () => {
    const app = await launch(["Home.newShop"]);

    expect(app.state<HomeState>().todaySales).toBe("CA$0.00");
    expect(app.enabled("ViewOrdersToFulfill")).toBe(false);
    expect(app.enabled("ViewLowStock")).toBe(false);
    expect(await app.doExpectingError("ViewOrdersToFulfill")).toBe("ACTION_NOT_AVAILABLE");
  });

  it("given orders to fulfill, the merchant can jump straight to them", async () => {
    const app = await launch(["Orders.fulfill"]);

    await app.do("ViewOrdersToFulfill");

    expect(app.screen.name).toBe("OrdersList");
    expect(app.state()).toMatchObject({ filter: "unfulfilled", status: "loaded" });
    expect((await app.tree()).state.tab).toBe("orders");
  });
});
