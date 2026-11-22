"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/orders", label: "Orders" },
  { href: "/listings", label: "Listings" },
  { href: "/insights", label: "Sales insights", short: "Insights" },
  { href: "/settings", label: "Connections" },
];

const LATER = ["Inventory", "Shipping", "Returns", "Messages"];

function useIsActive() {
  const path = usePathname();
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

/** Desktop: fixed sidebar. Phone/tablet: top bar with swipeable page tabs. */
export function Sidebar() {
  const isActive = useIsActive();
  return (
    <>
      {/* Phone / small tablet */}
      <header className="sticky top-0 z-20 border-b border-line bg-panel md:hidden">
        <div className="flex items-baseline justify-between px-4 pt-3">
          <div className="text-sm font-semibold tracking-wide">ORIGINES PARTS</div>
          <div className="text-xs text-muted">Control centre</div>
        </div>
        <nav className="flex flex-wrap gap-1 px-3 py-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-2.5 py-1.5 text-sm ${
                isActive(n.href) ? "bg-accent/20 text-white" : "text-muted"
              }`}
            >
              {n.short ?? n.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Desktop */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel px-4 py-6 md:flex">
        <div className="mb-8 px-2">
          <div className="text-sm font-semibold tracking-wide">ORIGINES PARTS</div>
          <div className="text-xs text-muted">Control centre</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-md px-3 py-2 text-sm transition ${
                isActive(n.href) ? "bg-accent/15 text-white" : "text-muted hover:bg-white/5 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          ))}
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
    </>
  );
}
