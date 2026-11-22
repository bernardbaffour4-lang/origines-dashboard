import Link from "next/link";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Card, Empty } from "@/components/ui";
import { AutoRelistToggle, RefreshListingsButton, RunRelistButton } from "@/components/relist-controls";
import { formatGBP } from "@/lib/money";
import {
  getListingStats,
  getRelistLog,
  getRelistSettings,
  getStuckRelists,
  listListings,
  type ListingFilter,
} from "@/lib/listing-queries";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY = 24 * 60 * 60 * 1000;
const FILTERS: { key: ListingFilter; label: string }[] = [
  { key: "all", label: "All active" },
  { key: "due", label: "Due for relist" },
  { key: "soon", label: "Due in 3 days" },
  { key: "no_sku", label: "Missing SKU" },
  { key: "no_stock", label: "Out of stock" },
  { key: "variations", label: "Variations" },
  { key: "auctions", label: "Auctions" },
];

const STATUS_STYLE: Record<string, string> = {
  RELISTED: "text-emerald-400",
  ENDED: "text-rose-400 font-semibold",
  FAILED: "text-rose-400",
  PENDING: "text-amber-300",
  SKIPPED: "text-muted",
};

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const filter = (FILTERS.find((x) => x.key === sp.f)?.key ?? "all") as ListingFilter;
  const q = sp.q?.trim() || undefined;

  const stats = await getListingStats();
  const settings = await getRelistSettings();
  const stuck = await getStuckRelists();
  const rows = await listListings(filter, q);
  const log = await getRelistLog(40);
  const lastRun = settings.lastRun as { at?: string; relisted?: number; failed?: number; trigger?: string } | null;

  const countFor: Partial<Record<ListingFilter, number>> = {
    all: stats.active,
    due: stats.due,
    soon: stats.soon,
    no_sku: stats.noSku,
    no_stock: stats.noStock,
    variations: stats.variations,
    auctions: stats.auctions,
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Listings</h1>
          <p className="text-sm text-muted">
            eBay listing health · Buy It Now listings older than {stats.ageDays} days are ended and relisted every
            morning at 6am (UK time; 7am in summer)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AutoRelistToggle enabled={settings.enabled} />
          <RefreshListingsButton />
        </div>
      </header>

      {stuck.length > 0 && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">
          <div className="font-semibold text-rose-300">
            {stuck.length} listing{stuck.length === 1 ? " was" : "s were"} ended but not relisted — they are offline.
          </div>
          <div className="mt-1 text-rose-200/80">
            They are retried automatically on every run (up to 5 times). If one keeps failing, relist it from eBay
            Seller Hub → Unsold.
          </div>
          <ul className="mt-2 space-y-1">
            {stuck.map((s) => (
              <li key={s.id} className="text-rose-100">
                {s.title} <span className="font-mono text-xs text-rose-200/70">#{s.oldItemId}</span>
                <span className="block text-xs text-rose-200/70">{s.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active listings" value={stats.active} />
        <Stat label="Due for relist" value={stats.due} tone={stats.due ? "warn" : undefined} />
        <Stat label="Due in 3 days" value={stats.soon} />
        <Stat label="Relisted (7 days)" value={stats.relisted7} />
        <Stat label="Missing SKU" value={stats.noSku} tone={stats.noSku ? "warn" : undefined} />
        <Stat label="Out of stock" value={stats.noStock} tone={stats.noStock ? "warn" : undefined} />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/listings?f=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded-md px-3 py-1.5 text-xs ${
                  f.key === filter ? "bg-white/10 text-white" : "text-muted hover:bg-white/5"
                }`}
              >
                {f.label} <span className="tabular text-muted">{countFor[f.key] ?? 0}</span>
              </Link>
            ))}
          </div>
          <form action="/listings" className="flex w-full gap-2 sm:w-auto">
            <input type="hidden" name="f" value={filter} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search title, SKU, item no."
              className="w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm outline-none focus:border-accent sm:w-64"
            />
          </form>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {stats.active === 0
              ? "No listings yet — press “Refresh from eBay” to load them."
              : "No listings match this filter."}
          </Empty>
        ) : (
          <>
          {/* Phone: one card per listing */}
          <ul className="space-y-3 md:hidden">
            {rows.map((l) => {
              const age = l.startTime ? Math.floor((Date.now() - l.startTime.getTime()) / DAY) : null;
              const r = relistLabel(l, age, stats.ageDays);
              return (
                <li key={l.id} className="flex gap-3 rounded-lg border border-line p-3">
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded bg-white/5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <a href={l.viewUrl ?? "#"} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm">
                      {l.title}
                    </a>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span className="font-semibold text-white">{l.price ? formatGBP(l.price, l.currency) : "—"}</span>
                      <span className={(l.quantity ?? 0) <= 0 ? "text-amber-300" : ""}>Qty {l.quantity ?? "—"}</span>
                      <span>{l.watchCount ?? 0} watching</span>
                      <span>{age != null ? `${age} days` : "—"}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs">
                      <span className="font-mono text-muted">
                        {l.externalSku || <span className="font-sans text-amber-300">No SKU</span>}
                      </span>
                      <span className={r.cls}>{r.text}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Tablet / desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3 font-medium">Listing</th>
                  <th className="pb-2 pr-3 font-medium">SKU</th>
                  <th className="pb-2 pr-3 text-right font-medium">Price</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qty</th>
                  <th className="pb-2 pr-3 text-right font-medium">Sold</th>
                  <th className="pb-2 pr-3 text-right font-medium">Watchers</th>
                  <th className="pb-2 pr-3 font-medium">Age</th>
                  <th className="pb-2 font-medium">Relist</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const age = l.startTime ? Math.floor((Date.now() - l.startTime.getTime()) / DAY) : null;
                  const relist = relistLabel(l, age, stats.ageDays);
                  return (
                    <tr key={l.id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-3">
                        <div className="flex gap-3">
                          {l.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                          ) : (
                            <div className="h-10 w-10 shrink-0 rounded bg-white/5" />
                          )}
                          <div className="min-w-0">
                            <a
                              href={l.viewUrl ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="line-clamp-2 hover:text-accent"
                            >
                              {l.title}
                            </a>
                            <div className="font-mono text-[11px] text-muted">#{l.externalId}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">
                        {l.externalSku || <span className="font-sans text-amber-300">missing</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular">{l.price ? formatGBP(l.price, l.currency) : "—"}</td>
                      <td className={`py-2.5 pr-3 text-right tabular ${(l.quantity ?? 0) <= 0 ? "text-amber-300" : ""}`}>
                        {l.quantity ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular">{l.quantitySold ?? 0}</td>
                      <td className="py-2.5 pr-3 text-right tabular">{l.watchCount ?? 0}</td>
                      <td className="py-2.5 pr-3 tabular text-muted whitespace-nowrap">{age != null ? `${age} days` : "—"}</td>
                      <td className={`py-2.5 text-xs whitespace-nowrap ${relist.cls}`}>{relist.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 200 && <p className="mt-3 text-xs text-muted">Showing the oldest 200 — use search to narrow down.</p>}
          </>
        )}
      </Card>

      <Card
        title="End & relist history"
        action={
          <div className="flex items-center gap-4">
            {lastRun?.at && (
              <span className="text-xs text-muted">
                Last run {formatDistanceToNowStrict(new Date(lastRun.at))} ago ({lastRun.trigger === "MANUAL" ? "manual" : "automatic"})
              </span>
            )}
            <RunRelistButton due={stats.due} />
          </div>
        }
      >
        {log.length === 0 ? (
          <Empty>Nothing relisted yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 pr-3 font-medium">When</th>
                <th className="pb-2 pr-3 font-medium">Listing</th>
                <th className="pb-2 pr-3 font-medium">Old → new item no.</th>
                <th className="pb-2 pr-3 font-medium">Result</th>
                <th className="pb-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 tabular text-muted whitespace-nowrap">{format(r.updatedAt, "dd MMM HH:mm")}</td>
                  <td className="py-2 pr-3 max-w-xs truncate">{r.title}</td>
                  <td className="py-2 pr-3 font-mono text-xs">
                    {r.oldItemId}
                    {r.newItemId && <> → {r.newItemId}</>}
                  </td>
                  <td className={`py-2 pr-3 text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
                    {r.status === "ENDED" ? "ENDED — NOT RELISTED" : r.status}
                  </td>
                  <td className="py-2 text-xs text-muted">{r.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function relistLabel(
  l: { listingType: string | null; hasVariations: boolean; quantity: number | null },
  age: number | null,
  ageDays: number,
): { text: string; cls: string } {
  const daysLeft = age != null ? ageDays - age : null;
  if (l.listingType !== "FixedPriceItem") return { text: "Auction — not relisted", cls: "text-muted" };
  if (l.hasVariations) return { text: "Variations — skipped", cls: "text-muted" };
  if ((l.quantity ?? 0) <= 0) return { text: "No stock — skipped", cls: "text-muted" };
  if (daysLeft != null && daysLeft <= 0) return { text: "Due next run", cls: "text-amber-300" };
  return { text: daysLeft != null ? `Relist in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "—", cls: "text-muted" };
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular ${tone === "warn" ? "text-amber-300" : ""}`}>{value}</div>
    </div>
  );
}
