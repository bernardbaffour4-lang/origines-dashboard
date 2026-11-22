"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const gbp = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

export function RevenueChart({ data }: { data: Record<string, number | string>[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262a33" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)}
            tick={{ fill: "#8b93a3", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            tickFormatter={gbp}
            tick={{ fill: "#8b93a3", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#16191f", border: "1px solid #262a33", borderRadius: 8 }}
            formatter={(v) => gbp(Number(v))}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8b93a3" }} />
          <Bar dataKey="EBAY" name="eBay" stackId="a" fill="#e53238" />
          <Bar dataKey="WIX" name="Website" stackId="a" fill="#f5b301" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
