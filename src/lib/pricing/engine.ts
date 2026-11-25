/**
 * Pure pricing logic: no database, no eBay. Given one item's facts, returns
 * the new base price, the price to show right now (with any time-of-day flash
 * discount), and what to do about it.
 */
import { PRICING } from "./config";

export type PricingInput = {
  cost: number; // net of VAT
  postage: number;
  originalPrice: number; // price before any markdowns (anchor for the ladder)
  basePrice: number; // current base price (without any flash discount)
  ageDays: number; // days unsold (since last sale or first listed)
  daysSinceBaseChange: number | null; // null = never changed by the engine
  views30d: number | null; // null = unknown
  watchers: number;
  marketPrice: number | null;
};

export type PricingAction = "HOLD_NEW" | "HOLD" | "REDUCE" | "FIX_LISTING" | "SEND_OFFER" | "LIQUIDATE";

export type PricingResult = {
  action: PricingAction;
  newBase: number;
  livePrice: number; // newBase with any flash discount applied for `now`
  floor: number;
  flash: { extra: number; label: string } | null;
  offerPrice: number | null; // for SEND_OFFER
  offerAccept: number | null;
  offerDecline: number | null;
  profitAtBase: number;
  marginAtBase: number;
  notes: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function vatShare() {
  return PRICING.vatMode === "flat" ? PRICING.vatRate : PRICING.vatRate / (1 + PRICING.vatRate);
}

/** Profit left after VAT, fees, postage and cost when sold at `price`. */
export function profitAt(price: number, cost: number, postage: number) {
  return price * (1 - PRICING.feeRate - vatShare()) - PRICING.feeFixed - postage - cost;
}

/** Lowest price that keeps the minimum net margin (break-even once past liquidation age). */
export function floorPrice(cost: number, postage: number, ageDays: number) {
  const margin = ageDays >= PRICING.liquidationAgeDays ? 0 : PRICING.minMargin;
  return (cost + postage + PRICING.feeFixed) / (1 - PRICING.feeRate - vatShare() - margin);
}

/** Round DOWN to a psychological ending: under £100 -> £x.99, £100+ -> £x4.99 / £x9.99. */
export function charm(price: number) {
  const step = price < 100 ? 1 : 5;
  return r2(Math.max(Math.floor((price + 0.01) / step) * step - 0.01, 0.99));
}

/** Round UP to the next .99 ending (used when we hit the floor). */
export function charmUp(price: number) {
  return r2(Math.floor(price) + 0.99);
}

export function ladderDiscount(ageDays: number) {
  let pct = 0;
  for (const [minAge, off] of PRICING.ageLadder) if (ageDays >= minAge) pct = off;
  return pct;
}

/** UK local weekday (0=Sun) and hour for a moment in time — handles BST automatically. */
export function ukClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { day, hour };
}

export function peakDiscount(now: Date): { extra: number; label: string } | null {
  const { day, hour } = ukClock(now);
  const [qs, qe] = PRICING.quietHours;
  if (hour >= qs && hour < qe) return null;
  for (const w of PRICING.peakWindows) {
    if (w.days.includes(day) && hour >= w.start && hour < w.end) {
      return { extra: w.extra, label: `${w.label} ${String(w.start).padStart(2, "0")}:00–${w.end}:00` };
    }
  }
  return null;
}

export function priceItem(i: PricingInput, now: Date): PricingResult {
  const notes: string[] = [];
  const floor = floorPrice(i.cost, i.postage, i.ageDays);
  const base = i.basePrice;
  const deadAt = PRICING.ageLadder[0][0];

  const result = (action: PricingAction, newBase: number, extra: Partial<PricingResult> = {}): PricingResult => {
    const profit = profitAt(newBase, i.cost, i.postage);
    return {
      action,
      newBase: r2(newBase),
      livePrice: r2(newBase),
      floor: r2(floor),
      flash: null,
      offerPrice: null,
      offerAccept: null,
      offerDecline: null,
      profitAtBase: r2(profit),
      marginAtBase: newBase > 0 ? profit / newBase : 0,
      notes,
      ...extra,
    };
  };

  if (base < floor) notes.push("Price is BELOW your floor — check the cost, or raise it yourself");

  // Not dead stock yet: leave it alone.
  if (i.ageDays < deadAt) return result("HOLD_NEW", base);

  let target = i.originalPrice * (1 - ladderDiscount(i.ageDays));

  // Don't sit far above the market.
  if (i.marketPrice && target > i.marketPrice * 1.05) {
    target = i.marketPrice * 0.99;
    notes.push(`Pulled toward market £${i.marketPrice.toFixed(2)}`);
  }

  // Cooldown: give the last cut time to work.
  if (target < base && i.daysSinceBaseChange != null && i.daysSinceBaseChange < PRICING.cooldownDays) {
    target = base;
    notes.push(`Cooldown — last cut ${i.daysSinceBaseChange}d ago`);
  }

  target = Math.max(target, base * (1 - PRICING.maxStep)); // limit any single cut
  let newBase = Math.min(charm(target), base); // dead stock never goes up...
  if (newBase < floor) newBase = Math.min(charmUp(floor), base); // ...and never below the floor
  if (newBase <= charmUp(floor) && base >= floor) notes.push("At floor — bundle it rather than cut further");

  let action: PricingAction;
  let offerPrice: number | null = null;
  if (i.views30d != null && i.views30d < PRICING.lowViews) {
    action = "FIX_LISTING";
    newBase = base; // nobody sees it, so price isn't the problem
  } else if (i.watchers >= PRICING.highWatchers && newBase < base) {
    action = "SEND_OFFER";
    offerPrice = newBase;
    newBase = base; // keep the public price; the offer does the work
  } else if (i.ageDays >= PRICING.liquidationAgeDays) {
    action = "LIQUIDATE";
  } else if (newBase < base) {
    action = "REDUCE";
  } else {
    action = "HOLD";
  }

  // Time-of-day flash discount (never below floor, never above base)
  let live = newBase;
  const peak = action === "FIX_LISTING" ? null : peakDiscount(now);
  if (peak) {
    live = Math.min(Math.max(charm(newBase * (1 - peak.extra)), charmUp(floor)), newBase);
    if (live < newBase) notes.push(`Flash −${Math.round(peak.extra * 100)}% (${peak.label})`);
  }

  return result(action, newBase, {
    livePrice: r2(live),
    flash: live < newBase ? peak : null,
    offerPrice,
    offerAccept: r2(Math.max(newBase * PRICING.offerAcceptShare, floor)),
    offerDecline: r2(floor),
  });
}
