import type { ChannelName, OrderStatus } from "@/db/schema";

export function Card({
  title,
  children,
  className = "",
  action,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  delta,
  invert = false,
}: {
  label: string;
  value: string;
  delta?: number | null; // fraction, e.g. 0.12 = +12%
  invert?: boolean; // for costs, where up is bad
}) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular">{value}</div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`mt-1 text-xs tabular ${good ? "text-emerald-400" : "text-rose-400"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}% vs previous period
        </div>
      )}
    </div>
  );
}

const CHANNEL_STYLE: Record<ChannelName, string> = {
  EBAY: "bg-ebay/15 text-red-300",
  WIX: "bg-wix/15 text-amber-300",
  MANUAL: "bg-white/10 text-gray-300",
};

export function ChannelBadge({ channel }: { channel: ChannelName }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${CHANNEL_STYLE[channel]}`}>
      {channel === "EBAY" ? "eBay" : channel === "WIX" ? "Website" : "Manual"}
    </span>
  );
}

const STATUS_STYLE: Partial<Record<OrderStatus, string>> = {
  AWAITING_PAYMENT: "bg-gray-500/15 text-gray-300",
  PAID: "bg-sky-500/15 text-sky-300",
  PICKED: "bg-indigo-500/15 text-indigo-300",
  PACKED: "bg-violet-500/15 text-violet-300",
  SHIPPED: "bg-emerald-500/15 text-emerald-300",
  DELIVERED: "bg-emerald-500/15 text-emerald-300",
  CANCELLED: "bg-rose-500/15 text-rose-300",
  REFUNDED: "bg-orange-500/15 text-orange-300",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? ""}`}>
      {status === "PAID" ? "To ship" : status.replace("_", " ").toLowerCase()}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted">{children}</div>;
}
