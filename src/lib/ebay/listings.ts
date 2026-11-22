import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toMoney } from "@/lib/money";
import { SETTINGS, acquireLock, getSetting, releaseLock, setSetting } from "@/lib/settings";
import { logSync } from "@/lib/sync/upsert-order";
import { getValidEbayToken } from "./auth";
import { endFixedPriceItem, getActiveListings, relistFixedPriceItem } from "./trading";

const DAY = 24 * 60 * 60 * 1000;
const { channelListings: L, relistLog: R } = schema;

export const relistConfig = () => ({
  ageDays: Number(process.env.RELIST_AGE_DAYS ?? 25),
  maxPerRun: Number(process.env.RELIST_MAX_PER_RUN ?? 100),
  maxAttempts: 5,
  timeBudgetMs: 240_000, // stay well inside Vercel's 300s limit
});

// ---------------------------------------------------------------------------
// 1) Listing sync: pull every active eBay listing into channel_listings
// ---------------------------------------------------------------------------

export async function syncEbayListings() {
  const startedAt = new Date();
  try {
    const { accountId } = await getValidEbayToken();
    const listings = await getActiveListings();

    const skus = [...new Set(listings.map((l) => l.sku).filter(Boolean))] as string[];
    const products = skus.length
      ? await db
          .select({ id: schema.products.id, sku: schema.products.sku })
          .from(schema.products)
          .where(inArray(schema.products.sku, skus))
      : [];
    const bySku = new Map(products.map((p) => [p.sku, p.id]));

    for (const l of listings) {
      const values = {
        channelAccountId: accountId,
        externalId: l.itemId,
        externalSku: l.sku,
        productId: l.sku ? (bySku.get(l.sku) ?? null) : null,
        title: l.title,
        price: l.price != null ? toMoney(l.price) : null,
        currency: l.currency,
        quantity: l.quantityAvailable,
        quantitySold: l.quantitySold,
        watchCount: l.watchCount,
        listingType: l.listingType,
        hasVariations: l.hasVariations,
        startTime: l.startTime,
        viewUrl: l.viewUrl,
        imageUrl: l.imageUrl,
        status: "ACTIVE",
        lastSeenAt: startedAt,
      };
      await db
        .insert(L)
        .values(values)
        .onConflictDoUpdate({ target: [L.channelAccountId, L.externalId], set: values });
    }

    // Anything we didn't see this time is no longer active on eBay
    await db
      .update(L)
      .set({ status: "ENDED" })
      .where(and(eq(L.channelAccountId, accountId), eq(L.status, "ACTIVE"), lt(L.lastSeenAt, startedAt)));

    await logSync("EBAY", "listings", startedAt, { ok: true, count: listings.length });
    return { ok: true as const, count: listings.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSync("EBAY", "listings", startedAt, { ok: false, message }).catch(() => {});
    return { ok: false as const, error: message };
  }
}

// ---------------------------------------------------------------------------
// 2) End & relist every fixed-price listing older than RELIST_AGE_DAYS
// ---------------------------------------------------------------------------

type RelistSummary = {
  ok: boolean;
  skippedReason?: string;
  listingsSynced?: number;
  retried: number;
  relisted: number;
  failed: number;
  skipped: number;
  remaining: number;
  errors: string[];
  at: string;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Relist an item that is already ended, and point the listing row at the new item. */
async function finishRelist(logId: string, accountId: string, oldItemId: string, quantity: number | null) {
  const newItemId = await relistFixedPriceItem(oldItemId, quantity);
  const now = new Date();
  await db
    .update(R)
    .set({ status: "RELISTED", newItemId, error: null, attempts: sql`${R.attempts} + 1` })
    .where(eq(R.id, logId));
  await db
    .update(L)
    .set({ externalId: newItemId, startTime: now, watchCount: 0, quantitySold: 0, status: "ACTIVE", lastSeenAt: now })
    .where(and(eq(L.channelAccountId, accountId), eq(L.externalId, oldItemId)));
  return newItemId;
}

export async function runRelist({ trigger }: { trigger: "CRON" | "MANUAL" }): Promise<RelistSummary> {
  const cfg = relistConfig();
  const t0 = Date.now();
  const summary: RelistSummary = {
    ok: true,
    retried: 0,
    relisted: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
    errors: [],
    at: new Date().toISOString(),
  };

  if (trigger === "CRON" && !(await getSetting<boolean>(SETTINGS.autoRelist, true))) {
    return { ...summary, skippedReason: "Auto-relist is switched off" };
  }
  if (!(await acquireLock(SETTINGS.relistLock))) {
    return { ...summary, ok: false, skippedReason: "Another relist run is already in progress" };
  }

  try {
    const { accountId } = await getValidEbayToken();

    // Fresh data first, so ages / quantities are current
    const sync = await syncEbayListings();
    if (!sync.ok) throw new Error(`Listing sync failed: ${sync.error}`);
    summary.listingsSynced = sync.count;

    // a) Safety net: items that were ended but not relisted (or interrupted mid-way)
    const stuck = await db
      .select()
      .from(R)
      .where(
        and(
          eq(R.channelAccountId, accountId),
          inArray(R.status, ["ENDED", "PENDING"]),
          lt(R.attempts, cfg.maxAttempts),
          lte(R.updatedAt, new Date(Date.now() - 2 * 60 * 1000)), // not one being processed right now
        ),
      )
      .orderBy(asc(R.createdAt));
    for (const s of stuck) {
      if (Date.now() - t0 > cfg.timeBudgetMs) break;
      if (s.status === "PENDING") {
        // Interrupted before/while ending. Ending again is harmless if it already ended.
        try {
          await endFixedPriceItem(s.oldItemId);
        } catch (e) {
          // Still live on eBay — nothing lost; give up on this attempt
          await db
            .update(R)
            .set({ status: "FAILED", error: `End failed: ${errMsg(e)}`, attempts: sql`${R.attempts} + 1` })
            .where(eq(R.id, s.id));
          continue;
        }
      }
      try {
        await finishRelist(s.id, accountId, s.oldItemId, s.quantity);
        summary.retried++;
      } catch (e) {
        await db
          .update(R)
          .set({ status: "ENDED", error: errMsg(e), attempts: sql`${R.attempts} + 1` })
          .where(eq(R.id, s.id));
        summary.errors.push(`${s.title ?? s.oldItemId}: ${errMsg(e)}`);
      }
    }

    // b) Listings that are due
    const cutoff = new Date(Date.now() - cfg.ageDays * DAY);
    const due = await db
      .select()
      .from(L)
      .where(
        and(
          eq(L.channelAccountId, accountId),
          eq(L.status, "ACTIVE"),
          eq(L.listingType, "FixedPriceItem"),
          lt(L.startTime, cutoff),
        ),
      )
      .orderBy(asc(L.startTime));

    let processed = 0;
    for (const l of due) {
      if (processed >= cfg.maxPerRun || Date.now() - t0 > cfg.timeBudgetMs) {
        summary.remaining++;
        continue;
      }
      const ageDays = l.startTime ? Math.floor((Date.now() - l.startTime.getTime()) / DAY) : null;

      // Can't relist safely: variation listings (per-variation stock) or nothing left to sell
      const skipReason = l.hasVariations
        ? "Has variations — not relisted automatically"
        : (l.quantity ?? 0) <= 0
          ? "Quantity is 0 — nothing to relist"
          : null;
      if (skipReason) {
        const [already] = await db
          .select({ id: R.id })
          .from(R)
          .where(and(eq(R.oldItemId, l.externalId), eq(R.status, "SKIPPED")))
          .limit(1);
        if (!already) {
          await db.insert(R).values({
            channelAccountId: accountId,
            oldItemId: l.externalId,
            title: l.title,
            sku: l.externalSku,
            quantity: l.quantity,
            ageDays,
            status: "SKIPPED",
            error: skipReason,
            trigger,
          });
        }
        summary.skipped++;
        continue;
      }

      processed++;
      const [log] = await db
        .insert(R)
        .values({
          channelAccountId: accountId,
          oldItemId: l.externalId,
          title: l.title,
          sku: l.externalSku,
          quantity: l.quantity,
          ageDays,
          status: "PENDING",
          trigger,
        })
        .returning({ id: R.id });

      // End
      try {
        await endFixedPriceItem(l.externalId);
        await db.update(R).set({ status: "ENDED" }).where(eq(R.id, log.id));
      } catch (e) {
        // Still live on eBay — nothing lost
        await db.update(R).set({ status: "FAILED", error: `End failed: ${errMsg(e)}`, attempts: 1 }).where(eq(R.id, log.id));
        summary.failed++;
        summary.errors.push(`${l.title}: end failed — ${errMsg(e)}`);
        continue;
      }

      // Relist (if this fails the row stays ENDED and is retried next run + shown as an alert)
      try {
        await finishRelist(log.id, accountId, l.externalId, l.quantity);
        summary.relisted++;
      } catch (e) {
        await db
          .update(R)
          .set({ error: `Relist failed: ${errMsg(e)}`, attempts: sql`${R.attempts} + 1` })
          .where(eq(R.id, log.id));
        summary.failed++;
        summary.errors.push(`${l.title}: ENDED BUT NOT RELISTED — ${errMsg(e)}`);
      }
    }
  } catch (e) {
    summary.ok = false;
    summary.errors.push(errMsg(e));
  } finally {
    await releaseLock(SETTINGS.relistLock).catch(() => {});
  }

  await setSetting(SETTINGS.lastRelistRun, { ...summary, trigger });
  await logSync("EBAY", "relist", new Date(t0), {
    ok: summary.ok && summary.failed === 0,
    count: summary.relisted + summary.retried,
    message: `relisted ${summary.relisted}, retried ${summary.retried}, failed ${summary.failed}, skipped ${summary.skipped}, left for next run ${summary.remaining}`,
  });
  return summary;
}
