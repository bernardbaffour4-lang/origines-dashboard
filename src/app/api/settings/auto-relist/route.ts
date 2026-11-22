import { NextRequest, NextResponse } from "next/server";
import { SETTINGS, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Switch automatic relisting on or off: POST { "enabled": true | false } */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  await setSetting(SETTINGS.autoRelist, body.enabled);
  return NextResponse.json({ enabled: body.enabled });
}
