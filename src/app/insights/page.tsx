import Link from "next/link";
import { format } from "date-fns";
import { Card, Empty } from "@/components/ui";
import { WeeklyChart } from "@/components/weekly-chart";
import { formatGBP } from "@/lib/money";
import { getInsights, type Bucket } from "@/lib/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RANGES = [30, 90, 180, 365];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 90;
  const d = await getInsights(days);
  const t = d.totals;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sales insights</h1>
          <p className="text-sm text-muted">What sells, for how much, and how often · last {days} days · all channels</p>
        </div>
        <div className="flex rounded-md border border-line p-0.5">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/insights?days=${r}`}
              className={`rounded px-3 py-1 text-xs ${r === days ? "bg-white/10 text-white" : "text-muted"}`}
            >
              {r === 365 ? "1 year" : `${r}d`}
            </Link>
          ))}
        </div>
      </header>

      {t.units === 0 ? (
        <Card>
          <Empty>No sales in this period yet.</Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Units sold" value={String(t.units)} />
            <Stat label="Revenue" value={formatGBP(t.revenue)} />
            <Stat label="Avg per unit" value={formatGBP(t.avg)} />
            <Stat label="Different parts" value={String(t.distinctParts)} />
            <Stat label="Sold more than once" value={String(t.repeatParts)} />
          </div>

          {t.missingSkuShare > 0.3 && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {Math.round(t.missingSkuShare * 100)}% of sales had no SKU, so the same part can show up under different
              titles. Adding a SKU (eBay “Custom label”) to your listings makes these numbers more accurate.
            </div>
          )}

          <Card title="Revenue per week">
            <WeeklyChart data={d.weekly} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Breakdown title="By make" rows={d.byMake} />
            <Breakdown
              title="By side"
              rows={d.bySide}
              note="UK cars: left = passenger, right = driver. Based on the listing title."
            />
            <Breakdown title="Top models (chassis code)" rows={d.byModel} limit={12} />
            <Breakdown title="By lighting technology" rows={d.byTech} />
            <Breakdown title="By price band" rows={d.byPriceBand} />
            <Breakdown title="By part type" rows={d.byPartType} />
          </div>

          <Breakdown title="By channel" rows={d.byChannel} />

          <Card title="Sold more than once">
            {d.repeatSellers.length === 0 ? (
              <Empty>No part sold more than once in this period.</Empty>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted">
                    <th className="pb-2 pr-3 font-medium">Part</th>
                    <th className="pb-2 pr-3 text-right font-medium">Sold</th>
                    <th className="pb-2 pr-3 text-right font-medium">Revenue</th>
                    <th className="pb-2 font-medium">Sale dates</th>
                  </tr>
                </thead>
                <tbody>
                  {d.repeatSellers.map((p) => (
                    <tr key={p.title + p.sku} className="border-t border-line align-top">
                      <td className="py-2 pr-3">
                        {p.title}
                        {p.sku && <div className="font-mono text-[11px] text-muted">{p.sku}</div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular">{p.units}</td>
                      <td className="py-2 pr-3 text-right tabular">{formatGBP(p.revenue)}</td>
                      <td className="py-2 text-xs text-muted">{p.dates.map((x) => format(x, "d MMM")).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Highest-value sales">
            <table className="w-full text-sm">
              <tbody>
                {d.topSales.map((s, i) => (
                  <tr key={i} className="border-t border-line first:border-0">
                    <td className="py-2 pr-3 tabular text-muted whitespace-nowrap">{format(s.placedAt, "d MMM")}</td>
                    <td className="py-2 pr-3">{s.title}</td>
                    <td className="py-2 text-right tabular">{formatGBP(s.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  limit,
  note,
}: {
  title: string;
  rows: Bucket[];
  limit?: number;
  note?: string;
}) {
  const shown = rows.slice(0, limit ?? rows.length);
  const max = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <Card title={title}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="pb-2 pr-3 font-medium"></th>
            <th className="pb-2 pr-3 text-right font-medium">Sold</th>
            <th className="pb-2 pr-3 text-right font-medium">Revenue</th>
            <th className="pb-2 pr-3 text-right font-medium">Avg</th>
            <th className="pb-2 text-right font-medium" title="Number of different weeks with at least one sale">
              Weeks
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.name} className="border-t border-line">
              <td className="py-2 pr-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className="tabular text-[11px] text-muted">{Math.round(r.share * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-white/5">
                  <div className="h-1.5 rounded bg-accent" style={{ width: `${(r.revenue / max) * 100}%` }} />
                </div>
              </td>
              <td className="py-2 pr-3 text-right tabular">{r.units}</td>
              <td className="py-2 pr-3 text-right tabular">{formatGBP(r.revenue)}</td>
              <td className="py-2 pr-3 text-right tabular text-muted">{formatGBP(r.avg)}</td>
              <td className="py-2 text-right tabular text-muted">{r.weeks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && rows.length > limit && <p className="mt-2 text-xs text-muted">+ {rows.length - limit} more</p>}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </Card>
  );
}
