import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeAndStore } from "@/lib/ebay/auth";

export const dynamic = "force-dynamic";

/**
 * Step 2: eBay redirects here (your RuName's "auth accepted URL")
 * with ?code=...&state=...
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = req.cookies.get("ebay_oauth_state")?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/settings?ebay=declined", url));
  }
  if (!state || state !== expected) {
    return NextResponse.redirect(new URL("/settings?ebay=bad_state", url));
  }
  try {
    await exchangeCodeAndStore(code);
    const res = NextResponse.redirect(new URL("/settings?ebay=connected", url));
    res.cookies.delete("ebay_oauth_state");
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.redirect(new URL("/settings?ebay=error", url));
  }
}
