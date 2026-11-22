import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderStatus } from "@/db/schema";
import { toMoney } from "@/lib/money";
import { logSync, upsertOrder, type NormalisedOrder } from "@/lib/sync/upsert-order";

// Subset of the Wix eCommerce Order shape we use.
type Price = { amount?: string };
type WixAddress = {
  addressLine?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  country?: string;
};
type Contact = { firstName?: string; lastName?: string; email?: string };
export type WixOrder = {
  id: string;
  number?: string | number;
  createdDate: string;
  updatedDate?: string;
  purchasedDate?: string;
  status?: "INITIALIZED" | "APPROVED" | "CANCELED" | "PENDING" | "REJECTED";
  paymentStatus?: string; // PAID, NOT_PAID, PARTIALLY_PAID, FULLY_REFUNDED, PARTIALLY_REFUNDED, PENDING...
  fulfillmentStatus?: "NOT_FULFILLED" | "FULFILLED" | "PARTIALLY_FULFILLED";
  currency?: string;
  buyerInfo?: { email?: string };
  billingInfo?: { contactDetails?: Contact };
  shippingInfo?: {
    logistics?: {
      shippingDestination?: { address?: WixAddress; contactDetails?: Contact };
      deliverByDate?: string;
    };
  };
  priceSummary?: { subtotal?: Price; shipping?: Price; tax?: Price; total?: Price };
  lineItems?: {
    id: string;
    productName?: { original?: string; translated?: string };
    quantity: number;
    price?: Price;
    physicalProperties?: { sku?: string };
  }[];
};

type SearchResponse = {
  orders?: WixOrder[];
  metadata?: { hasNext?: boolean; cursors?: { next?: string } };
};

function wixConfig() {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) throw new Error("Missing WIX_API_KEY or WIX_SITE_ID in environment");
  return { apiKey, siteId };
}

const fullName = (c?: Contact) =>
  [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim() || null;

export function mapWixStatus(o: WixOrder): OrderStatus {
  if (o.status === "CANCELED" || o.status === "REJECTED") return "CANCELLED";
  if (o.paymentStatus === "FULLY_REFUNDED") return "REFUNDED";
  if (o.fulfillmentStatus === "FULFILLED") return "SHIPPED";
  if (o.paymentStatus === "PAID" || o.paymentStatus === "PARTIALLY_REFUNDED") return "PAID";
  return "AWAITING_PAYMENT";
}

export function normaliseWixOrder(o: WixOrder, channelAccountId: string): NormalisedOrder {
  const dest = o.shippingInfo?.logistics?.shippingDestination;
  const addr = dest?.address;
  const ps = o.priceSummary ?? {};
  const status = mapWixStatus(o);
  return {
    channel: "WIX",
    channelAccountId,
    externalId: o.id,
    orderNumber: o.number != null ? String(o.number) : null,
    status,
    buyerName: fullName(o.billingInfo?.contactDetails) ?? fullName(dest?.contactDetails),
    buyerUsername: null,
    buyerEmail: o.buyerInfo?.email ?? null,
    shipName: fullName(dest?.contactDetails),
    shipLine1: addr?.addressLine1 ?? addr?.addressLine ?? null,
    shipLine2: addr?.addressLine2 ?? null,
    shipCity: addr?.city ?? null,
    shipPostcode: addr?.postalCode ?? null,
    shipCountry: addr?.country ?? null,
    currency: o.currency ?? "GBP",
    subtotal: toMoney(ps.subtotal?.amount),
    shippingCharged: toMoney(ps.shipping?.amount),
    tax: toMoney(ps.tax?.amount),
    total: toMoney(ps.total?.amount),
    dispatchBy: null,
    placedAt: new Date(o.purchasedDate ?? o.createdDate),
    paidAt: o.paymentStatus === "PAID" ? new Date(o.purchasedDate ?? o.createdDate) : null,
    shippedAt: status === "SHIPPED" && o.updatedDate ? new Date(o.updatedDate) : null,
    raw: o,
    items: (o.lineItems ?? []).map((l) => ({
      externalLineId: l.id,
      externalSku: l.physicalProperties?.sku ?? null,
      title: l.productName?.original ?? l.productName?.translated ?? "Item",
      quantity: l.quantity,
      unitPrice: toMoney(l.price?.amount),
    })),
  };
}

async function getOrCreateWixAccount(siteId: string) {
  const label = "Wix site";
  const [existing] = await db
    .select()
    .from(schema.channelAccounts)
    .where(and(eq(schema.channelAccounts.channel, "WIX"), eq(schema.channelAccounts.label, label)));
  if (existing) return existing;
  const [created] = await db
    .insert(schema.channelAccounts)
    .values({ channel: "WIX", label, externalAccountId: siteId })
    .returning();
  return created;
}

/**
 * Wix Search Orders can't filter on updatedDate, so each run re-reads every
 * order purchased in a rolling window (default 30 days before the last sync).
 * That catches status changes (paid → fulfilled → refunded) on recent orders.
 */
export async function syncWixOrders({ backfillDays = 90, rollingDays = 30 } = {}) {
  const startedAt = new Date();
  try {
    const { apiKey, siteId } = wixConfig();
    const account = await getOrCreateWixAccount(siteId);
    const day = 24 * 60 * 60 * 1000;
    const since = account.lastOrderSyncAt
      ? new Date(account.lastOrderSyncAt.getTime() - rollingDays * day)
      : new Date(Date.now() - backfillDays * day);

    let cursor: string | undefined;
    let count = 0;
    let created = 0;
    do {
      const body = cursor
        ? { search: { cursorPaging: { limit: 100, cursor } } }
        : {
            search: {
              filter: {
                $and: [
                  { purchasedDate: { $gte: since.toISOString() } },
                  // include unpaid/pending ones, which are hidden by default
                  { status: { $in: ["APPROVED", "PENDING", "CANCELED"] } },
                ],
              },
              sort: [{ fieldName: "purchasedDate", order: "ASC" }],
              cursorPaging: { limit: 100 },
            },
          };
      const res = await fetch("https://www.wixapis.com/ecom/v1/orders/search", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "wix-site-id": siteId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Wix order search failed (${res.status}): ${await res.text()}`);
      const page = (await res.json()) as SearchResponse;
      for (const o of page.orders ?? []) {
        if (await upsertOrder(normaliseWixOrder(o, account.id))) created++;
        count++;
      }
      cursor = page.metadata?.hasNext ? page.metadata.cursors?.next : undefined;
    } while (cursor);

    await db
      .update(schema.channelAccounts)
      .set({ lastOrderSyncAt: startedAt })
      .where(eq(schema.channelAccounts.id, account.id));
    await logSync("WIX", "orders", startedAt, { ok: true, count, message: `${created} new` });
    return { ok: true as const, count, created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync("WIX", "orders", startedAt, { ok: false, message }).catch(() => {});
    return { ok: false as const, error: message };
  }
}
