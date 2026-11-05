"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { WeekOverWeekAnalytics } from "@/lib/data/internal-queries";
import { formatBrl } from "@/lib/format";

function compactBrl(v: number): string {
  if (Math.abs(v) >= 1_000_000) {
    return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(v) >= 1_000) {
    return `R$ ${(v / 1_000).toFixed(0)}k`;
  }
  return `R$ ${v.toFixed(0)}`;
}

export function AnalyticsCharts({ data }: { data: WeekOverWeekAnalytics }) {
  const topGroups = data.agingByGroup.slice(0, 8).map((g) => ({
    name: g.organizationName.replace(/^Grupo\s+/i, ""),
    fullName: g.organizationName,
    "1–30 days": Math.round(g.b1_30Brl),
    "31–60 days": Math.round(g.b31_60Brl),
    "61–89 days": Math.round(g.b61_89Brl),
    "90+ days": Math.round(g.b90PlusBrl),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Chart 1: Weekly Overdue Balance & Count Trend */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Weekly Overdue Balance (BRL) &amp; Installment Count Trend
          </h3>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="brl"
                tickFormatter={(v) => compactBrl(Number(v))}
                tick={{ fontSize: 11 }}
                width={72}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={{ fontSize: 11 }}
                width={42}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === "Overdue Balance (BRL)"
                    ? formatBrl(Number(value))
                    : `${value} installments`
                }
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                yAxisId="brl"
                type="monotone"
                dataKey="overdueBrl"
                name="Overdue Balance (BRL)"
                stroke="#dc2626"
                strokeWidth={2.5}
                dot={{ r: 4 }}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="overdueCount"
                name="Overdue Installment Count"
                stroke="#1d4ed8"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 2: Newly Overdue vs Resolved Paid vs Extension Improvements */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Weekly Movement: Newly Overdue vs. Resolved Paid vs. Extended
          </h3>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => compactBrl(Number(v))}
                tick={{ fontSize: 11 }}
                width={72}
              />
              <Tooltip formatter={(value) => formatBrl(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="newlyOverdueBrl"
                name="Newly Overdue (BRL)"
                fill="#ef4444"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="resolvedPaidBrl"
                name="Resolved via Payment (BRL)"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="improvedByExtBrl"
                name="Moved Future via Extension (BRL)"
                fill="#f59e0b"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 3: Aging Distribution Over Time */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Aging Bucket Distribution Over Time (1–30, 31–60, 61–89, 90+ Days)
          </h3>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => compactBrl(Number(v))}
                tick={{ fontSize: 11 }}
                width={72}
              />
              <Tooltip formatter={(value) => formatBrl(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="b1_30Brl" name="1–30 days" stackId="a" fill="#3b82f6" />
              <Bar dataKey="b31_60Brl" name="31–60 days" stackId="a" fill="#f59e0b" />
              <Bar dataKey="b61_89Brl" name="61–89 days" stackId="a" fill="#f97316" />
              <Bar dataKey="b90PlusBrl" name="90+ days" stackId="a" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 4: Aging Distribution by Customer Organization */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Overdue Aging Distribution by Corporate Group (Top 8)
          </h3>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topGroups} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                tickFormatter={(v) => compactBrl(Number(v))}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11 }}
                width={110}
              />
              <Tooltip formatter={(value) => formatBrl(Number(value))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="1–30 days" stackId="g" fill="#3b82f6" />
              <Bar dataKey="31–60 days" stackId="g" fill="#f59e0b" />
              <Bar dataKey="61–89 days" stackId="g" fill="#f97316" />
              <Bar dataKey="90+ days" stackId="g" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
