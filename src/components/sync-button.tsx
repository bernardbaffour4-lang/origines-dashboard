"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as Record<string, { ok: boolean; count?: number; error?: string }>;
      setMsg(
        Object.entries(data)
          .map(([k, v]) => `${k}: ${v.ok ? `${v.count} orders` : "failed"}`)
          .join(" · "),
      );
      router.refresh();
    } catch {
      setMsg("Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
