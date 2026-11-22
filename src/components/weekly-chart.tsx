"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const gbp = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

export function WeeklyChart({ data }: { data: { week: string; units: number; revenue: number }[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262a33" vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={(d: string) => d.slice(8, 10) + "/" + d.slice(5, 7)}
            tick={{ fill: "#8b93a3", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={12}
          />
          <YAxis tickFormatter={gbp} tick={{ fill: "#8b93a3", fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "#16191f", border: "1px solid #262a33", borderRadius: 8 }}
            labelFormatter={(d) => `Week of ${String(d).slice(8, 10)}/${String(d).slice(5, 7)}`}
            formatter={(v, _n, item) => [`${gbp(Number(v))} · ${item.payload.units} sold`, "Revenue"]}
          />
          <Bar dataKey="revenue" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
