import { NextResponse } from "next/server";
import { runPricing } from "@/lib/pricing/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron calls this every 15 minutes (see vercel.json). Does nothing when pricing is OFF. */
export async function GET() {
  return NextResponse.json(await runPricing({ trigger: "CRON" }));
}

/** "Run now" button on the Pricing page. */
export async function POST() {
  return NextResponse.json(await runPricing({ trigger: "MANUAL" }));
}
