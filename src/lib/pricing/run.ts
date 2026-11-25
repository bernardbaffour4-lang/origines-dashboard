/**
 * Dead-stock pricing job: builds a price plan from the database and (in LIVE
 * mode) pushes the changes to eBay. Runs every 15 minutes from cron so the
 * time-of-day flash prices switch on and off on time; the daily markdowns
 * happen on whichever run first finds a cut is due.
 */
import { and, eq, gt, inArray, isNotNull, isNull, lt, max, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toMoney } from "@/lib/money";
import { SETTINGS, acquireLock, getSetting, releaseLock, setSetting } from "@/lib/settings";
import { logSync } from "@/lib/sync/upsert-order";
import { syncEbayListings } from "@/lib/ebay/listings";
import { reviseItemPrice } from "@/lib/ebay/trading";
import { getListingViews30d } from "@/lib/ebay/traffic";
import { PRICING } from "./config";
import { priceItem, type PricingResult } from "./engine";

const DAY = 24 * 60 * 60 * 1000;
const { channelListings: L, pricingItems: P, pricingLog: PL } = schema;

export type PricingMode = "OFF" | "PREVIEW" | "LIVE";
export const getPricingMode = () => getSetting<PricingMode>(SETTINGS.pricingMode, "PREVIEW");

const num = (v: string | null | undefined) => (v == null ? null : Number(v));
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

export type PlanRow = {
  sku: string;
  title: string;
  itemIds: string[];
  viewUrl: string | null;
  imageUrl: string | null;
  ebayPrice: number;
  currency: string;
  watchers: number;
  views30d: number | null;
  ageDays: number;
  ageEstimated: boolean; // no stocked_since given, estimated from eBay/relist history
  base: number; // base the engine started from
  original: number;
  manualChange: boolean; // eBay price differs from what the engine last set
  result: PricingResult;
  willChangeEbay: boolean;
};

export type Plan = {
  rows: PlanRow[];
  missingCost: { sku: string; title: string; price: number | null }[];
  noSku: number;
};

export async function buildPlan(now = new Date()): Promise<Plan> {
  const listings = await db
    .select()
    .from(L)
    .where(and(eq(L.status, "ACTIVE"), eq(L.listingType, "FixedPriceItem"), eq(L.hasVariations, false)));

  const noSku = listings.filter((l) => !l.externalSku).length;
  const bySku = new Map<string, typeof listings>();
  for (const l of listings) {
    if (!l.externalSku || (l.quantity ?? 0) <= 0 || l.price == null) continue;
    bySku.set(l.externalSku, [...(bySku.get(l.externalSku) ?? []), l]);
  }
  const skus = [...bySku.keys()];
  if (!skus.length) return { rows: [], missingCost: [], noSku };

  const items = await db.select().from(P).where(inArray(P.sku, skus));
  const itemBySku = new Map(items.map((i) => [i.sku, i]));

  // Last sale per SKU (any channel)
  const sold = await db
    .select({ sku: schema.orderItems.externalSku, at: max(schema.orders.placedAt) })
    .from(schema.orderItems)
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .where(inArray(schema.orderItems.externalSku, skus))
    .groupBy(schema.orderItems.externalSku);
  const lastSold = new Map(sold.map((s) => [s.sku!, s.at ? new Date(s.at) : null]));

  // First-listed estimate from relist history (relist date minus the listing's age then)
  const est = await db
    .select({
      sku: schema.relistLog.sku,
      at: sql<string>`min(${schema.relistLog.createdAt} - make_interval(days => ${schema.relistLog.ageDays}))`,
    })
    .from(schema.relistLog)
    .where(and(inArray(schema.relistLog.sku, skus), isNotNull(schema.relistLog.ageDays)))
    .groupBy(schema.relistLog.sku);
  const firstListedEst = new Map(est.map((e) => [e.sku!, e.at ? new Date(e.at) : null]));

  const rows: PlanRow[] = [];
  const missingCost: Plan["missingCost"] = [];

  for (const [sku, group] of bySku) {
    const l = group[0];
    const item = itemBySku.get(sku);
    const ebayPrice = Number(l.price);
    if (item && !item.enabled) continue;
    if (!item || item.cost == null) {
      missingCost.push({ sku, title: l.title ?? "", price: ebayPrice });
      continue;
    }

    const starts = group.map((g) => g.startTime).filter(Boolean) as Date[];
    const candidates = [...starts, firstListedEst.get(sku)].filter(Boolean) as Date[];
    const stocked = item.stockedSince ?? (candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : now);
    const sale = lastSold.get(sku);
    const unsoldSince = sale && sale > stocked ? sale : stocked;
    const ageDays = Math.max(0, Math.floor((now.getTime() - unsoldSince.getTime()) / DAY));

    // If the eBay price isn't what the engine last set, you changed it by hand: take it as the new base.
    const expected = num(item.lastPushedPrice) ?? num(item.basePrice);
    const manualChange = expected != null && !same(ebayPrice, expected);
    const base = manualChange ? ebayPrice : (num(item.basePrice) ?? ebayPrice);
    let original = num(item.originalPrice) ?? base;
    if (manualChange && ebayPrice > original) original = ebayPrice;
    const daysSinceBaseChange = manualChange
      ? 0
      : item.lastBaseChangeAt
        ? Math.floor((now.getTime() - item.lastBaseChangeAt.getTime()) / DAY)
        : null;

    const result = priceItem(
      {
        cost: Number(item.cost),
        postage: num(item.postage) ?? 0,
        originalPrice: original,
        basePrice: base,
        ageDays,
        daysSinceBaseChange,
        views30d: item.views30d,
        watchers: Math.max(...group.map((g) => g.watchCount ?? 0)),
        marketPrice: num(item.marketPrice),
      },
      now,
    );

    rows.push({
      sku,
      title: l.title ?? "",
      itemIds: group.map((g) => g.externalId),
      viewUrl: l.viewUrl,
      imageUrl: l.imageUrl,
      ebayPrice,
      currency: l.currency,
      watchers: Math.max(...group.map((g) => g.watchCount ?? 0)),
      views30d: item.views30d,
      ageDays,
      ageEstimated: !item.stockedSince,
      base,
      original,
      manualChange,
      result,
      willChangeEbay: group.some((g) => !same(Number(g.price), result.livePrice)),
    });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);
  missingCost.sort((a, b) => a.sku.localeCompare(b.sku));
  return { rows, missingCost, noSku };
}

/** Refresh 30-day views once a day. Views on a freshly relisted listing are scaled up to a 30-day rate. */
async function refreshViews(now: Date) {
  const stale = await db
    .select({ sku: P.sku })
    .from(P)
    .where(or(isNull(P.viewsUpdatedAt), lt(P.viewsUpdatedAt, new Date(now.getTime() - 20 * 60 * 60 * 1000))));
  if (!stale.length) return 0;
  const staleSkus = stale.map((s) => s.sku);
  const listings = await db
    .select({ sku: L.externalSku, itemId: L.externalId, startTime: L.startTime })
    .from(L)
    .where(and(eq(L.status, "ACTIVE"), inArray(L.externalSku, staleSkus)));
  if (!listings.length) return 0;

  const views = await getListingViews30d(listings.map((l) => l.itemId));
  const perSku = new Map<string, number | null>();
  for (const l of listings) {
    const raw = views.get(l.itemId);
    const liveDays = l.startTime ? (now.getTime() - l.startTime.getTime()) / DAY : 30;
    // Too new to judge (e.g. relisted this week): leave unknown
    const rate = raw == null || liveDays < 5 ? null : Math.round((raw * 30) / Math.min(30, liveDays));
    const prev = perSku.get(l.sku!);
    perSku.set(l.sku!, rate == null ? (prev ?? null) : Math.max(prev ?? 0, rate));
  }
  for (const [sku, v] of perSku) {
    await db.update(P).set({ views30d: v, viewsUpdatedAt: now }).where(eq(P.sku, sku));
  }
  return perSku.size;
}

export type PricingSummary = {
  ok: boolean;
  mode: PricingMode;
  skippedReason?: string;
  tracked: number;
  changed: number;
  cuts: number;
  failed: number;
  errors: string[];
  at: string;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

export async function runPricing({ trigger }: { trigger: "CRON" | "MANUAL" }): Promise<PricingSummary> {
  const now = new Date();
  const t0 = Date.now();
  const mode = await getPricingMode();
  const summary: PricingSummary = { ok: true, mode, tracked: 0, changed: 0, cuts: 0, failed: 0, errors: [], at: now.toISOString() };

  if (mode === "OFF") return { ...summary, skippedReason: "Dead-stock pricing is switched off" };

  // Don't touch prices while listings are being ended & relisted
  const relistLock = await getSetting<{ at?: string } | null>(SETTINGS.relistLock, null);
  if (relistLock?.at && Date.now() - new Date(relistLock.at).getTime() < 15 * 60 * 1000) {
    return { ...summary, skippedReason: "Relist run in progress — will price on the next run" };
  }
  if (!(await acquireLock(SETTINGS.pricingLock, 10))) {
    return { ...summary, ok: false, skippedReason: "Another pricing run is in progress" };
  }

  try {
    try {
      await refreshViews(now);
    } catch (e) {
      summary.errors.push(`Views not updated (engine treats them as unknown): ${errMsg(e)}`);
    }

    let plan = await buildPlan(now);
    if (mode === "LIVE" && plan.rows.some((r) => r.willChangeEbay || r.manualChange)) {
      // About to change prices: fetch fresh eBay prices first so we never overwrite a change you just made
      const sync = await syncEbayListings();
      if (!sync.ok) throw new Error(`Listing sync failed, no prices changed: ${sync.error}`);
      plan = await buildPlan(now);
    }
    summary.tracked = plan.rows.length;

    if (mode === "LIVE") await applyPlan(plan, now, summary, t0);
  } catch (e) {
    summary.ok = false;
    summary.errors.push(errMsg(e));
  } finally {
    await releaseLock(SETTINGS.pricingLock).catch(() => {});
  }

  await setSetting(SETTINGS.lastPricingRun, { ...summary, trigger });
  if (mode === "LIVE" && (summary.changed || summary.failed || !summary.ok)) {
    await logSync("EBAY", "pricing", new Date(t0), {
      ok: summary.ok && summary.failed === 0,
      count: summary.changed,
      message: `changed ${summary.changed} price(s), ${summary.cuts} markdown(s), ${summary.failed} failed`,
    });
  }
  return summary;
}

async function applyPlan(plan: Plan, now: Date, summary: PricingSummary, t0: number) {
  for (const row of plan.rows) {
    const r = row.result;
    const isCut = r.newBase < row.base - 0.005;

    // Remember the starting point the first time we see an item, and adopt manual changes
    const state: Partial<typeof P.$inferInsert> = {
      originalPrice: toMoney(row.original),
      basePrice: toMoney(row.base),
    };
    if (row.manualChange) {
      state.lastBaseChangeAt = now;
      state.lastPushedPrice = toMoney(row.ebayPrice);
      await db.insert(PL).values({
        sku: row.sku,
        itemId: row.itemIds[0],
        title: row.title,
        kind: "MANUAL_CHANGE",
        newPrice: toMoney(row.ebayPrice),
        note: "Price changed outside the dashboard — taken as the new base",
      });
    }

    if (row.willChangeEbay) {
      if (summary.changed >= PRICING.maxChangesPerRun || Date.now() - t0 > PRICING.timeBudgetMs) {
        await db.update(P).set(state).where(eq(P.sku, row.sku));
        continue; // next run picks it up
      }
      const kind = isCut ? "BASE_CUT" : r.livePrice < row.ebayPrice ? "FLASH_ON" : "FLASH_OFF";
      const note = [kind === "BASE_CUT" ? `${row.ageDays} days unsold` : null, ...r.notes].filter(Boolean).join(" · ");
      let allOk = true;
      for (const itemId of row.itemIds) {
        try {
          await reviseItemPrice(itemId, r.livePrice, row.currency);
          await db.update(L).set({ price: toMoney(r.livePrice) }).where(eq(L.externalId, itemId));
          await db.insert(PL).values({
            sku: row.sku, itemId, title: row.title, kind,
            oldPrice: toMoney(row.ebayPrice), newPrice: toMoney(r.livePrice), note,
          });
        } catch (e) {
          allOk = false;
          summary.failed++;
          summary.errors.push(`${row.sku}: ${errMsg(e)}`);
          await db.insert(PL).values({
            sku: row.sku, itemId, title: row.title, kind: "ERROR",
            oldPrice: toMoney(row.ebayPrice), newPrice: toMoney(r.livePrice), note: errMsg(e), ok: false,
          });
        }
      }
      if (allOk) {
        summary.changed++;
        if (isCut) summary.cuts++;
        Object.assign(state, {
          basePrice: toMoney(r.newBase),
          lastPushedPrice: toMoney(r.livePrice),
          lastPushedAt: now,
          ...(isCut ? { lastBaseChangeAt: now } : {}),
        });
      }
    } else if (isCut) {
      // eBay already shows the right price (e.g. during a flash window) — just record the new base
      Object.assign(state, { basePrice: toMoney(r.newBase), lastBaseChangeAt: now });
    }
    await db.update(P).set(state).where(eq(P.sku, row.sku));
  }
}

/** Latest price changes for the Pricing page. */
export async function getPricingLog(limit = 50) {
  return db.select().from(PL).orderBy(sql`${PL.createdAt} desc`).limit(limit);
}

export async function countRecentChanges(hours = 24) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(PL)
    .where(and(eq(PL.ok, true), gt(PL.createdAt, new Date(Date.now() - hours * 60 * 60 * 1000))));
  return row?.n ?? 0;
}
