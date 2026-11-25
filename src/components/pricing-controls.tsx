"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Mode = "OFF" | "PREVIEW" | "LIVE";

const MODES: { key: Mode; label: string; on: string }[] = [
  { key: "OFF", label: "Off", on: "bg-white/15 text-white" },
  { key: "PREVIEW", label: "Preview", on: "bg-sky-500/80 text-white" },
  { key: "LIVE", label: "Live", on: "bg-emerald-500 text-white" },
];

export function PricingModeSwitch({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [current, setCurrent] = useState<Mode>(mode);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);

  async function set(next: Mode) {
    if (next === "LIVE" && !confirmLive) {
      setConfirmLive(true);
      return;
    }
    setBusy(true);
    setConfirmLive(false);
    const res = await fetch("/api/pricing/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    if (res.ok) setCurrent(next);
    setBusy(false);
    router.refresh();
  }

  if (confirmLive) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Go live? The dashboard will start changing eBay prices.</span>
        <button onClick={() => set("LIVE")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
          Yes, go live
        </button>
        <button onClick={() => setConfirmLive(false)} className="rounded-md border border-line px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Pricing:</span>
      <div className="flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Pricing mode">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="radio"
            aria-checked={current === m.key}
            disabled={busy}
            onClick={() => current !== m.key && set(m.key)}
            className={`rounded px-3 py-1 text-sm transition disabled:opacity-50 ${
              current === m.key ? m.on : "text-muted hover:bg-white/5"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RunPricingButton({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pricing/run", { method: "POST" });
      const s = (await res.json()) as { skippedReason?: string; changed: number; failed: number; tracked: number; errors: string[] };
      setMsg(
        s.skippedReason ??
          (mode === "LIVE"
            ? `Changed ${s.changed} price${s.changed === 1 ? "" : "s"}${s.failed ? `, ${s.failed} failed` : ""}`
            : `Preview updated — ${s.tracked} items checked, nothing changed on eBay`) +
            (s.errors.length && !s.skippedReason ? ` · ${s.errors[0]}` : ""),
      );
    } catch {
      setMsg("Run failed — check the Connections sync log");
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="max-w-md text-xs text-muted">{msg}</span>}
      <button
        onClick={run}
        disabled={busy || mode === "OFF"}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? "Running…" : mode === "LIVE" ? "Run pricing now" : "Refresh preview"}
      </button>
    </div>
  );
}

export function CostUpload() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; errors: string[] } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/pricing/costs", { method: "POST", body: await file.text() });
      const d = (await res.json()) as { imported?: number; errors?: string[]; error?: string };
      setMsg({
        text: d.error ?? `Saved ${d.imported ?? 0} SKU${d.imported === 1 ? "" : "s"}${d.errors?.length ? `, ${d.errors.length} row(s) with problems` : ""}`,
        errors: d.errors ?? [],
      });
    } catch {
      setMsg({ text: "Upload failed", errors: [] });
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/pricing/template" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-white/5">
          1. Download cost sheet
        </a>
        <button
          onClick={() => input.current?.click()}
          disabled={busy}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "2. Upload filled-in sheet (CSV)"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </div>
      {msg && (
        <div className="text-xs text-muted">
          {msg.text}
          {msg.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-amber-300">
              {msg.errors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
