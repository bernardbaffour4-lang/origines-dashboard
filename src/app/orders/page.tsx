import Link from "next/link";
import { format } from "date-fns";
import { Card, ChannelBadge, Empty, StatusBadge } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { channelEnum, orderStatusEnum, type ChannelName, type OrderStatus } from "@/db/schema";
import { formatGBP } from "@/lib/money";
import { listOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";

type SP = { status?: string; channel?: string; q?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = (orderStatusEnum.enumValues as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as OrderStatus)
    : undefined;
  const channel = (channelEnum.enumValues as readonly string[]).includes(sp.channel ?? "")
    ? (sp.channel as ChannelName)
    : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, hasMore } = await listOrders({ status, channel, q: sp.q?.trim() || undefined, page });

  const link = (over: Partial<SP>) => {
    const params = new URLSearchParams();
    const merged = { status: sp.status, channel: sp.channel, q: sp.q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/orders?${params}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="text-sm text-muted">eBay and website orders in one list</p>
        </div>
        <SyncButton />
      </header>

      <Card>
        <form className="mb-4 flex flex-wrap gap-3" action="/orders">
          <input
            name="q"
            defaultValue={sp.q}
            placeholder="Search order no., buyer, postcode, SKU, part…"
            className="w-full flex-1 rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-accent sm:w-auto sm:min-w-64"
          />
          <select
            name="channel"
            defaultValue={sp.channel ?? ""}
            className="rounded-md border border-line bg-ink px-3 py-2 text-sm"
          >
            <option value="">All channels</option>
            <option value="EBAY">eBay</option>
            <option value="WIX">Website</option>
            <option value="MANUAL">Manual</option>
          </select>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="rounded-md border border-line bg-ink px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {orderStatusEnum.enumValues.map((s) => (
              <option key={s} value={s}>
                {s === "PAID" ? "To ship (paid)" : s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </select>
          <button className="rounded-md border border-line px-4 py-2 text-sm hover:bg-white/5">
            Filter
          </button>
        </form>

        {rows.length === 0 ? (
          <Empty>No orders match.</Empty>
        ) : (
          <>
          {/* Phone: one card per order */}
          <ul className="space-y-3 md:hidden">
            {rows.map((o) => {
              const late = o.status === "PAID" && o.dispatchBy && o.dispatchBy.getTime() < Date.now();
              return (
                <li key={o.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ChannelBadge channel={o.channel} />
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="font-semibold tabular">{formatGBP(o.total, o.currency)}</div>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    {o.items.map((i) => (
                      <div key={i.id} className="line-clamp-2">
                        {i.quantity > 1 && <span className="text-muted">{i.quantity}× </span>}
                        {i.title}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted">
                    <span>
                      {o.buyerName ?? o.buyerUsername ?? "—"}
                      {o.shipPostcode ? ` · ${o.shipPostcode}` : ""}
                    </span>
                    <span className="tabular">{format(o.placedAt, "dd MMM HH:mm")}</span>
                  </div>
                  {o.dispatchBy && o.status === "PAID" && (
                    <div className={`mt-1 text-xs ${late ? "text-rose-400" : "text-muted"}`}>
                      Dispatch by {format(o.dispatchBy, "dd MMM")}
                      {late ? " — late" : ""}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-[11px] text-muted">{o.orderNumber ?? o.externalId}</div>
                </li>
              );
            })}
          </ul>

          {/* Tablet / desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3 font-medium">Placed</th>
                  <th className="pb-2 pr-3 font-medium">Order</th>
                  <th className="pb-2 pr-3 font-medium">Channel</th>
                  <th className="pb-2 pr-3 font-medium">Items</th>
                  <th className="pb-2 pr-3 font-medium">Buyer</th>
                  <th className="pb-2 pr-3 font-medium">Dispatch by</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const late =
                    o.status === "PAID" && o.dispatchBy && o.dispatchBy.getTime() < Date.now();
                  return (
                    <tr key={o.id} className="border-t border-line align-top">
                      <td className="py-2.5 pr-3 tabular text-muted whitespace-nowrap">
                        {format(o.placedAt, "dd MMM yy HH:mm")}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs">{o.orderNumber ?? o.externalId}</td>
                      <td className="py-2.5 pr-3">
                        <ChannelBadge channel={o.channel} />
                      </td>
                      <td className="py-2.5 pr-3 max-w-sm">
                        {o.items.map((i) => (
                          <div key={i.id} className="truncate">
                            {i.quantity > 1 && <span className="text-muted">{i.quantity}× </span>}
                            {i.title}
                            {i.externalSku && (
                              <span className="ml-2 font-mono text-[11px] text-muted">{i.externalSku}</span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div>{o.buyerName ?? o.buyerUsername ?? "—"}</div>
                        <div className="text-xs text-muted">
                          {[o.shipPostcode, o.shipCountry].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className={`py-2.5 pr-3 tabular whitespace-nowrap ${late ? "text-rose-400" : "text-muted"}`}>
                        {o.dispatchBy ? format(o.dispatchBy, "dd MMM") : "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="py-2.5 text-right tabular">{formatGBP(o.total, o.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? (
            <Link className="text-accent" href={link({ page: String(page - 1) })}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {hasMore && (
            <Link className="text-accent" href={link({ page: String(page + 1) })}>
              Older →
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
