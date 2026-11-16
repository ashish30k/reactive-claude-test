import { describe, expect, it } from "vitest";
import { launch } from "../sdk/reflex";
import type { HomeState, OrderDetailState, OrdersListState } from "../../core";

describe("Orders list", () => {
  it("given the orders tab, the merchant sees newest orders first and can page through all of them", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });

    const first = app.state<OrdersListState>();
    expect(first.orders).toHaveLength(20);
    expect(first.orders[0]).toEqual({
      id: "gid://shopify/Order/1046",
      name: "#1046",
      customer: "Lucas Moreau",
      total: "$81.19",
      date: "Today at 3:15 PM",
      payment: "Paid",
      fulfillment: "Unfulfilled",
      needsAttention: true,
    });
    expect(app.enabled("LoadMore")).toBe(true);

    await app.do("LoadMore");
    await app.do("LoadMore");

    const all = app.state<OrdersListState>();
    expect(all.orders).toHaveLength(46);
    expect(all.orders.at(-1)?.name).toBe("#1001");
    expect(all.hasMore).toBe(false);
    expect(app.enabled("LoadMore")).toBe(false);
  });

  it("given the unfulfilled filter, only orders still to ship are listed", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });

    await app.do("SetFilter", { filter: "unfulfilled" });

    const rows = app.state<OrdersListState>().orders;
    expect(rows.length).toBe(9);
    expect(rows.every((o) => o.fulfillment === "Unfulfilled")).toBe(true);
  });

  it("given a search, matching orders are shown", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });

    await app.do("Search", { query: "  jane " });

    const s = app.state<OrdersListState>();
    expect(s.search).toBe("jane");
    expect(s.orders.length).toBeGreaterThan(0);
    expect(s.orders.every((o) => o.customer === "Jane Cooper")).toBe(true);
  });

  it("given no connection, the merchant sees an error and can retry", async () => {
    const app = await launch(["Home.default", "Orders.offlineThenRecovers"]);
    await app.do("selectTab", { tab: "orders" });

    expect(app.state<OrdersListState>()).toMatchObject({
      status: "error",
      error: "You appear to be offline. Check your connection and try again.",
    });

    await app.do("Refresh");

    const s = app.state<OrdersListState>();
    expect(s.status).toBe("loaded");
    expect(s.orders.map((o) => [o.name, o.customer, o.total])).toEqual([
      ["#2002", "Ada Lovelace", "$64.95"],
      ["#2001", "No customer", "$1,250.00"],
    ]);
  });

  it("given bad input, the host refuses it with a clear error code", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });

    expect(await app.doExpectingError("SetFilter", { filter: "shipped" })).toBe("INVALID_PAYLOAD");
    expect(await app.doExpectingError("SetFilter", {})).toBe("INVALID_PAYLOAD");
    expect(await app.doExpectingError("FulfillEverything")).toBe("ACTION_NOT_AVAILABLE");
  });
});

describe("Order detail", () => {
  it("given an order, the merchant sees items, totals and where it ships", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });

    await app.do("OpenOrder", { id: "gid://shopify/Order/1046" });

    expect(app.screen.name).toBe("OrderDetail");
    const { order } = app.state<OrderDetailState>();
    expect(order).toMatchObject({
      name: "#1046",
      customer: "Lucas Moreau",
      shippingAddress: ["Lucas Moreau", "500 Pine St", "Denver CO 80202", "US"],
      subtotal: "$75.00",
      tax: "$6.19",
      total: "$81.19",
    });
    expect(order?.items.map((i) => `${i.quantity} × ${i.title}`)).toEqual([
      "1 × Recycled Glass Vase",
      "1 × Marble Coaster Set",
    ]);
    expect(app.enabled("goBack")).toBe(true);
    expect(app.enabled("ConfirmFulfillment")).toBe(false);
  });

  it("given an unfulfilled order, the merchant can fulfill it with tracking and the rest of the app updates", async () => {
    const app = await launch(["Orders.fulfill"]);
    await app.do("ViewOrdersToFulfill");
    await app.do("OpenOrder", { id: "gid://shopify/Order/1046" });

    await app.do("StartFulfillment");
    expect(app.state<OrderDetailState>().fulfillSheet).toMatchObject({ carrier: "UPS", notifyCustomer: true });

    // A typo is caught before anything is sent to Shopify.
    await app.do("SetTrackingNumber", { value: "1Z123" });
    await app.do("ConfirmFulfillment");
    expect(app.state<OrderDetailState>().fulfillSheet?.error).toBe(
      "UPS tracking numbers start with 1Z and are 18 characters long.",
    );

    await app.do("SetTrackingNumber", { value: "1z999aa10123456784" });
    await app.do("ConfirmFulfillment");

    const s = app.state<OrderDetailState>();
    expect(s.fulfillSheet).toBeNull();
    expect(s.toast).toBe("#1046 fulfilled");
    expect(s.order?.fulfillment).toBe("Fulfilled");
    expect(s.order?.tracking).toEqual(["UPS · 1Z999AA10123456784"]);
    expect(app.enabled("StartFulfillment")).toBe(false);

    // Back on the "to fulfill" list, the order is gone without a reload.
    await app.do("goBack");
    const list = app.state<OrdersListState>();
    expect(list.orders.map((o) => o.id)).not.toContain("gid://shopify/Order/1046");
    expect(list.orders).toHaveLength(8);

    // And the dashboard count went down.
    await app.do("selectTab", { tab: "home" });
    expect(app.state<HomeState>().ordersToFulfill).toBe(8);
  });

  it("given someone else already fulfilled the order, the merchant sees Shopify's reason and can cancel", async () => {
    const app = await launch(["Orders.fulfill", "Orders.alreadyFulfilled"]);
    await app.do("openURL", { url: "shop://orders/1046" });

    await app.do("StartFulfillment");
    await app.do("ConfirmFulfillment");

    expect(app.state<OrderDetailState>().fulfillSheet).toMatchObject({
      submitting: false,
      error: "Fulfillment order has an unfulfillable status= closed.",
    });
    expect(app.enabled("ConfirmFulfillment")).toBe(true);

    await app.do("CancelFulfillment");
    expect(app.state<OrderDetailState>().fulfillSheet).toBeNull();
  });
});
