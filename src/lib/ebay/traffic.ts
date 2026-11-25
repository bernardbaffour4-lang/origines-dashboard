/**
 * Listing views from eBay's Analytics API (traffic report).
 * Best-effort: if eBay refuses or the format changes, we return what we have
 * and the pricing engine simply treats views as "unknown".
 */
import { format, subDays } from "date-fns";
import { ebayConfig } from "./config";
import { ebayFetch } from "./auth";

type TrafficReport = {
  records?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: number | string }[] }[];
};

/** Views over the last 30 days, keyed by eBay item number. */
export async function getListingViews30d(itemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { marketplaceId } = ebayConfig();
  const end = subDays(new Date(), 1);
  const start = subDays(end, 29);
  const range = `${format(start, "yyyyMMdd")}..${format(end, "yyyyMMdd")}`;

  for (let i = 0; i < itemIds.length; i += 200) {
    const batch = itemIds.slice(i, i + 200);
    const filter = `marketplace_ids:{${marketplaceId}},date_range:[${range}],listing_ids:{${batch.join("|")}}`;
    const qs = new URLSearchParams({ dimension: "LISTING", metric: "LISTING_VIEWS_TOTAL", filter });
    const res = await ebayFetch<TrafficReport>(`/sell/analytics/v1/traffic_report?${qs}`);
    for (const r of res.records ?? []) {
      const id = r.dimensionValues?.[0]?.value;
      const v = Number(r.metricValues?.[0]?.value);
      if (id && Number.isFinite(v)) out.set(String(id), v);
    }
    // Listings with no traffic at all may be missing from the report: that means 0 views
    for (const id of batch) if (!out.has(id)) out.set(id, 0);
  }
  return out;
}
