import { NextResponse } from "next/server";
import { syncEbayListings } from "@/lib/ebay/listings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Refresh listing data from eBay (no ending/relisting). Also run by cron every 6 hours. */
export async function GET() {
  return NextResponse.json(await syncEbayListings());
}
export async function POST() {
  return NextResponse.json(await syncEbayListings());
}
