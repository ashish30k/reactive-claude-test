/**
 * Deterministic seed data for the mock shop: a small home-goods store with
 * realistic orders spread over the last few weeks (several placed "today").
 */
export interface DbVariant { id: string; title: string; sku: string; price: string; qty: number; inventoryItemId: string }
export interface DbProduct { id: string; title: string; vendor: string; productType: string; status: "ACTIVE" | "DRAFT" | "ARCHIVED"; imageUrl: string | null; variants: DbVariant[] }
export interface DbLineItem { id: string; productId: string; title: string; variantTitle: string | null; sku: string; quantity: number; price: string }
export interface DbOrder {
  id: string; number: number; createdAt: string; email: string; customer: string; note: string | null;
  financial: "PAID" | "PENDING" | "REFUNDED"; fulfillment: "UNFULFILLED" | "FULFILLED";
  address: { name: string; address1: string; city: string; provinceCode: string; zip: string; countryCodeV2: string };
  lineItems: DbLineItem[]; shipping: string; fulfillmentOrderId: string; fulfillmentOrderOpen: boolean;
  tracking: Array<{ company: string | null; number: string | null }>;
}
export interface Db { shop: { name: string; currencyCode: string }; location: { id: string; name: string }; products: DbProduct[]; orders: DbOrder[] }

/** mulberry32: tiny seeded PRNG so every run produces the same shop. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATALOG: Array<[string, string, string, Array<[string, string, number]>, DbProduct["status"]?]> = [
  ["Linen Throw Pillow", "Maple & Pine", "Home Decor", [["Oat", "29.00", 14], ["Sage", "29.00", 3], ["Charcoal", "29.00", 0]]],
  ["Hand-Poured Soy Candle", "Ember Co.", "Candles", [["Cedar", "24.00", 42], ["Fig", "24.00", 2]]],
  ["Stoneware Mug", "Clayfolk", "Kitchen", [["Speckled White", "18.00", 60], ["Midnight", "18.00", 25]]],
  ["Waffle Bath Towel", "Maple & Pine", "Bath", [["Default Title", "38.00", 31]]],
  ["Walnut Serving Board", "Grain Studio", "Kitchen", [["Small", "45.00", 4], ["Large", "72.00", 1]]],
  ["Wool Blend Blanket", "Northloom", "Home Decor", [["Default Title", "128.00", 9]]],
  ["Ceramic Planter", "Clayfolk", "Garden", [["4 in", "22.00", 18], ["6 in", "34.00", 12]]],
  ["Beeswax Food Wraps (3-pack)", "Hive & Co.", "Kitchen", [["Default Title", "16.00", 75]]],
  ["Glass Carafe", "Clearwater", "Kitchen", [["1 L", "32.00", 2]]],
  ["Cotton Rope Basket", "Maple & Pine", "Storage", [["Medium", "41.00", 20], ["Large", "55.00", 11]]],
  ["Brass Candle Holder", "Ember Co.", "Candles", [["Default Title", "27.00", 0]]],
  ["Recycled Glass Vase", "Clearwater", "Home Decor", [["Amber", "36.00", 16]]],
  ["Organic Cotton Apron", "Northloom", "Kitchen", [["Natural", "34.00", 22], ["Rust", "34.00", 7]]],
  ["Holiday Gift Box", "Maple & Pine", "Gifts", [["Default Title", "89.00", 40]], "DRAFT"],
  ["Pine Needle Incense", "Ember Co.", "Candles", [["Default Title", "12.00", 3]]],
  ["Marble Coaster Set", "Grain Studio", "Kitchen", [["Default Title", "39.00", 26]]],
  ["Woven Placemats (set of 4)", "Northloom", "Kitchen", [["Default Title", "48.00", 13]]],
  ["Summer Citronella Candle", "Ember Co.", "Candles", [["Default Title", "21.00", 0]], "ARCHIVED"],
  ["Enamel Watering Can", "Grain Studio", "Garden", [["Default Title", "58.00", 6]]],
  ["Juniper Hand Soap", "Hive & Co.", "Bath", [["Default Title", "14.00", 88]]],
  ["Bamboo Bath Mat", "Maple & Pine", "Bath", [["Default Title", "46.00", 4]]],
  ["Terracotta Oil Diffuser", "Clayfolk", "Home Decor", [["Default Title", "31.00", 19]]],
];

const PEOPLE: Array<[string, string, string, string, string]> = [
  ["Jane Cooper", "214 Elm St", "Portland", "OR", "97205"],
  ["Marcus Chen", "88 Harbor Ave", "Seattle", "WA", "98101"],
  ["Priya Patel", "1200 Lake Shore Dr", "Chicago", "IL", "60610"],
  ["Diego Alvarez", "45 Mission St", "San Francisco", "CA", "94105"],
  ["Hannah Kim", "9 Beacon St", "Boston", "MA", "02108"],
  ["Tom Whitaker", "301 Congress Ave", "Austin", "TX", "78701"],
  ["Amara Okafor", "77 Peachtree St", "Atlanta", "GA", "30303"],
  ["Lucas Moreau", "500 Pine St", "Denver", "CO", "80202"],
  ["Sofia Rossi", "12 Bleecker St", "New York", "NY", "10012"],
  ["Noah Johnson", "640 Main St", "Nashville", "TN", "37203"],
  ["Emily Davis", "23 Ocean Dr", "Miami", "FL", "33139"],
  ["Ravi Shah", "1800 Wilshire Blvd", "Los Angeles", "CA", "90057"],
];

export function seed(now: Date): Db {
  const rand = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

  let variantSeq = 40000, itemSeq = 50000;
  const products: DbProduct[] = CATALOG.map(([title, vendor, productType, variants, status], i) => ({
    id: `gid://shopify/Product/${8000 + i}`,
    title, vendor, productType,
    status: status ?? "ACTIVE",
    imageUrl: null,
    variants: variants.map(([vt, price, qty]) => {
      const n = ++variantSeq;
      return {
        id: `gid://shopify/ProductVariant/${n}`,
        title: vt, price, qty,
        sku: `${title.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase()}-${(vt === "Default Title" ? "STD" : vt.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase())}`,
        inventoryItemId: `gid://shopify/InventoryItem/${n + 10000}`,
      };
    }),
  }));
  const sellable = products.filter((p) => p.status === "ACTIVE");

  const orders: DbOrder[] = [];
  const COUNT = 46;
  for (let i = 0; i < COUNT; i++) {
    // Newest orders first in time: i=0 is the oldest (~21 days ago), the last 5 are today.
    const hoursAgo = i >= COUNT - 5 ? (COUNT - 1 - i) * 1.5 + 0.25 : (COUNT - i) * 11 + rand() * 6;
    const createdAt = new Date(now.getTime() - hoursAgo * 3_600_000);
    const [name, address1, city, provinceCode, zip] = pick(PEOPLE);
    const lineCount = 1 + Math.floor(rand() * 3);
    const lineItems: DbLineItem[] = [];
    for (let l = 0; l < lineCount; l++) {
      const p = pick(sellable);
      const v = pick(p.variants);
      if (lineItems.some((li) => li.sku === v.sku)) continue;
      lineItems.push({
        id: `gid://shopify/LineItem/${++itemSeq}`, productId: p.id, title: p.title,
        variantTitle: v.title === "Default Title" ? null : v.title, sku: v.sku,
        quantity: 1 + Math.floor(rand() * 2), price: v.price,
      });
    }
    const ageDays = hoursAgo / 24;
    const fulfilled = ageDays > 3 ? rand() < 0.92 : ageDays > 1 ? rand() < 0.4 : false;
    const number = 1001 + i;
    orders.push({
      id: `gid://shopify/Order/${number}`,
      number,
      createdAt: createdAt.toISOString(),
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
      customer: name,
      note: rand() < 0.12 ? "Gift — please don't include the receipt." : null,
      financial: rand() < 0.1 ? "PENDING" : ageDays > 10 && rand() < 0.06 ? "REFUNDED" : "PAID",
      fulfillment: fulfilled ? "FULFILLED" : "UNFULFILLED",
      address: { name, address1, city, provinceCode, zip, countryCodeV2: "US" },
      lineItems,
      shipping: rand() < 0.5 ? "0.00" : "7.99",
      fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${7000 + i}`,
      fulfillmentOrderOpen: !fulfilled,
      tracking: fulfilled ? [{ company: "UPS", number: `1Z999AA1${String(10000000 + number * 7).slice(0, 10)}` }] : [],
    });
  }
  return {
    shop: { name: "Maple & Pine Goods", currencyCode: "USD" },
    location: { id: "gid://shopify/Location/1", name: "Main Warehouse" },
    products,
    orders,
  };
}
