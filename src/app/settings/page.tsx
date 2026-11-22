import { format } from "date-fns";
import { Card, ChannelBadge, Empty } from "@/components/ui";
import { SyncButton } from "@/components/sync-button";
import { getConnections } from "@/lib/queries";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "eBay connected. Press Sync now to pull your orders.", ok: true },
  declined: { text: "eBay consent was declined.", ok: false },
  bad_state: { text: "Security check failed — please try connecting again.", ok: false },
  config: {
    text: "Add EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_RUNAME to your environment first (see README).",
    ok: false,
  },
  error: { text: "eBay connection failed. Check your keys and RuName, then retry.", ok: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ebay?: string }>;
}) {
  const sp = await searchParams;
  const notice = sp.ebay ? NOTICES[sp.ebay] : undefined;
  const { accounts, logs } = await getConnections();
  const ebay = accounts.find((a) => a.channel === "EBAY");
  const wix = accounts.find((a) => a.channel === "WIX");
  const wixConfigured = Boolean(process.env.WIX_API_KEY && process.env.WIX_SITE_ID);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Connections</h1>
          <p className="text-sm text-muted">Sales channels and sync health</p>
        </div>
        <SyncButton />
      </header>

      {notice && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-rose-500/10"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="eBay">
          {ebay ? (
            <dl className="space-y-1.5 text-sm">
              <Row k="Account" v={ebay.externalAccountId ?? ebay.label} />
              <Row k="Last sync" v={ebay.lastOrderSyncAt ? format(ebay.lastOrderSyncAt, "dd MMM HH:mm") : "Never"} />
              <Row
                k="Re-consent due"
                v={ebay.refreshTokenExpiresAt ? format(ebay.refreshTokenExpiresAt, "dd MMM yyyy") : "—"}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted">Not connected.</p>
          )}
          <a
            href="/api/ebay/connect"
            className="mt-4 inline-block rounded-md bg-ebay px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            {ebay ? "Reconnect eBay" : "Connect eBay"}
          </a>
        </Card>

        <Card title="Website (Wix)">
          {wixConfigured ? (
            <dl className="space-y-1.5 text-sm">
              <Row k="Status" v="API key configured" />
              <Row
                k="Last sync"
                v={wix?.lastOrderSyncAt ? format(wix.lastOrderSyncAt, "dd MMM HH:mm") : "Never"}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted">
              Add <code className="text-xs">WIX_API_KEY</code> and <code className="text-xs">WIX_SITE_ID</code>{" "}
              to your environment (see README).
            </p>
          )}
        </Card>
      </div>

      <Card title="Sync log">
        {logs.length === 0 ? (
          <Empty>No syncs have run yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-line first:border-0 align-top">
                  <td className="py-2 pr-3 tabular text-muted whitespace-nowrap">
                    {format(l.startedAt, "dd MMM HH:mm:ss")}
                  </td>
                  <td className="py-2 pr-3">
                    <ChannelBadge channel={l.channel} />
                  </td>
                  <td className="py-2 pr-3">{l.job}</td>
                  <td className={`py-2 pr-3 ${l.ok ? "text-emerald-400" : "text-rose-400"}`}>
                    {l.ok ? `${l.count} processed` : "failed"}
                  </td>
                  <td className="py-2 text-xs text-muted break-all">{l.message}</td>
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
