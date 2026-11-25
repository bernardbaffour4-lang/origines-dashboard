import { NextRequest, NextResponse } from "next/server";
import { SETTINGS, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Set pricing mode: POST { "mode": "OFF" | "PREVIEW" | "LIVE" } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
  if (body.mode !== "OFF" && body.mode !== "PREVIEW" && body.mode !== "LIVE") {
    return NextResponse.json({ error: "mode must be OFF, PREVIEW or LIVE" }, { status: 400 });
  }
  await setSetting(SETTINGS.pricingMode, body.mode);
  return NextResponse.json({ mode: body.mode });
}
