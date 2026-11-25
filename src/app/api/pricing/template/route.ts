import { buildTemplate } from "@/lib/pricing/costs";

export const dynamic = "force-dynamic";

/** Download a CSV of every live eBay SKU to fill in costs. */
export async function GET() {
  return new Response(await buildTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="origines-costs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
