import { and, desc, eq, gte, inArray, lt, lte, notInArray, sql, count } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName, OrderStatus } from "@/db/schema";

const { orders, fees, products, syncLogs, channelAccounts } = schema;
const NOT_COUNTED: OrderStatus[] = ["CANCELLED", "REFUNDED", "AWAITING_PAYMENT"];
const DAY = 24 * 60 * 60 * 1000;

async function periodTotals(from: Date, to: Date) {
  const [row] = await db
    .select({
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orders: count(),
    })
    .from(orders)
    .where(
      and(gte(orders.placedAt, from), lt(orders.placedAt, to), notInArray(orders.status, NOT_COUNTED)),
    );
  const [feeRow] = await db
    .select({ fees: sql<string>`coalesce(sum(${fees.amount}), 0)` })
    .from(fees)
    .innerJoin(orders, eq(fees.orderId, orders.id))
    .where(
      and(gte(orders.placedAt, from), lt(orders.placedAt, to), notInArray(orders.status, NOT_COUNTED)),
    );
  const revenue = parseFloat(row.revenue);
  return {
    revenue,
    orders: Number(row.orders),
    aov: row.orders ? revenue / Number(row.orders) : 0,
    fees: parseFloat(feeRow.fees),
  };
}

export async function getKpis(days: number) {
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const [current, previous] = await Promise.all([
    periodTotals(from, now),
    periodTotals(prevFrom, from),
  ]);
  return { current, previous };
}

export async function getDailyRevenue(days: number) {
  const from = new Date(Date.now() - days * DAY);
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.placedAt} at time zone 'Europe/London'), 'YYYY-MM-DD')`,
      channel: orders.channel,
      revenue: sql<string>`sum(${orders.total})`,
    })
    .from(orders)
    .where(and(gte(orders.placedAt, from), notInArray(orders.status, NOT_COUNTED)))
    .groupBy(sql`1`, orders.channel)
    .orderBy(sql`1`);

  // Fill every day so the chart has no gaps
  const byDay = new Map<string, Record<string, number | string>>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toLocaleDateString("en-CA", {
      timeZone: "Europe/London",
    });
    byDay.set(d, { day: d, EBAY: 0, WIX: 0, MANUAL: 0 });
  }
  for (const r of rows) {
    const entry = byDay.get(r.day);
    if (entry) entry[r.channel] = parseFloat(r.revenue);
  }
  return [...byDay.values()];
}

export async function getChannelSplit(days: number) {
  const from = new Date(Date.now() - days * DAY);
  const rows = await db
    .select({
      channel: orders.channel,
      revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      orders: count(),
    })
    .from(orders)
    .where(and(gte(orders.placedAt, from), notInArray(orders.status, NOT_COUNTED)))
    .groupBy(orders.channel);
  return rows.map((r) => ({
    channel: r.channel as ChannelName,
    revenue: parseFloat(r.revenue),
    orders: Number(r.orders),
  }));
}

export async function getAlerts() {
  const now = new Date();
  const [late] = await db
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.status, "PAID"), lte(orders.dispatchBy, now)));
  const [toShip] = await db
    .select({ n: count() })
    .from(orders)
    .where(inArray(orders.status, ["PAID", "PICKED", "PACKED"]));
  const lowStock = await db
    .select({ id: products.id, sku: products.sku, title: products.title, quantity: products.quantity })
    .from(products)
    .where(lte(products.quantity, products.lowStockAt))
    .orderBy(products.quantity)
    .limit(8);
  const failedSyncs = await db
    .select()
    .from(syncLogs)
    .where(and(eq(syncLogs.ok, false), gte(syncLogs.startedAt, new Date(now.getTime() - DAY))))
    .orderBy(desc(syncLogs.startedAt))
    .limit(5);
  return {
    lateDispatch: Number(late.n),
    toShip: Number(toShip.n),
    lowStock,
    failedSyncs,
  };
}

export type OrderFilters = {
  status?: OrderStatus;
  channel?: ChannelName;
  q?: string;
  page?: number;
};

export async function listOrders(f: OrderFilters = {}, pageSize = 50) {
  const where = [];
  if (f.status) where.push(eq(orders.status, f.status));
  if (f.channel) where.push(eq(orders.channel, f.channel));
  if (f.q) {
    const like = `%${f.q}%`;
    where.push(
      sql`(${orders.orderNumber} ilike ${like} or ${orders.buyerName} ilike ${like} or ${orders.buyerUsername} ilike ${like} or ${orders.shipPostcode} ilike ${like} or exists (select 1 from order_items oi where oi.order_id = ${orders.id} and (oi.title ilike ${like} or oi.external_sku ilike ${like})))`,
    );
  }
  const page = Math.max(1, f.page ?? 1);
  const rows = await db.query.orders.findMany({
    where: where.length ? and(...where) : undefined,
    orderBy: desc(orders.placedAt),
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
    columns: { raw: false },
    with: { items: true },
  });
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
}

export async function getConnections() {
  const accounts = await db
    .select({
      id: channelAccounts.id,
      channel: channelAccounts.channel,
      label: channelAccounts.label,
      externalAccountId: channelAccounts.externalAccountId,
      lastOrderSyncAt: channelAccounts.lastOrderSyncAt,
      refreshTokenExpiresAt: channelAccounts.refreshTokenExpiresAt,
    })
    .from(channelAccounts);
  const logs = await db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt)).limit(20);
  return { accounts, logs };
}
