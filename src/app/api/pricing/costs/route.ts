import { NextRequest, NextResponse } from "next/server";
import { importCosts } from "@/lib/pricing/costs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upload the costs CSV (raw text body). */
export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > 5_000_000) return NextResponse.json({ error: "File too large" }, { status: 413 });
  return NextResponse.json(await importCosts(text));
}
