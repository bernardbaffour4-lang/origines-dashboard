import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OrderStatus } from "@/db/schema";
import { toMoney } from "@/lib/money";
import { logSync, upsertOrder, type NormalisedOrder } from "@/lib/sync/upsert-order";
import { ebayFetch, getValidEbayToken } from "./auth";

// Subset of the Sell Fulfillment API "Order" shape we use.
type Amount = { value: string; currency: string };
export type EbayOrder = {
  orderId: string;
  legacyOrderId?: string;
  creationDate: string;
  lastModifiedDate: string;
  orderFulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";
  orderPaymentStatus: "PAID" | "PENDING" | "FAILED" | "FULLY_REFUNDED" | "PARTIALLY_REFUNDED";
  cancelStatus?: { cancelState?: "NONE_REQUESTED" | "IN_PROGRESS" | "CANCELED" };
  buyer?: {
    username?: string;
    buyerRegistrationAddress?: { fullName?: string; email?: string };
  };
  pricingSummary?: {
    priceSubtotal?: Amount;
    deliveryCost?: Amount;
    tax?: Amount;
    total?: Amount;
  };
  totalMarketplaceFee?: Amount;
  paymentSummary?: { payments?: { paymentDate?: string }[] };
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        email?: string;
        contactAddress?: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          postalCode?: string;
          countryCode?: string;
        };
      };
    };
  }[];
  lineItems: {
    lineItemId: string;
    sku?: string;
    title: string;
    quantity: number;
    lineItemCost?: Amount;
    total?: Amount;
    lineItemFulfillmentInstructions?: { shipByDate?: string };
  }[];
};

type GetOrdersResponse = { orders?: EbayOrder[]; total: number; next?: string };

export function mapEbayStatus(o: EbayOrder): OrderStatus {
  if (o.cancelStatus?.cancelState === "CANCELED") return "CANCELLED";
  if (o.orderPaymentStatus === "FULLY_REFUNDED") return "REFUNDED";
  if (o.orderPaymentStatus === "PENDING" || o.orderPaymentStatus === "FAILED")
    return "AWAITING_PAYMENT";
  if (o.orderFulfillmentStatus === "FULFILLED") return "SHIPPED";
  return "PAID";
}

export function normaliseEbayOrder(o: EbayOrder, channelAccountId: string): NormalisedOrder {
  const shipTo = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const addr = shipTo?.contactAddress;
  const p = o.pricingSummary ?? {};
  const shipBy = o.lineItems
    .map((l) => l.lineItemFulfillmentInstructions?.shipByDate)
    .filter(Boolean)
    .sort()[0];
  const paid = o.paymentSummary?.payments?.[0]?.paymentDate;
  return {
    channel: "EBAY",
    channelAccountId,
    externalId: o.orderId,
    orderNumber: o.legacyOrderId ?? o.orderId,
    status: mapEbayStatus(o),
    buyerName: o.buyer?.buyerRegistrationAddress?.fullName ?? shipTo?.fullName ?? null,
    buyerUsername: o.buyer?.username ?? null,
    buyerEmail: shipTo?.email ?? o.buyer?.buyerRegistrationAddress?.email ?? null,
    shipName: shipTo?.fullName ?? null,
    shipLine1: addr?.addressLine1 ?? null,
    shipLine2: addr?.addressLine2 ?? null,
    shipCity: addr?.city ?? null,
    shipPostcode: addr?.postalCode ?? null,
    shipCountry: addr?.countryCode ?? null,
    currency: p.total?.currency ?? "GBP",
    subtotal: toMoney(p.priceSubtotal?.value),
    shippingCharged: toMoney(p.deliveryCost?.value),
    tax: toMoney(p.tax?.value),
    total: toMoney(p.total?.value),
    dispatchBy: shipBy ? new Date(shipBy) : null,
    placedAt: new Date(o.creationDate),
    paidAt: paid ? new Date(paid) : null,
    shippedAt: o.orderFulfillmentStatus === "FULFILLED" ? new Date(o.lastModifiedDate) : null,
    raw: o,
    items: o.lineItems.map((l) => ({
      externalLineId: l.lineItemId,
      externalSku: l.sku ?? null,
      title: l.title,
      quantity: l.quantity,
      unitPrice: toMoney(parseFloat(l.lineItemCost?.value ?? "0") / Math.max(l.quantity, 1)),
    })),
    fees: o.totalMarketplaceFee
      ? [{ type: "EBAY_MARKETPLACE", amount: toMoney(o.totalMarketplaceFee.value) }]
      : [],
  };
}

/**
 * Pull orders modified since the last sync (or the last `backfillDays` days
 * on first run) and upsert them.
 */
export async function syncEbayOrders({ backfillDays = 90 } = {}) {
  const startedAt = new Date();
  try {
    const { accountId } = await getValidEbayToken();
    const [account] = await db
      .select()
      .from(schema.channelAccounts)
      .where(eq(schema.channelAccounts.id, accountId));

    // Overlap by 10 minutes so nothing slips between runs
    const since = account.lastOrderSyncAt
      ? new Date(account.lastOrderSyncAt.getTime() - 10 * 60 * 1000)
      : new Date(Date.now() - backfillDays * 24 * 60 * 60 * 1000);

    const filter = `lastmodifieddate:[${since.toISOString()}..]`;
    let path: string | null =
      `/sell/fulfillment/v1/order?limit=200&filter=${encodeURIComponent(filter)}`;
    let count = 0;
    let created = 0;

    while (path) {
      const page: GetOrdersResponse = await ebayFetch<GetOrdersResponse>(path);
      for (const o of page.orders ?? []) {
        if (await upsertOrder(normaliseEbayOrder(o, accountId))) created++;
        count++;
      }
      // `next` is an absolute URL; strip the host so ebayFetch can reuse it
      path = page.next ? page.next.replace(/^https?:\/\/[^/]+/, "") : null;
    }

    await db
      .update(schema.channelAccounts)
      .set({ lastOrderSyncAt: startedAt })
      .where(eq(schema.channelAccounts.id, accountId));
    await logSync("EBAY", "orders", startedAt, { ok: true, count, message: `${created} new` });
    return { ok: true as const, count, created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync("EBAY", "orders", startedAt, { ok: false, message }).catch(() => {});
    return { ok: false as const, error: message };
  }
}
