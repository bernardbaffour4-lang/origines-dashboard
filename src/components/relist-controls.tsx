"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AutoRelistToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !on;
    const res = await fetch("/api/settings/auto-relist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) setOn(next);
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="flex items-center gap-3 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
      aria-pressed={on}
    >
      <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-emerald-500" : "bg-white/15"}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-4.5" : "left-0.5"}`}
        />
      </span>
      Auto end &amp; relist: <strong>{on ? "ON" : "OFF"}</strong>
    </button>
  );
}

export function RunRelistButton({ due }: { due: number }) {
  const router = useRouter();
  const [stage, setStage] = useState<"idle" | "confirm" | "running">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setStage("running");
    setMsg(null);
    try {
      const res = await fetch("/api/relist", { method: "POST" });
      const s = (await res.json()) as {
        relisted: number;
        retried: number;
        failed: number;
        remaining: number;
        skippedReason?: string;
        errors: string[];
      };
      setMsg(
        s.skippedReason ??
          `Relisted ${s.relisted}${s.retried ? `, recovered ${s.retried}` : ""}${s.failed ? `, ${s.failed} failed` : ""}${s.remaining ? `, ${s.remaining} left for next run` : ""}`,
      );
    } catch {
      setMsg("Run failed — check the Connections sync log");
    }
    setStage("idle");
    router.refresh();
  }

  if (stage === "confirm") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">End &amp; relist {due} listing{due === 1 ? "" : "s"} now?</span>
        <button onClick={run} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500">
          Yes, run now
        </button>
        <button onClick={() => setStage("idle")} className="rounded-md border border-line px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button
        onClick={() => setStage("confirm")}
        disabled={stage === "running"}
        className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
      >
        {stage === "running" ? "Relisting… (can take a few minutes)" : "Run relist now"}
      </button>
    </div>
  );
}

export function RefreshListingsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    const res = await fetch("/api/listings/sync", { method: "POST" });
    const d = (await res.json()) as { ok: boolean; count?: number; error?: string };
    setMsg(d.ok ? `${d.count} active listings` : `Failed: ${d.error}`);
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="max-w-md truncate text-xs text-muted">{msg}</span>}
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh from eBay"}
      </button>
    </div>
  );
}
