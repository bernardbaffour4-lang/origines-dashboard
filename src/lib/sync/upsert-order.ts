import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName, OrderStatus } from "@/db/schema";

export type NormalisedOrder = {
  channel: ChannelName;
  channelAccountId: string;
  externalId: string;
  orderNumber?: string | null;
  status: OrderStatus;
  buyerName?: string | null;
  buyerUsername?: string | null;
  buyerEmail?: string | null;
  shipName?: string | null;
  shipLine1?: string | null;
  shipLine2?: string | null;
  shipCity?: string | null;
  shipPostcode?: string | null;
  shipCountry?: string | null;
  currency: string;
  subtotal: string;
  shippingCharged: string;
  tax: string;
  total: string;
  dispatchBy?: Date | null;
  placedAt: Date;
  paidAt?: Date | null;
  shippedAt?: Date | null;
  raw?: unknown;
  items: {
    externalLineId?: string | null;
    externalSku?: string | null;
    title: string;
    quantity: number;
    unitPrice: string;
  }[];
  fees?: { type: string; amount: string }[];
};

/**
 * Insert or update one order from any channel.
 * - Line items are matched to your products by SKU.
 * - The first time an order is seen (and isn't cancelled), stock is
 *   decremented and a SALE movement is logged.
 * Returns true if the order was new.
 */
export async function upsertOrder(o: NormalisedOrder): Promise<boolean> {
  return db.transaction(async (tx) => {
    const { items, fees, ...orderFields } = o;

    const [row] = await tx
      .insert(schema.orders)
      .values({ ...orderFields, raw: o.raw ?? null })
      .onConflictDoUpdate({
        target: [schema.orders.channelAccountId, schema.orders.externalId],
        set: {
          status: orderFields.status,
          buyerName: orderFields.buyerName,
          buyerEmail: orderFields.buyerEmail,
          shipName: orderFields.shipName,
          shipLine1: orderFields.shipLine1,
          shipLine2: orderFields.shipLine2,
          shipCity: orderFields.shipCity,
          shipPostcode: orderFields.shipPostcode,
          shipCountry: orderFields.shipCountry,
          subtotal: orderFields.subtotal,
          shippingCharged: orderFields.shippingCharged,
          tax: orderFields.tax,
          total: orderFields.total,
          dispatchBy: orderFields.dispatchBy,
          paidAt: orderFields.paidAt,
          shippedAt: orderFields.shippedAt,
          raw: o.raw ?? null,
          updatedAt: new Date(),
        },
      })
      // xmax = 0 only on a fresh insert — tells us whether the row is new
      .returning({ id: schema.orders.id, inserted: sql<boolean>`(xmax = 0)` });

    // Match SKUs to products
    const skus = [...new Set(items.map((i) => i.externalSku).filter(Boolean))] as string[];
    const products = skus.length
      ? await tx
          .select({ id: schema.products.id, sku: schema.products.sku })
          .from(schema.products)
          .where(inArray(schema.products.sku, skus))
      : [];
    const bySku = new Map(products.map((p) => [p.sku, p.id]));

    // Replace line items and fees (cheap, keeps them in sync with the channel)
    await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, row.id));
    if (items.length) {
      await tx.insert(schema.orderItems).values(
        items.map((i) => ({
          ...i,
          orderId: row.id,
          productId: i.externalSku ? (bySku.get(i.externalSku) ?? null) : null,
        })),
      );
    }
    if (fees) {
      await tx.delete(schema.fees).where(eq(schema.fees.orderId, row.id));
      if (fees.length) {
        await tx.insert(schema.fees).values(fees.map((f) => ({ ...f, orderId: row.id })));
      }
    }

    // New, live order → take the stock out
    if (row.inserted && o.status !== "CANCELLED" && o.status !== "REFUNDED") {
      for (const i of items) {
        const productId = i.externalSku ? bySku.get(i.externalSku) : undefined;
        if (!productId) continue;
        await tx
          .update(schema.products)
          .set({ quantity: sql`${schema.products.quantity} - ${i.quantity}` })
          .where(eq(schema.products.id, productId));
        await tx.insert(schema.stockMovements).values({
          productId,
          change: -i.quantity,
          reason: "SALE",
          reference: `${o.channel}:${o.orderNumber ?? o.externalId}`,
        });
      }
    }
    return row.inserted;
  });
}

export async function logSync(
  channel: ChannelName,
  job: string,
  startedAt: Date,
  result: { ok: boolean; count?: number; message?: string },
) {
  await db.insert(schema.syncLogs).values({
    channel,
    job,
    startedAt,
    endedAt: new Date(),
    ok: result.ok,
    count: result.count ?? 0,
    message: result.message,
  });
}
