import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Card, Empty } from "@/components/ui";
import { CostUpload, PricingModeSwitch, RunPricingButton } from "@/components/pricing-controls";
import { formatGBP } from "@/lib/money";
import { PRICING } from "@/lib/pricing/config";
import type { PricingAction } from "@/lib/pricing/engine";
import { buildPlan, getPricingLog, getPricingMode, type PlanRow } from "@/lib/pricing/run";
import { SETTINGS, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTION: Record<PricingAction, { label: string; cls: string }> = {
  HOLD_NEW: { label: "Not dead stock yet", cls: "text-muted" },
  HOLD: { label: "Hold", cls: "text-muted" },
  REDUCE: { label: "Price cut", cls: "text-amber-300" },
  FIX_LISTING: { label: "Fix the listing", cls: "text-sky-300" },
  SEND_OFFER: { label: "Send offer to watchers", cls: "text-violet-300" },
  LIQUIDATE: { label: "Liquidate", cls: "text-rose-300" },
};

const FILTERS = [
  { key: "dead", label: "Dead stock" },
  { key: "changes", label: "Price changes now" },
  { key: "todo", label: "Your to-do" },
  { key: "all", label: "All tracked" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const LOG_STYLE: Record<string, string> = {
  BASE_CUT: "text-amber-300",
  FLASH_ON: "text-emerald-300",
  FLASH_OFF: "text-muted",
  MANUAL_CHANGE: "text-sky-300",
  ERROR: "text-rose-400 font-semibold",
};

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const filter = (FILTERS.find((x) => x.key === sp.f)?.key ?? "dead") as FilterKey;

  const now = new Date();
  const [mode, plan, log, lastRun] = await Promise.all([
    getPricingMode(),
    buildPlan(now),
    getPricingLog(40),
    getSetting<{ at?: string; changed?: number; trigger?: string; errors?: string[] } | null>(SETTINGS.lastPricingRun, null),
  ]);

  const dead = plan.rows.filter((r) => r.result.action !== "HOLD_NEW");
  const changes = plan.rows.filter((r) => r.willChangeEbay);
  const todo = plan.rows.filter((r) => ["FIX_LISTING", "SEND_OFFER", "LIQUIDATE"].includes(r.result.action));
  const rows = { dead, changes, todo, all: plan.rows }[filter];
  const counts: Record<FilterKey, number> = { dead: dead.length, changes: changes.length, todo: todo.length, all: plan.rows.length };
  const flashNow = plan.rows.find((r) => r.result.flash)?.result.flash;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dead-stock pricing</h1>
          <p className="max-w-2xl text-sm text-muted">
            Items unsold for {PRICING.ageLadder[0][0]}+ days are marked down step by step, with an extra flash discount in
            peak UK evenings. Never below a {Math.round(PRICING.minMargin * 100)}% net margin after{" "}
            {Math.round(PRICING.vatRate * 100)}% VAT, eBay fees and postage (break-even after {PRICING.liquidationAgeDays} days).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PricingModeSwitch mode={mode} />
          <RunPricingButton mode={mode} />
        </div>
      </header>

      <ModeBanner mode={mode} changes={changes.length} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Tracked SKUs" value={plan.rows.length} />
        <Stat label="Dead stock" value={dead.length} tone={dead.length ? "warn" : undefined} />
        <Stat label="Price changes now" value={changes.length} />
        <Stat label="Offers to send" value={plan.rows.filter((r) => r.result.action === "SEND_OFFER").length} />
        <Stat label="Listings to fix" value={plan.rows.filter((r) => r.result.action === "FIX_LISTING").length} />
        <Stat label="Missing cost" value={plan.missingCost.length} tone={plan.missingCost.length ? "warn" : undefined} />
      </div>

      <Card title="Your costs">
        <p className="mb-3 text-sm text-muted">
          The engine needs each SKU&apos;s cost (without VAT) and postage to work out your floor price. Download the sheet
          — it lists every SKU you have live on eBay — fill in <strong>cost</strong> and <strong>postage</strong>, and
          ideally <strong>stocked_since</strong> (date you first listed it; otherwise it&apos;s estimated from eBay). Save
          as CSV and upload. Set <strong>enabled</strong> to &quot;no&quot; for anything the engine should never touch.
        </p>
        <CostUpload />
        {plan.missingCost.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-amber-300">
              {plan.missingCost.length} live SKU{plan.missingCost.length === 1 ? " has" : "s have"} no cost yet — not priced
            </summary>
            <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs text-muted">
              {plan.missingCost.map((m) => (
                <li key={m.sku}>
                  <span className="font-mono">{m.sku}</span> · {m.title} · {m.price != null ? formatGBP(m.price) : "—"}
                </li>
              ))}
            </ul>
          </details>
        )}
        {plan.noSku > 0 && (
          <p className="mt-3 text-xs text-muted">
            {plan.noSku} eBay listing{plan.noSku === 1 ? " has" : "s have"} no SKU (Custom label) and can&apos;t be
            priced — add one in Seller Hub.
          </p>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/pricing?f=${f.key}`}
                className={`rounded-md px-3 py-1.5 text-xs ${f.key === filter ? "bg-white/10 text-white" : "text-muted hover:bg-white/5"}`}
              >
                {f.label} <span className="tabular text-muted">{counts[f.key]}</span>
              </Link>
            ))}
          </div>
          <span className="text-xs text-muted">
            {flashNow ? `Flash pricing on now: ${flashNow.label}` : "No flash window right now"} · UK time {ukTime(now, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {plan.rows.length === 0
              ? "Nothing tracked yet — upload your costs above."
              : filter === "dead"
                ? "No dead stock — nothing has been unsold for 90 days."
                : "Nothing in this list right now."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 text-right font-medium">Unsold</th>
                  <th className="pb-2 pr-3 text-right font-medium">eBay now</th>
                  <th className="pb-2 pr-3 text-right font-medium">Base</th>
                  <th className="pb-2 pr-3 text-right font-medium">Live price</th>
                  <th className="pb-2 pr-3 text-right font-medium">Floor</th>
                  <th className="pb-2 pr-3 text-right font-medium">Margin</th>
                  <th className="pb-2 pr-3 text-right font-medium">Watch / views</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.sku} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Price change history"
        action={
          lastRun?.at ? (
            <span className="text-xs text-muted">
              Last run {formatDistanceToNowStrict(new Date(lastRun.at))} ago ({lastRun.trigger === "MANUAL" ? "manual" : "automatic"})
            </span>
          ) : undefined
        }
      >
        {log.length === 0 ? (
          <Empty>No prices changed yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3 font-medium">When</th>
                  <th className="pb-2 pr-3 font-medium">Item</th>
                  <th className="pb-2 pr-3 font-medium">Change</th>
                  <th className="pb-2 pr-3 text-right font-medium">Price</th>
                  <th className="pb-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3 tabular whitespace-nowrap text-muted">{ukTime(l.createdAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="max-w-xs py-2 pr-3">
                      <div className="truncate">{l.title}</div>
                      <div className="font-mono text-[11px] text-muted">{l.sku}</div>
                    </td>
                    <td className={`py-2 pr-3 text-xs ${LOG_STYLE[l.kind] ?? ""}`}>{l.kind.replace("_", " ").toLowerCase()}</td>
                    <td className="py-2 pr-3 text-right tabular whitespace-nowrap">
                      {l.oldPrice && <span className="text-muted">{formatGBP(l.oldPrice)} → </span>}
                      {l.newPrice ? formatGBP(l.newPrice) : "—"}
                    </td>
                    <td className="py-2 text-xs text-muted">{l.note}</td>
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

const ukTime = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts }).format(d);

function Row({ r }: { r: PlanRow }) {
  const a = ACTION[r.result.action];
  const res = r.result;
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2.5 pr-3">
        <div className="flex gap-3">
          {r.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded bg-white/5" />
          )}
          <div className="min-w-0 max-w-xs">
            <a href={r.viewUrl ?? "#"} target="_blank" rel="noreferrer" className="line-clamp-2 hover:text-accent">
              {r.title}
            </a>
            <div className="font-mono text-[11px] text-muted">{r.sku}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 pr-3 text-right tabular whitespace-nowrap">
        {r.ageDays}d{r.ageEstimated && <span className="text-muted" title="Estimated — add stocked_since in the cost sheet">*</span>}
      </td>
      <td className="py-2.5 pr-3 text-right tabular">{formatGBP(r.ebayPrice, r.currency)}</td>
      <td className={`py-2.5 pr-3 text-right tabular ${res.newBase < r.base - 0.005 ? "text-amber-300" : ""}`}>
        {formatGBP(res.newBase, r.currency)}
      </td>
      <td className={`py-2.5 pr-3 text-right tabular font-medium ${r.willChangeEbay ? "text-white" : "text-muted"}`}>
        {formatGBP(res.livePrice, r.currency)}
      </td>
      <td className="py-2.5 pr-3 text-right tabular text-muted">{formatGBP(res.floor, r.currency)}</td>
      <td className={`py-2.5 pr-3 text-right tabular ${res.marginAtBase < PRICING.minMargin ? "text-amber-300" : ""}`}>
        {Math.round(res.marginAtBase * 100)}%
      </td>
      <td className="py-2.5 pr-3 text-right tabular text-muted whitespace-nowrap">
        {r.watchers} / {r.views30d ?? "—"}
      </td>
      <td className="py-2.5 text-xs">
        <div className={a.cls}>
          {a.label}
          {res.offerPrice != null && <> at {formatGBP(res.offerPrice, r.currency)}</>}
        </div>
        {res.action === "FIX_LISTING" && (
          <div className="text-muted">Few views: add OE part numbers to the title, fitment table, better photos</div>
        )}
        {res.action === "LIQUIDATE" && <div className="text-muted">Bundle it, or offer to trade/breakers</div>}
        {res.offerAccept != null && res.action !== "HOLD_NEW" && (
          <div className="text-muted">
            Best Offer: accept ≥ {formatGBP(res.offerAccept)}, decline &lt; {formatGBP(res.offerDecline!)}
          </div>
        )}
        {r.manualChange && <div className="text-sky-300">You changed this price — taken as the new base</div>}
        {res.notes.map((n) => (
          <div key={n} className="text-muted">
            {n}
          </div>
        ))}
      </td>
    </tr>
  );
}

function ModeBanner({ mode, changes }: { mode: "OFF" | "PREVIEW" | "LIVE"; changes: number }) {
  if (mode === "LIVE")
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
        <strong>Live.</strong> eBay prices are updated automatically every 15 minutes. If you change a price yourself on
        eBay, the dashboard takes your price as the new starting point.
      </div>
    );
  if (mode === "PREVIEW")
    return (
      <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
        <strong>Preview — nothing is changed on eBay.</strong> This page shows what the engine <em>would</em> do
        {changes ? ` (${changes} price change${changes === 1 ? "" : "s"} right now)` : ""}. Check the numbers, then switch
        to Live.
      </div>
    );
  return (
    <div className="rounded-lg border border-line bg-white/5 px-4 py-3 text-sm text-muted">
      <strong>Off.</strong> The engine does nothing. Switch to Preview to see what it would do.
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular ${tone === "warn" ? "text-amber-300" : ""}`}>{value}</div>
    </div>
  );
}
