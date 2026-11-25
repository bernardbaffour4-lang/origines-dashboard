/**
 * Cost upload: a CSV with one row per SKU. Download the template from the
 * Pricing page (it lists every SKU you have live on eBay), fill in the costs
 * in Excel/Google Sheets, save as CSV and upload it back.
 * Blank cells leave the existing value unchanged.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { toMoney } from "@/lib/money";

const P = schema.pricingItems;

export const TEMPLATE_COLUMNS = [
  "sku",
  "title",
  "current_price",
  "cost",
  "postage",
  "original_price",
  "stocked_since",
  "market_price",
  "enabled",
] as const;

/** Minimal CSV parser that handles quoted fields, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const ALIASES: Record<string, string> = {
  "custom label": "sku", "custom_label": "sku",
  "cost_price": "cost", "cost (ex vat)": "cost", "cost_net": "cost",
  "shipping_cost": "postage", "shipping": "postage",
  "first_listed": "stocked_since", "first listed": "stocked_since",
};
const normHeader = (h: string) => {
  const k = h.trim().toLowerCase();
  return ALIASES[k] ?? k.replace(/\s+/g, "_");
};

function parseMoney(v: string, field: string): number | undefined {
  const t = v.replace(/[£,\s]/g, "");
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} "${v}" is not a valid amount`);
  return n;
}

function parseDate(v: string): Date | undefined {
  const t = v.trim();
  if (!t) return undefined;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // UK style DD/MM/YYYY
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  }
  throw new Error(`date "${v}" — use YYYY-MM-DD or DD/MM/YYYY`);
}

export async function importCosts(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { imported: 0, errors: ["The file has no data rows"] };
  const header = rows[0].map(normHeader);
  const col = (name: string) => header.indexOf(name);
  if (col("sku") < 0) return { imported: 0, errors: ['No "sku" column found in the first row'] };

  const errors: string[] = [];
  let imported = 0;
  for (let r = 1; r < rows.length; r++) {
    const cell = (name: string) => (col(name) >= 0 ? (rows[r][col(name)] ?? "").trim() : "");
    const sku = cell("sku");
    if (!sku) continue;
    try {
      const values: Partial<typeof P.$inferInsert> = {};
      const cost = parseMoney(cell("cost"), "cost");
      const postage = parseMoney(cell("postage"), "postage");
      const original = parseMoney(cell("original_price"), "original_price");
      const market = parseMoney(cell("market_price"), "market_price");
      const stocked = parseDate(cell("stocked_since"));
      const enabled = cell("enabled").toLowerCase();
      if (cost !== undefined) values.cost = toMoney(cost);
      if (postage !== undefined) values.postage = toMoney(postage);
      if (original !== undefined) values.originalPrice = toMoney(original);
      if (market !== undefined) values.marketPrice = toMoney(market);
      if (stocked) values.stockedSince = stocked;
      if (["no", "n", "false", "0", "off"].includes(enabled)) values.enabled = false;
      if (["yes", "y", "true", "1", "on"].includes(enabled)) values.enabled = true;
      await db
        .insert(P)
        .values({ sku, ...values })
        .onConflictDoUpdate({ target: P.sku, set: Object.keys(values).length ? values : { sku } });
      imported++;
    } catch (e) {
      errors.push(`Row ${r + 1} (${sku}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { imported, errors };
}

/** Template: every SKU live on eBay, with anything already saved filled in. */
export async function buildTemplate() {
  const L = schema.channelListings;
  const listings = await db
    .select({ sku: L.externalSku, title: L.title, price: L.price })
    .from(L)
    .where(and(eq(L.status, "ACTIVE"), isNotNull(L.externalSku)));
  const seen = new Map<string, { title: string | null; price: string | null }>();
  for (const l of listings) if (l.sku && !seen.has(l.sku)) seen.set(l.sku, { title: l.title, price: l.price });
  const skus = [...seen.keys()].sort();
  const saved = skus.length ? await db.select().from(P).where(inArray(P.sku, skus)) : [];
  const bySku = new Map(saved.map((s) => [s.sku, s]));
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  return toCsv([
    [...TEMPLATE_COLUMNS],
    ...skus.map((sku) => {
      const s = bySku.get(sku);
      const l = seen.get(sku)!;
      return [
        sku, l.title, l.price, s?.cost, s?.postage, s?.originalPrice,
        day(s?.stockedSince ?? null), s?.marketPrice, s ? (s.enabled ? "yes" : "no") : "yes",
      ];
    }),
  ]);
}
