export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export function ebayConfig() {
  const sandbox = (process.env.EBAY_ENV ?? "production").toLowerCase() === "sandbox";
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !clientSecret || !ruName) {
    throw new Error("Missing EBAY_CLIENT_ID, EBAY_CLIENT_SECRET or EBAY_RUNAME in environment");
  }
  return {
    clientId,
    clientSecret,
    ruName,
    sandbox,
    marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? "EBAY_GB",
    authBase: sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
    apiBase: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
    apizBase: sandbox ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com",
    accountLabel: sandbox ? "eBay Sandbox" : "eBay UK",
  };
}
