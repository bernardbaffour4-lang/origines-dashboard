/**
 * Fills the database with sample products and ~60 days of orders so you can
 * see the dashboard working before connecting eBay/Wix.
 *   npm run db:seed
 * Remove it again with:  npm run db:seed -- --clear
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { upsertOrder } from "../src/lib/sync/upsert-order";
import type { OrderStatus } from "../src/db/schema";

const PRODUCTS = [
  { sku: "OP-BMW-F30-HL-L-LED", title: "BMW 3 Series F30 LCI Full LED Headlight Left", brand: "BMW", oem: "63117419629", price: 649 },
  { sku: "OP-BMW-G20-HL-R-LED", title: "BMW 3 Series G20 LED Headlight Right", brand: "BMW", oem: "63119481700", price: 899 },
  { sku: "OP-BMW-F10-HL-L-XEN", title: "BMW 5 Series F10 Adaptive Xenon Headlight Left", brand: "BMW", oem: "63117271911", price: 429 },
  { sku: "OP-MB-W205-HL-R-LED", title: "Mercedes C-Class W205 LED Headlight Right", brand: "Mercedes", oem: "A2059068204", price: 749 },
  { sku: "OP-AUDI-8V-HL-L-LED", title: "Audi A3 8V Facelift LED Headlight Left", brand: "Audi", oem: "8V0941033E", price: 559 },
  { sku: "OP-RR-L405-TL-R", title: "Range Rover L405 Tail Light Right", brand: "Range Rover", oem: "LR053522", price: 289 },
  { sku: "OP-BMW-F30-LENS-PAIR", title: "BMW F30 Headlight Lens Covers (Pair)", brand: "BMW", oem: null, price: 79 },
  { sku: "OP-VW-MK7-HL-L-HAL", title: "VW Golf Mk7 Halogen Headlight Left", brand: "VW", oem: "5G1941005", price: 149 },
];

async function clear() {
  const accounts = await db
    .select({ id: schema.channelAccounts.id })
    .from(schema.channelAccounts)
    .where(inArray(schema.channelAccounts.label, ["Demo eBay", "Demo Wix"]));
  if (accounts.length)
    await db.delete(schema.channelAccounts).where(inArray(schema.channelAccounts.id, accounts.map((a) => a.id)));
  await db.delete(schema.products).where(inArray(schema.products.sku, PRODUCTS.map((p) => p.sku)));
  console.log("Demo data removed.");
}

async function seed() {
  for (const p of PRODUCTS) {
    await db
      .insert(schema.products)
      .values({
        sku: p.sku,
        title: p.title,
        brand: p.brand,
        category: p.title.includes("Tail") ? "Tail light" : p.title.includes("Lens") ? "Lens" : "Headlight",
        oemPartNumber: p.oem,
        quantity: 2 + Math.floor(Math.random() * 6),
        lowStockAt: 1,
        costPrice: (p.price * 0.45).toFixed(2),
      })
      .onConflictDoNothing();
  }

  const accountIds: Record<"EBAY" | "WIX", string> = { EBAY: "", WIX: "" };
  for (const [channel, label] of [["EBAY", "Demo eBay"], ["WIX", "Demo Wix"]] as const) {
    const [a] = await db
      .insert(schema.channelAccounts)
      .values({ channel, label })
      .onConflictDoUpdate({
        target: [schema.channelAccounts.channel, schema.channelAccounts.label],
        set: { updatedAt: new Date() },
      })
      .returning();
    accountIds[channel] = a.id;
  }

  const names = ["J. Patel", "M. Hughes", "S. Kowalski", "A. Okafor", "R. Evans", "L. Moreau", "T. Byrne"];
  const postcodes = ["B12 0AA", "M4 5BX", "LS1 2RT", "CF10 1AB", "G2 3QZ", "EH1 1YZ", "BS1 4DJ"];
  let n = 0;
  for (let d = 60; d >= 0; d--) {
    const perDay = Math.floor(Math.random() * 4);
    for (let k = 0; k < perDay; k++) {
      const p = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
      const channel = Math.random() < 0.7 ? "EBAY" : "WIX";
      const placedAt = new Date(Date.now() - d * 86400000 - Math.random() * 8 * 3600000);
      const status: OrderStatus =
        d <= 1 ? "PAID" : Math.random() < 0.05 ? "CANCELLED" : Math.random() < 0.04 ? "REFUNDED" : "SHIPPED";
      const ship = p.price > 300 ? 14.99 : 4.99;
      const total = p.price + ship;
      const i = Math.floor(Math.random() * names.length);
      n++;
      await upsertOrder({
        channel,
        channelAccountId: accountIds[channel],
        externalId: `DEMO-${channel}-${n}`,
        orderNumber: channel === "EBAY" ? `12-1${String(10000 + n)}-${String(30000 + n)}` : String(10000 + n),
        status,
        buyerName: names[i],
        shipPostcode: postcodes[i],
        shipCountry: "GB",
        currency: "GBP",
        subtotal: p.price.toFixed(2),
        shippingCharged: ship.toFixed(2),
        tax: "0.00",
        total: total.toFixed(2),
        placedAt,
        paidAt: placedAt,
        dispatchBy: new Date(placedAt.getTime() + 2 * 86400000),
        items: [{ externalSku: p.sku, title: p.title, quantity: 1, unitPrice: p.price.toFixed(2) }],
        fees: channel === "EBAY" ? [{ type: "EBAY_MARKETPLACE", amount: (total * 0.109 + 0.3).toFixed(2) }] : [],
      });
    }
  }
  // demo orders sold more than we stocked — reset to realistic levels,
  // with one item at zero so the low-stock alert shows
  for (const [idx, p] of PRODUCTS.entries()) {
    await db
      .update(schema.products)
      .set({ quantity: idx === 1 ? 0 : 1 + Math.floor(Math.random() * 6) })
      .where(eq(schema.products.sku, p.sku));
  }
  console.log(`Seeded ${PRODUCTS.length} products and ${n} demo orders.`);
}

(process.argv.includes("--clear") ? clear() : seed())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
