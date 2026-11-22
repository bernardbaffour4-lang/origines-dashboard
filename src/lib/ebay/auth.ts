import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { EBAY_SCOPES, ebayConfig } from "./config";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
};

function basicAuth() {
  const { clientId, clientSecret } = ebayConfig();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

/** URL to send the seller to so they can grant this app access. */
export function buildConsentUrl(state: string) {
  const cfg = ebayConfig();
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.ruName, // eBay uses the RuName here, not a URL
    response_type: "code",
    scope: EBAY_SCOPES.join(" "),
    state,
    prompt: "login",
  });
  // eBay's docs use %20 between scopes, so avoid URLSearchParams' "+"
  return `${cfg.authBase}/oauth2/authorize?${params.toString().replace(/\+/g, "%20")}`;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const cfg = ebayConfig();
  const res = await fetch(`${cfg.apiBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`eBay token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Exchange the one-time code from the callback for access + refresh tokens and store them. */
export async function exchangeCodeAndStore(code: string) {
  const cfg = ebayConfig();
  const tok = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.ruName,
    }),
  );
  const now = Date.now();
  const values = {
    channel: "EBAY" as const,
    label: cfg.accountLabel,
    accessToken: tok.access_token,
    accessTokenExpiresAt: new Date(now + tok.expires_in * 1000),
    refreshToken: tok.refresh_token ?? null,
    refreshTokenExpiresAt: tok.refresh_token_expires_in
      ? new Date(now + tok.refresh_token_expires_in * 1000)
      : null,
  };
  const [account] = await db
    .insert(schema.channelAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.channelAccounts.channel, schema.channelAccounts.label],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  // Record which eBay user connected (best effort)
  try {
    const res = await fetch(`${cfg.apizBase}/commerce/identity/v1/user/`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (res.ok) {
      const user = (await res.json()) as { username?: string };
      if (user.username) {
        await db
          .update(schema.channelAccounts)
          .set({ externalAccountId: user.username })
          .where(eq(schema.channelAccounts.id, account.id));
      }
    }
  } catch {
    /* non-fatal */
  }
  return account;
}

export async function getEbayAccount() {
  const cfg = ebayConfig();
  const [account] = await db
    .select()
    .from(schema.channelAccounts)
    .where(
      and(
        eq(schema.channelAccounts.channel, "EBAY"),
        eq(schema.channelAccounts.label, cfg.accountLabel),
      ),
    )
    .limit(1);
  return account ?? null;
}

/**
 * Returns a valid access token, refreshing it automatically when it is
 * within 5 minutes of expiry. eBay access tokens last ~2 hours;
 * refresh tokens last ~18 months.
 */
export async function getValidEbayToken(): Promise<{ token: string; accountId: string }> {
  const account = await getEbayAccount();
  if (!account?.refreshToken) {
    throw new Error("eBay is not connected. Visit /api/ebay/connect first.");
  }
  const fiveMin = 5 * 60 * 1000;
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() - Date.now() > fiveMin
  ) {
    return { token: account.accessToken, accountId: account.id };
  }
  if (account.refreshTokenExpiresAt && account.refreshTokenExpiresAt.getTime() < Date.now()) {
    throw new Error("eBay refresh token has expired. Reconnect via /api/ebay/connect.");
  }
  const tok = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      scope: EBAY_SCOPES.join(" "),
    }),
  );
  await db
    .update(schema.channelAccounts)
    .set({
      accessToken: tok.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tok.expires_in * 1000),
    })
    .where(eq(schema.channelAccounts.id, account.id));
  return { token: tok.access_token, accountId: account.id };
}

/** Authenticated fetch against eBay REST APIs. */
export async function ebayFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = ebayConfig();
  const { token } = await getValidEbayToken();
  const res = await fetch(`${cfg.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": cfg.marketplaceId,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`eBay ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
