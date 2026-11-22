import { NextResponse } from "next/server";
import { runRelist } from "@/lib/ebay/listings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron calls this with GET every morning (see vercel.json). Respects the on/off switch. */
export async function GET() {
  return NextResponse.json(await runRelist({ trigger: "CRON" }));
}

/** "Run now" button on the Listings page. Runs even if auto-relist is switched off. */
export async function POST() {
  return NextResponse.json(await runRelist({ trigger: "MANUAL" }));
}
