/**
 * Dead-stock pricing settings. Change these numbers to tune the engine;
 * everything else follows from them. (Same rules as dead_stock_pricer.py.)
 */
export const PRICING = {
  // ---- Money ----
  feeRate: 0.13, // eBay final value fee + payment processing, as a share of the sale price
  feeFixed: 0.3, // per-order fixed fee (GBP)
  vatRate: 0.07, // your VAT percentage
  // "flat": VAT = vatRate x the full selling price (flat-rate scheme style)
  // "standard": selling price INCLUDES VAT, VAT owed = price x rate / (1 + rate)
  vatMode: "flat" as "flat" | "standard",
  minMargin: 0.2, // minimum NET margin: profit after cost, VAT, fees & postage = 20% of the selling price
  liquidationAgeDays: 365, // after this, the floor drops to break-even (get your cash back)

  // ---- Markdowns by days unsold: [min days, % off the original price] ----
  ageLadder: [
    [90, 0.1],
    [120, 0.18],
    [180, 0.28],
    [270, 0.38],
    [365, 0.5],
  ] as [number, number][],
  cooldownDays: 14, // never cut again sooner than this
  maxStep: 0.15, // never cut more than 15% in one go

  // ---- Time of day (UK time). days: 0 = Sunday ... 6 = Saturday ----
  peakWindows: [
    { days: [1, 2, 3, 4, 5], start: 19, end: 22, extra: 0.05, label: "weekday evening" },
    { days: [0], start: 18, end: 22, extra: 0.07, label: "Sunday evening" },
    { days: [6], start: 9, end: 12, extra: 0.04, label: "Saturday morning" },
  ],
  quietHours: [1, 6] as [number, number], // 01:00-06:00: no flash discounts

  // ---- Signals ----
  lowViews: 15, // views in 30 days below this -> fix the listing, don't cut the price
  highWatchers: 3, // this many watchers -> send them an offer before cutting the public price
  offerAcceptShare: 0.92, // suggested Best Offer auto-accept level, as a share of the base price

  // ---- Safety ----
  maxChangesPerRun: 300, // cap on eBay price changes per run
  timeBudgetMs: 240_000, // stay inside Vercel's 300s limit
};
