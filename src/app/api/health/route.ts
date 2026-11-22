import { NextResponse } from "next/server";
import { rawClient } from "@/db";
import { getAlerts, getChannelSplit, getDailyRevenue, getKpis, listOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer after ${ms / 1000}s`)), ms),
    ),
  ]);

async function timed(fn: () => Promise<unknown>, ms = 8000) {
  const t0 = Date.now();
  try {
    await withTimeout(fn(), ms);
    return `ok (${Date.now() - t0}ms)`;
  } catch (err) {
    return `FAILED after ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Open /api/health in the browser to check the database connection.
 * Shows which database host/port is configured (never the password),
 * then times each dashboard query one by one, then several at once.
 */
export async function GET() {
  const url = process.env.DATABASE_URL;
  let target = "DATABASE_URL is NOT set";
  if (url) {
    try {
      const u = new URL(url);
      target = `${u.username}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
    } catch {
      target = "DATABASE_URL is set but is not a valid address";
    }
  }
  const result: Record<string, unknown> = {
    database: target,
    vercelRegion: process.env.VERCEL_REGION ?? "local",
  };

  result.connect = await timed(() => rawClient`select 1`, 15000);
  if (!String(result.connect).startsWith("ok")) {
    return NextResponse.json(result, { status: 500 });
  }

  // 1) Each Overview query on its own
  result.oneAtATime = {
    kpis: await timed(() => getKpis(30)),
    dailyRevenue: await timed(() => getDailyRevenue(30)),
    channelSplit: await timed(() => getChannelSplit(30)),
    alerts: await timed(() => getAlerts()),
    latestOrders: await timed(() => listOrders({}, 8)),
  };

  // 2) Several simple queries at the same time
  result.allAtOnce = await timed(
    () => Promise.all([1, 2, 3, 4, 5, 6].map(() => rawClient`select 1`)),
    8000,
  );

  return NextResponse.json(result);
}
