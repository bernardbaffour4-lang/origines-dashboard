/**
 * Sales insights: reads sold order lines and classifies each one from its
 * title (make, chassis/model code, side, lighting technology, part type).
 * Volumes are small (hundreds of lines), so aggregation happens in TypeScript,
 * which keeps the rules easy to read and change.
 */
import { and, eq, gte, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";

const { orders: O, orderItems: OI } = schema;

// ---------- Classification rules (edit freely) ----------

const MAKES: [string, RegExp][] = [
  ["Mercedes", /\bmercedes|\bmerc\b|\bamg\b/i],
  ["BMW", /\bbmw\b/i],
  ["Audi", /\baudi\b/i],
  ["Land Rover", /land\s?rover|range\s?rover|\bdefender\b|\bdiscovery\b|\bevoque\b|\bvelar\b/i],
  ["Porsche", /\bporsche\b|\bcayenne\b|\bmacan\b|\bpanamera\b|\btaycan\b/i],
  ["Volvo", /\bvolvo\b/i],
  ["VW", /\bvw\b|volkswagen|\bgolf\b|\bpassat\b|\btiguan\b|\btouareg\b/i],
  ["Mini", /\bmini\b/i],
];

// Chassis codes per make, checked in order (first match wins).
// If none is found, the model NAME is used instead (e.g. "BMW X3", "Mercedes GLE").
const CHASSIS: Record<string, RegExp[]> = {
  Mercedes: [/\b([WCXVRAH]\d{3})\b/i], // W205, C238, X253, V167
  BMW: [/\b([EFGU]\d{2})\b/], // F30, G20, G01, E90, U11
  "Land Rover": [/\b(L\d{3})\b/i], // L405, L461, L663
  Audi: [/\b([84][A-Z0-9])\b/, /\b(F[VY])\b/], // 8V, 8S, 4M (then FV/FY)
  Porsche: [/\b(9[5-9][0-9A-Z]|9Y[0A])\b/], // 991, 992, 95B, 9Y0
  VW: [/\b(MK\s?\d)\b/i], // Mk7
  Volvo: [],
  Mini: [/\b([FR]\d{2})\b/], // F56, R56
  Other: [],
};
const MODEL_NAMES: Record<string, RegExp> = {
  BMW: /\b([1-8] series|X[1-7]|Z4|i[34X]|M[2-8])\b/i,
  Mercedes: /\b(GL[ABCES]|GLS|CL[AS]|[ABCEGSV][\s-]?class|SL[CK]?|AMG GT|EQ[ABCES])\b/i,
  Audi: /\b(A[1-8]|Q[2-8]|TT|R8|RS\s?\d|S[3-8]|e-tron)\b/i,
  "Land Rover": /\b(range rover sport|range rover evoque|range rover velar|range rover|defender|discovery sport|discovery)\b/i,
  Porsche: /\b(911|cayenne|macan|panamera|taycan|boxster|cayman)\b/i,
  VW: /\b(golf|polo|passat|tiguan|touareg|arteon|t-roc)\b/i,
  Volvo: /\b(XC\d{2}|[SV]\d{2})\b/i,
  Mini: /\b(cooper|countryman|clubman)\b/i,
};

function modelOf(make: string, title: string) {
  for (const re of CHASSIS[make] ?? []) {
    const m = title.match(re);
    if (m) return `${make} ${m[1].toUpperCase().replace(/\s+/g, "")}`;
  }
  const name = MODEL_NAMES[make] && title.match(MODEL_NAMES[make]);
  if (name) {
    const n = name[1].replace(/\s+/g, " ");
    return `${make} ${n.length <= 3 ? n.toUpperCase() : n.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ Class$/i, "-Class")}`;
  }
  return `${make} (model not found)`;
}

const TECH: [string, RegExp][] = [
  ["Laser", /\blaser\b/i],
  ["Pixel / Digital", /\bpixel\b|digital\s?light/i],
  ["MultiBeam", /multi[\s-]?beam/i],
  ["Matrix", /\bmatrix\b/i],
  ["Adaptive LED", /adaptive.*\bled\b|\bled\b.*adaptive/i],
  ["Adaptive Xenon", /adaptive.*xenon|xenon.*adaptive/i],
  ["LED", /\bled\b/i],
  ["Xenon", /xenon|\bhid\b/i],
  ["Adaptive (type not stated)", /adaptive/i],
  ["Halogen", /halogen/i],
];

const PART_TYPES: [string, RegExp][] = [
  ["Tail light", /tail\s?light|rear\s?light|tail\s?lamp/i],
  ["Lens", /\blens\b/i],
  ["Fog light", /\bfog\b/i],
  ["Headlight", /head\s?light|head\s?lamp/i],
  ["Control unit / module", /\bmodule\b|control unit|\becu\b|ballast/i],
];

const PRICE_BANDS: [string, number][] = [
  ["Under £300", 300],
  ["£300 – £499", 500],
  ["£500 – £699", 700],
  ["£700 – £999", 1000],
  ["£1,000+", Infinity],
];

const firstMatch = (title: string, rules: [string, RegExp][], fallback: string) =>
  rules.find(([, re]) => re.test(title))?.[0] ?? fallback;

export function classify(title: string) {
  const make = firstMatch(title, MAKES, "Other");
  // Words win over left/right. For UK (right-hand drive) cars: left = passenger, right = driver.
  const side = /\bpair\b|left\s*(and|&|\/)\s*right/i.test(title)
    ? "Pair"
    : /passenger|nearside|\bN\/S\b/i.test(title)
      ? "Passenger"
      : /\bdriver|offside|\bO\/S\b/i.test(title)
        ? "Driver"
        : /\bleft\b|\bLH\b/i.test(title)
          ? "Passenger"
          : /\bright\b|\bRH\b/i.test(title)
            ? "Driver"
            : "Not stated";
  return {
    make,
    model: modelOf(make, title),
    side,
    tech: firstMatch(title, TECH, "Not stated"),
    partType: firstMatch(title, PART_TYPES, "Other"),
  };
}

const bandFor = (unitPrice: number) => PRICE_BANDS.find(([, max]) => unitPrice < max)![0];

// Normalise titles so the same part listed twice groups together when there's no SKU
const partKey = (sku: string | null, title: string) =>
  sku?.trim() ? `SKU:${sku.trim().toUpperCase()}` : title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- Aggregation ----------

export type Bucket = { name: string; units: number; revenue: number; orders: number; weeks: number; avg: number; share: number };

function bucketize(
  lines: Line[],
  keyOf: (l: Line) => string,
): Bucket[] {
  const map = new Map<string, { units: number; revenue: number; orders: Set<string>; weeks: Set<string> }>();
  for (const l of lines) {
    const k = keyOf(l);
    const b = map.get(k) ?? { units: 0, revenue: 0, orders: new Set(), weeks: new Set() };
    b.units += l.quantity;
    b.revenue += l.revenue;
    b.orders.add(l.orderId);
    b.weeks.add(l.week);
    map.set(k, b);
  }
  const totalRev = lines.reduce((s, l) => s + l.revenue, 0) || 1;
  return [...map.entries()]
    .map(([name, b]) => ({
      name,
      units: b.units,
      revenue: Math.round(b.revenue * 100) / 100,
      orders: b.orders.size,
      weeks: b.weeks.size,
      avg: b.units ? b.revenue / b.units : 0,
      share: b.revenue / totalRev,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units);
}

type Line = {
  orderId: string;
  channel: string;
  placedAt: Date;
  week: string; // ISO date of the Monday
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  revenue: number;
} & ReturnType<typeof classify>;

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

export async function getInsights(days: number) {
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      orderId: O.id,
      channel: O.channel,
      placedAt: O.placedAt,
      title: OI.title,
      sku: OI.externalSku,
      quantity: OI.quantity,
      unitPrice: OI.unitPrice,
    })
    .from(OI)
    .innerJoin(O, eq(OI.orderId, O.id))
    .where(and(gte(O.placedAt, from), notInArray(O.status, ["CANCELLED", "REFUNDED", "AWAITING_PAYMENT"])));

  const lines: Line[] = rows.map((r) => {
    const unit = parseFloat(r.unitPrice);
    return {
      ...r,
      unitPrice: unit,
      revenue: unit * r.quantity,
      week: mondayOf(r.placedAt),
      ...classify(r.title),
    };
  });

  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const revenue = lines.reduce((s, l) => s + l.revenue, 0);

  // Repeat sellers: same SKU (or same normalised title) sold 2+ times
  const byPart = new Map<string, { title: string; sku: string | null; units: number; revenue: number; dates: Date[] }>();
  for (const l of lines) {
    const k = partKey(l.sku, l.title);
    const p = byPart.get(k) ?? { title: l.title, sku: l.sku, units: 0, revenue: 0, dates: [] };
    p.units += l.quantity;
    p.revenue += l.revenue;
    p.dates.push(l.placedAt);
    byPart.set(k, p);
  }
  const repeatSellers = [...byPart.values()]
    .filter((p) => p.units >= 2)
    .map((p) => ({ ...p, dates: p.dates.sort((a, b) => a.getTime() - b.getTime()) }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue);

  // Weekly trend (every week in range, including empty ones)
  const weekly = new Map<string, { week: string; units: number; revenue: number }>();
  for (let t = from.getTime(); t <= Date.now(); t += 7 * 24 * 60 * 60 * 1000) {
    const w = mondayOf(new Date(t));
    weekly.set(w, { week: w, units: 0, revenue: 0 });
  }
  for (const l of lines) {
    const w = weekly.get(l.week) ?? { week: l.week, units: 0, revenue: 0 };
    w.units += l.quantity;
    w.revenue += l.revenue;
    weekly.set(l.week, w);
  }

  const missingSku = lines.filter((l) => !l.sku?.trim()).length;

  return {
    days,
    totals: {
      units,
      revenue,
      avg: units ? revenue / units : 0,
      distinctParts: byPart.size,
      repeatParts: repeatSellers.length,
      missingSkuShare: lines.length ? missingSku / lines.length : 0,
    },
    byMake: bucketize(lines, (l) => l.make),
    byModel: bucketize(lines, (l) => l.model),
    bySide: bucketize(lines, (l) => l.side),
    byTech: bucketize(lines, (l) => l.tech),
    byPartType: bucketize(lines, (l) => l.partType),
    byPriceBand: bucketize(lines, (l) => bandFor(l.unitPrice)).sort(
      (a, b) => PRICE_BANDS.findIndex(([n]) => n === a.name) - PRICE_BANDS.findIndex(([n]) => n === b.name),
    ),
    byChannel: bucketize(lines, (l) => (l.channel === "EBAY" ? "eBay" : l.channel === "WIX" ? "Website" : "Manual")),
    repeatSellers,
    weekly: [...weekly.values()].sort((a, b) => a.week.localeCompare(b.week)),
    topSales: [...lines].sort((a, b) => b.unitPrice - a.unitPrice).slice(0, 5),
  };
}
