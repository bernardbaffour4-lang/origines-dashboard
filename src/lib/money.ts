/** Normalise any money-ish input into a 2dp string for numeric columns. */
export function toMoney(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export function formatGBP(v: number | string | null | undefined, currency = "GBP") {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(
    Number.isFinite(n) ? n : 0,
  );
}
