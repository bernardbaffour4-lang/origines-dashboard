import Link from "next/link";
import { format } from "date-fns";
import { Card, ChannelBadge, Empty, Kpi, StatusBadge } from "@/components/ui";
import { RevenueChart } from "@/components/revenue-chart";
import { SyncButton } from "@/components/sync-button";
import { formatGBP } from "@/lib/money";
import { getAlerts, getChannelSplit, getDailyRevenue, getKpis, listOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];
const pct = (a: number, b: number) => (b === 0 ? null : (a - b) / b);

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;

  const [kpis, daily, split, alerts, recent] = await Promise.all([
    getKpis(days),
    getDailyRevenue(days),
    getChannelSplit(days),
    getAlerts(),
    listOrders({}, 8),
  ]);
  const { current: c, previous: p } = kpis;
  const net = c.revenue - c.fees;
  const totalSplit = split.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-sm text-muted">All channels · last {days} days</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex rounded-md border border-line p-0.5">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/?days=${r}`}
                className={`rounded px-3 py-1 text-xs ${r === days ? "bg-white/10 text-white" : "text-muted"}`}
              >
                {r}d
              </Link>
            ))}
          </div>
          <SyncButton />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Revenue" value={formatGBP(c.revenue)} delta={pct(c.revenue, p.revenue)} />
        <Kpi label="Orders" value={String(c.orders)} delta={pct(c.orders, p.orders)} />
        <Kpi label="Avg order value" value={formatGBP(c.aov)} delta={pct(c.aov, p.aov)} />
        <Kpi
          label="Revenue after channel fees"
          value={formatGBP(net)}
          delta={pct(net, p.revenue - p.fees)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Daily revenue by channel" className="lg:col-span-2">
          <RevenueChart data={daily} />
        </Card>

        <Card title="Needs attention">
          <ul className="space-y-3 text-sm">
            <AlertRow
              tone={alerts.lateDispatch ? "bad" : "ok"}
              label="Past dispatch date"
              value={alerts.lateDispatch}
              href="/orders?status=PAID"
            />
            <AlertRow
              tone={alerts.toShip ? "warn" : "ok"}
              label="Orders to ship"
              value={alerts.toShip}
              href="/orders?status=PAID"
            />
            <AlertRow
              tone={alerts.lowStock.length ? "warn" : "ok"}
              label="Low-stock products"
              value={alerts.lowStock.length}
            />
            <AlertRow
              tone={alerts.failedSyncs.length ? "bad" : "ok"}
              label="Failed syncs (24h)"
              value={alerts.failedSyncs.length}
              href="/settings"
            />
          </ul>
          {alerts.lowStock.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Low stock</div>
              <ul className="space-y-1.5 text-sm">
                {alerts.lowStock.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span className="truncate">{s.title}</span>
                    <span className="tabular text-muted">{s.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Channel split">
          {split.length === 0 ? (
            <Empty>No sales in this period yet.</Empty>
          ) : (
            <ul className="space-y-4">
              {split.map((s) => {
                const share = totalSplit ? s.revenue / totalSplit : 0;
                return (
                  <li key={s.channel}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <ChannelBadge channel={s.channel} />
                      <span className="tabular">
                        {formatGBP(s.revenue)} <span className="text-muted">· {s.orders} orders</span>
                      </span>
                    </div>
                    <div className="h-2 rounded bg-white/5">
                      <div
                        className={`h-2 rounded ${s.channel === "EBAY" ? "bg-ebay" : s.channel === "WIX" ? "bg-wix" : "bg-gray-400"}`}
                        style={{ width: `${(share * 100).toFixed(1)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Latest orders"
          className="lg:col-span-2"
          action={
            <Link href="/orders" className="text-xs text-accent hover:underline">
              View all
            </Link>
          }
        >
          {recent.rows.length === 0 ? (
            <Empty>
              No orders yet. Connect your channels in{" "}
              <Link className="text-accent" href="/settings">
                Connections
              </Link>
              , then press Sync now.
            </Empty>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recent.rows.map((o) => (
                  <tr key={o.id} className="border-t border-line first:border-0">
                    <td className="py-2 pr-3 text-muted tabular">{format(o.placedAt, "dd MMM HH:mm")}</td>
                    <td className="py-2 pr-3">
                      <ChannelBadge channel={o.channel} />
                    </td>
                    <td className="py-2 pr-3 truncate max-w-xs">{o.items[0]?.title ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="py-2 text-right tabular">{formatGBP(o.total, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function AlertRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad";
  href?: string;
}) {
  const dot = tone === "bad" ? "bg-rose-500" : tone === "warn" ? "bg-amber-400" : "bg-emerald-500";
  const inner = (
    <span className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="tabular font-medium">{value}</span>
    </span>
  );
  return <li>{href ? <Link href={href} className="block hover:text-white">{inner}</Link> : inner}</li>;
}
