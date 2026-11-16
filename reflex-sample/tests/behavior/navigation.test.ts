import { describe, expect, it } from "vitest";
import { launch } from "../sdk/reflex";

describe("Navigation", () => {
  it("given a deep link to an order, the merchant lands on it with the list behind it", async () => {
    const app = await launch(["Home.default", "Orders.browse"], { url: "shop://orders/1046" });

    expect(app.screen.name).toBe("OrderDetail");
    const tree = await app.tree();
    expect(tree.state).toEqual({
      tab: "orders",
      stacks: { home: ["Home"], orders: ["OrdersList", "OrderDetail"], products: ["ProductsList"] },
    });

    await app.do("goBack");
    expect(app.screen.name).toBe("OrdersList");
    expect(app.state()).toMatchObject({ status: "loaded" }); // loaded lazily on the way back
    expect(app.enabled("goBack")).toBe(false);
    expect(await app.doExpectingError("goBack")).toBe("ACTION_NOT_AVAILABLE");
  });

  it("given an unknown link, nothing changes and the caller is told", async () => {
    const app = await launch(["Home.default"]);

    expect(await app.doExpectingError("openURL", { url: "shop://checkout/1" })).toBe("INVALID_PAYLOAD");
    expect(await app.doExpectingError("openURL", { url: "not a url" })).toBe("INVALID_PAYLOAD");
    expect(app.screen.name).toBe("Home");
  });

  it("given tabs that were never opened, they don't load data until the merchant visits them", async () => {
    const app = await launch(["Home.default"]); // no Orders/Products fixtures: any request would be a miss

    const tree = (await app.tree()) as unknown as { tabs: Record<string, Array<{ state: { status: string } }>> };
    expect(tree.tabs.orders?.[0]?.state.status).toBe("loading");
    expect(tree.tabs.products?.[0]?.state.status).toBe("loading");
  });

  it("each tab keeps its own stack, like a native tab bar", async () => {
    const app = await launch(["Orders.browse"]);
    await app.do("selectTab", { tab: "orders" });
    await app.do("OpenOrder", { id: "gid://shopify/Order/1046" });

    await app.do("selectTab", { tab: "home" });
    await app.do("selectTab", { tab: "orders" });

    expect(app.screen.name).toBe("OrderDetail");
  });
});
