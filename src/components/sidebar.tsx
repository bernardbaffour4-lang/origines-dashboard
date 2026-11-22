"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/orders", label: "Orders" },
  { href: "/listings", label: "Listings" },
  { href: "/settings", label: "Connections" },
];

const LATER = ["Inventory", "Shipping", "Returns", "Messages", "Reports"];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-line bg-panel px-4 py-6">
      <div className="mb-8 px-2">
        <div className="text-sm font-semibold tracking-wide">ORIGINES PARTS</div>
        <div className="text-xs text-muted">Control centre</div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-2 text-sm transition ${
                active ? "bg-accent/15 text-white" : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8 px-3 text-[11px] uppercase tracking-wider text-muted/70">Coming next</div>
      <div className="mt-2 flex flex-col gap-1">
        {LATER.map((l) => (
          <span key={l} className="px-3 py-1.5 text-sm text-muted/50">
            {l}
          </span>
        ))}
      </div>
    </aside>
  );
}
