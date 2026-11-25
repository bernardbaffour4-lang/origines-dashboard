/**
 * Minimal client for eBay's Trading API (XML). Used for listing management
 * because listings created in Seller Hub can only be ended/relisted here.
 * Authenticates with the same OAuth user token as the REST APIs.
 */
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { getValidEbayToken } from "./auth";
import { ebayConfig } from "./config";

const COMPAT_LEVEL = "1193";
const SITE_ID_UK = "3";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false, // keep IDs like 1234567890123 as strings
  isArray: (name) => ["Item", "Errors", "Fee", "Variation"].includes(name),
});
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export type TradingError = { ShortMessage?: string; LongMessage?: string; ErrorCode?: string; SeverityCode?: string };

export class EbayTradingError extends Error {
  constructor(
    public call: string,
    public errors: TradingError[],
  ) {
    super(
      `${call}: ` +
        errors
          .filter((e) => e.SeverityCode !== "Warning")
          .map((e) => `${e.LongMessage ?? e.ShortMessage} (code ${e.ErrorCode})`)
          .join("; "),
    );
  }
}

export async function tradingCall<T = Record<string, unknown>>(
  call: string,
  body: Record<string, unknown>,
): Promise<T> {
  const cfg = ebayConfig();
  const { token } = await getValidEbayToken();
  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    builder.build({
      [`${call}Request`]: { "@_xmlns": "urn:ebay:apis:eBLBaseComponents", ...body },
    });

  const url = process.env.EBAY_TRADING_URL ?? `${cfg.apiBase}/ws/api.dll`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": SITE_ID_UK,
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    },
    body: xml,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${call} HTTP ${res.status}: ${text.slice(0, 300)}`);
  const parsed = parser.parse(text);
  const out = parsed[`${call}Response`];
  if (!out) throw new Error(`${call}: unexpected response ${text.slice(0, 300)}`);
  if (out.Ack === "Failure" || out.Ack === "PartialFailure") {
    throw new EbayTradingError(call, out.Errors ?? []);
  }
  return out as T;
}

// ---------- Typed helpers ----------

type Money = { "#text"?: string; "@_currencyID"?: string } | string;
const moneyValue = (m?: Money) => (typeof m === "string" ? m : m?.["#text"]) ?? null;
const int = (v: unknown) => (v == null || v === "" ? null : parseInt(String(v), 10));

export type ActiveListing = {
  itemId: string;
  title: string;
  sku: string | null;
  price: string | null;
  currency: string;
  quantityAvailable: number | null;
  quantitySold: number | null;
  watchCount: number;
  listingType: string; // FixedPriceItem, Chinese (auction), ...
  hasVariations: boolean;
  startTime: Date | null;
  viewUrl: string | null;
  imageUrl: string | null;
};

type RawItem = {
  ItemID: string;
  Title?: string;
  SKU?: string;
  Quantity?: string;
  QuantityAvailable?: string;
  WatchCount?: string;
  ListingType?: string;
  Variations?: { Variation?: unknown[] };
  ListingDetails?: { StartTime?: string; ViewItemURL?: string };
  SellingStatus?: { CurrentPrice?: Money; QuantitySold?: string };
  BuyItNowPrice?: Money;
  PictureDetails?: { GalleryURL?: string };
};

function mapItem(i: RawItem): ActiveListing {
  const price = i.SellingStatus?.CurrentPrice ?? i.BuyItNowPrice;
  const qtyAvail =
    int(i.QuantityAvailable) ??
    (int(i.Quantity) != null ? (int(i.Quantity) ?? 0) - (int(i.SellingStatus?.QuantitySold) ?? 0) : null);
  return {
    itemId: String(i.ItemID),
    title: i.Title ?? "",
    sku: i.SKU ? String(i.SKU) : null,
    price: moneyValue(price),
    currency: (typeof price === "object" && price?.["@_currencyID"]) || "GBP",
    quantityAvailable: qtyAvail,
    quantitySold: int(i.SellingStatus?.QuantitySold),
    watchCount: int(i.WatchCount) ?? 0,
    listingType: i.ListingType ?? "FixedPriceItem",
    hasVariations: Boolean(i.Variations?.Variation?.length),
    startTime: i.ListingDetails?.StartTime ? new Date(i.ListingDetails.StartTime) : null,
    viewUrl: i.ListingDetails?.ViewItemURL ?? null,
    imageUrl: i.PictureDetails?.GalleryURL ?? null,
  };
}

/** All active listings on the account (pages of 200). */
export async function getActiveListings(): Promise<ActiveListing[]> {
  const all: ActiveListing[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await tradingCall<{
      ActiveList?: {
        ItemArray?: { Item?: RawItem[] };
        PaginationResult?: { TotalNumberOfPages?: string };
      };
    }>("GetMyeBaySelling", {
      ActiveList: {
        Include: true,
        Pagination: { EntriesPerPage: 200, PageNumber: page },
      },
      DetailLevel: "ReturnAll",
    });
    const items = res.ActiveList?.ItemArray?.Item ?? [];
    all.push(...items.map(mapItem));
    const pages = int(res.ActiveList?.PaginationResult?.TotalNumberOfPages) ?? 1;
    if (page >= pages || items.length === 0) break;
  }
  return all;
}

export async function endFixedPriceItem(itemId: string) {
  try {
    await tradingCall("EndFixedPriceItem", { ItemID: itemId, EndingReason: "NotAvailable" });
  } catch (err) {
    // 1047 = "auction/listing already closed" — treat as already ended
    if (err instanceof EbayTradingError && err.errors.some((e) => e.ErrorCode === "1047")) return;
    throw err;
  }
}

/** Relists an ended fixed-price item. Returns the NEW item ID. */
export async function relistFixedPriceItem(itemId: string, quantity: number | null) {
  const item: Record<string, unknown> = { ItemID: itemId };
  if (quantity != null) item.Quantity = quantity;
  const res = await tradingCall<{ ItemID?: string }>("RelistFixedPriceItem", { Item: item });
  if (!res.ItemID) throw new Error("RelistFixedPriceItem returned no new ItemID");
  return String(res.ItemID);
}

/** Change the price of a live fixed-price listing. Same item number, watchers and history are kept. */
export async function reviseItemPrice(itemId: string, price: number, currency = "GBP") {
  await tradingCall("ReviseInventoryStatus", {
    InventoryStatus: {
      ItemID: itemId,
      StartPrice: { "#text": price.toFixed(2), "@_currencyID": currency },
    },
  });
}
