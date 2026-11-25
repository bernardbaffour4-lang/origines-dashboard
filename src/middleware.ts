import { NextRequest, NextResponse } from "next/server";

/**
 * Simple protection for the whole dashboard (it holds customer addresses).
 * - Browser: HTTP Basic auth with DASHBOARD_USER / DASHBOARD_PASSWORD.
 * - Cron: `Authorization: Bearer <CRON_SECRET>` on /api/sync.
 * - /api/ebay/callback stays open so eBay can redirect back (it is
 *   protected by the OAuth state cookie instead).
 * Replace with proper auth (e.g. Auth.js / Clerk) when you add staff accounts.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/ebay/callback")) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";

  const cronSecret = process.env.CRON_SECRET;
  const cronPaths = ["/api/sync", "/api/relist", "/api/listings/sync", "/api/pricing/run"];
  if (cronPaths.some((p) => pathname.startsWith(p)) && cronSecret && auth === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  const user = process.env.DASHBOARD_USER ?? "admin";
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) {
    return new NextResponse("Set DASHBOARD_PASSWORD in your environment to use the dashboard.", {
      status: 503,
    });
  }
  if (auth.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Origines Dashboard"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
