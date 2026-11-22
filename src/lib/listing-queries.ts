import { and, asc, count, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { relistConfig } from "@/lib/ebay/listings";
import { SETTINGS, getSetting } from "@/lib/settings";

const { channelListings: L, relistLog: R } = schema;
const DAY = 24 * 60 * 60 * 1000;

export type ListingFilter = "all" | "due" | "soon" | "no_sku" | "no_stock" | "variations" | "auctions";

function filterWhere(f: ListingFilter) {
  const { ageDays } = relistConfig();
  const cutoff = new Date(Date.now() - ageDays * DAY);
  const soon = new Date(Date.now() - (ageDays - 3) * DAY);
  const fixed = eq(L.listingType, "FixedPriceItem");
  switch (f) {
    case "due":
      return and(fixed, lt(L.startTime, cutoff));
    case "soon":
      return and(fixed, gte(L.startTime, cutoff), lt(L.startTime, soon));
    case "no_sku":
      return or(isNull(L.externalSku), eq(L.externalSku, ""));
    case "no_stock":
      return lte(L.quantity, 0);
    case "variations":
      return eq(L.hasVariations, true);
    case "auctions":
      return sql`${L.listingType} <> 'FixedPriceItem'`;
    default:
      return undefined;
  }
}

export async function getListingStats() {
  const { ageDays } = relistConfig();
  const cutoff = new Date(Date.now() - ageDays * DAY);
  const soon = new Date(Date.now() - (ageDays - 3) * DAY);
  const active = eq(L.status, "ACTIVE");
  const n = async (w: ReturnType<typeof and>) =>
    Number((await db.select({ n: count() }).from(L).where(and(active, w)))[0].n);

  const fixed = eq(L.listingType, "FixedPriceItem");
  const stats = {
    active: await n(undefined),
    due: await n(and(fixed, lt(L.startTime, cutoff))),
    soon: await n(and(fixed, gte(L.startTime, cutoff), lt(L.startTime, soon))),
    noSku: await n(or(isNull(L.externalSku), eq(L.externalSku, ""))),
    noStock: await n(lte(L.quantity, 0)),
    variations: await n(eq(L.hasVariations, true)),
    auctions: await n(sql`${L.listingType} <> 'FixedPriceItem'`),
  };
  const [relisted7] = await db
    .select({ n: count() })
    .from(R)
    .where(and(eq(R.status, "RELISTED"), gte(R.updatedAt, new Date(Date.now() - 7 * DAY))));
  const [stuck] = await db.select({ n: count() }).from(R).where(eq(R.status, "ENDED"));
  return { ...stats, relisted7: Number(relisted7.n), stuck: Number(stuck.n), ageDays };
}

export async function listListings(f: ListingFilter, q?: string, limit = 200) {
  const where = [eq(L.status, "ACTIVE")];
  const fw = filterWhere(f);
  if (fw) where.push(fw);
  if (q) {
    const like = `%${q}%`;
    where.push(sql`(${L.title} ilike ${like} or ${L.externalSku} ilike ${like} or ${L.externalId} ilike ${like})`);
  }
  return db
    .select()
    .from(L)
    .where(and(...where))
    .orderBy(asc(L.startTime))
    .limit(limit);
}

export async function getRelistLog(limit = 50) {
  return db.select().from(R).orderBy(desc(R.updatedAt)).limit(limit);
}

export async function getStuckRelists() {
  return db.select().from(R).where(eq(R.status, "ENDED")).orderBy(asc(R.createdAt));
}

export async function getRelistSettings() {
  return {
    enabled: await getSetting<boolean>(SETTINGS.autoRelist, true),
    lastRun: await getSetting<Record<string, unknown> | null>(SETTINGS.lastRelistRun, null),
  };
}
