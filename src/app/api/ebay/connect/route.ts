import { NextRequest, NextResponse } from "next/server";
import { buildConsentUrl } from "@/lib/ebay/auth";

export const dynamic = "force-dynamic";

/** Step 1: send the seller to eBay's consent page. */
export async function GET(req: NextRequest) {
  const state = crypto.randomUUID();
  let consentUrl: string;
  try {
    consentUrl = buildConsentUrl(state);
  } catch {
    return NextResponse.redirect(new URL("/settings?ebay=config", req.nextUrl));
  }
  const res = NextResponse.redirect(consentUrl);
  res.cookies.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
