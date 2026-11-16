import { describe, expect, it } from "vitest";
import { launch } from "../sdk/reflex";
import type { ProductDetailState, ProductsListState } from "../../core";

describe("Products", () => {
  it("given the products tab, the merchant sees stock levels and can find what is running low", async () => {
    const app = await launch(["Products.browse"]);
    await app.do("selectTab", { tab: "products" });
    await app.do("LoadMore");

    const all = app.state<ProductsListState>();
    expect(all.products).toHaveLength(22);
    expect(all.products.find((p) => p.title === "Brass Candle Holder")).toMatchObject({
      inventory: "Out of stock",
      lowStock: true,
    });

    await app.do("SetFilter", { filter: "lowStock" });
    expect(app.state<ProductsListState>().products.map((p) => p.title)).toEqual([
      "Bamboo Bath Mat",
      "Brass Candle Holder",
      "Glass Carafe",
      "Pine Needle Incense",
    ]);
  });

  it("given a product, receiving stock updates the count immediately and everywhere", async () => {
    const app = await launch(["Products.inventory"], { url: "shop://products/8004" });

    expect(app.screen.name).toBe("ProductDetail");
    const before = app.state<ProductDetailState>();
    expect(before.product).toMatchObject({ title: "Walnut Serving Board", inventory: "5 in stock", location: "Main Warehouse" });
    expect(before.variants.map((v) => [v.title, v.price, v.available])).toEqual([
      ["Small", "$45.00", 4],
      ["Large", "$72.00", 1],
    ]);

    await app.do("AdjustInventory", { variantId: before.variants[1]!.id, delta: 5 });

    const after = app.state<ProductDetailState>();
    expect(after.variants[1]).toMatchObject({ available: 6, saving: false });
    expect(after.product?.inventory).toBe("10 in stock");

    await app.do("SetStatus", { status: "DRAFT" });
    expect(app.state<ProductDetailState>()).toMatchObject({
      product: { status: "DRAFT", statusLabel: "Draft" },
      toast: "Product set to draft",
    });

    // The list behind it was updated through the app event bus.
    await app.do("goBack");
    const row = app.state<ProductsListState>().products.find((p) => p.title === "Walnut Serving Board");
    expect(row).toMatchObject({ status: "Draft", inventory: "10 in stock", lowStock: false });
  });

  it("given the save fails, the optimistic change is rolled back and the merchant is told", async () => {
    const app = await launch(["Products.inventory", "Products.inventorySaveFails"], { url: "shop://products/8004" });
    const variant = app.state<ProductDetailState>().variants[0]!;

    await app.do("AdjustInventory", { variantId: variant.id, delta: 3 });

    const s = app.state<ProductDetailState>();
    expect(s.variants[0]).toMatchObject({ available: 4, saving: false });
    expect(s.toast).toBe("Couldn’t update inventory. You appear to be offline. Check your connection and try again.");

    await app.do("DismissToast");
    expect(app.state<ProductDetailState>().toast).toBeNull();
  });

  it("given low stock, the merchant can't take inventory below zero", async () => {
    const app = await launch(["Products.inventory"], { url: "shop://products/8004" });
    const large = app.state<ProductDetailState>().variants[1]!;

    await app.do("AdjustInventory", { variantId: large.id, delta: -2 });

    expect(app.state<ProductDetailState>().variants[1]?.available).toBe(1);
    expect(app.state<ProductDetailState>().toast).toBe("Inventory can’t go below 0.");
    expect(await app.doExpectingError("AdjustInventory", { variantId: large.id, delta: 1.5 })).toBe("INVALID_PAYLOAD");
  });
});
