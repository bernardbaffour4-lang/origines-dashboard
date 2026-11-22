import { NextRequest, NextResponse } from "next/server";
import { syncEbayOrders } from "@/lib/ebay/orders";
import { syncWixOrders } from "@/lib/wix/orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs all channel syncs. Call it from a cron (Vercel Cron, GitHub Actions,
 * cron-job.org...) every 10–15 minutes with:
 *   Authorization: Bearer <CRON_SECRET>
 * The "Sync now" button in the dashboard calls it too (it is covered by
 * the dashboard login).
 */
export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const only = req.nextUrl.searchParams.get("channel");
  const results: Record<string, unknown> = {};
  if (!only || only === "ebay") results.ebay = await syncEbayOrders();
  if (!only || only === "wix") results.wix = await syncWixOrders();
  return NextResponse.json(results);
}
