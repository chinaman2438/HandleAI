import Link from "next/link";
import { BarChart3, TrendingDown, TrendingUp, Calendar, Filter } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import {
  getWeekOverWeekAnalytics,
  getInternalCustomersAndUsers,
} from "@/lib/data/internal-queries";
import { formatBrl, formatBrDate } from "@/lib/format";
import { AnalyticsCharts } from "@/components/internal/analytics-charts";

export const dynamic = "force-dynamic";

export default async function InternalReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await requireStaffUser();
  const params = await searchParams;
  const selectedOrgId = params.org || null;

  const [analytics, { organizations }] = await Promise.all([
    getWeekOverWeekAnalytics(user, selectedOrgId),
    getInternalCustomersAndUsers(user),
  ]);

  const { comparison, agingOverall, agingByGroup, weeklyTrend } = analytics;
  const isImproved = comparison.netChangeBrl <= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Week-over-Week Receivables Progression & Aging Report
          </h1>
          <p className="text-sm text-slate-600">
            Computed from stored weekly snapshots (<code>{formatBrDate(analytics.previousSnapshotDate)}</code> vs.{" "}
            <code>{formatBrDate(analytics.latestSnapshotDate)}</code>). Excludes negative credits from debt totals and separates extensions and cancellations from paid collections.
          </p>
        </div>

        {/* Organization Filter */}
        <form method="get" className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            name="org"
            defaultValue={selectedOrgId ?? ""}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800"
          >
            <option value="">All Corporate Groups ({organizations.length})</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
          >
            Apply Filter
          </button>
          {selectedOrgId && (
            <Link
              href="/internal/reports"
              className="text-xs font-semibold text-slate-600 hover:underline"
            >
              Reset
            </Link>
          )}
        </form>
      </div>

      {/* Week-over-Week Delta Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Latest Overdue Exposure ({formatBrDate(analytics.latestSnapshotDate)})
          </span>
          <p className="mt-2 text-2xl font-bold font-mono text-slate-900">
            {formatBrl(comparison.latestOverdueBrl)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {comparison.latestOverdueCount} positive overdue installments (Prev:{" "}
            {formatBrl(comparison.previousOverdueBrl)})
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 shadow-xs ${
            isImproved
              ? "border-emerald-200 bg-emerald-50/50"
              : "border-rose-200 bg-rose-50/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Net Week-over-Week Change
            </span>
            {isImproved ? (
              <TrendingDown className="h-4 w-4 text-emerald-600" />
            ) : (
              <TrendingUp className="h-4 w-4 text-rose-600" />
            )}
          </div>
          <p
            className={`mt-2 text-2xl font-bold font-mono ${
              isImproved ? "text-emerald-800" : "text-rose-800"
            }`}
          >
            {comparison.netChangeBrl > 0 ? "+" : ""}
            {formatBrl(comparison.netChangeBrl)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {comparison.netChangeCount > 0 ? "+" : ""}
            {comparison.netChangeCount} installments vs prior week
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            Resolved via Confirmed Payment
          </span>
          <p className="mt-2 text-2xl font-bold font-mono text-emerald-700">
            {formatBrl(comparison.resolvedPaid.amountBrl)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {comparison.resolvedPaid.count} previously overdue installments paid
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-700">
            Improved via Approved Extension
          </span>
          <p className="mt-2 text-2xl font-bold font-mono text-blue-700">
            {formatBrl(comparison.improvedByExtension.amountBrl)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {comparison.improvedByExtension.count} installments moved to current due date
          </p>
        </div>
      </div>

      {/* Detailed Movement Reconciliation */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <span className="font-semibold text-slate-600">Newly Overdue This Week</span>
          <p className="mt-1 text-base font-bold font-mono text-rose-700">
            +{formatBrl(comparison.newlyOverdue.amountBrl)} ({comparison.newlyOverdue.count})
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <span className="font-semibold text-slate-600">Still Overdue From Prior Week</span>
          <p className="mt-1 text-base font-bold font-mono text-slate-900">
            {formatBrl(comparison.stillOutstanding.amountBrl)} ({comparison.stillOutstanding.count})
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <span className="font-semibold text-slate-600">Missing Overdue (Under Review)</span>
          <p className="mt-1 text-base font-bold font-mono text-amber-700">
            {formatBrl(comparison.missingOverdue.amountBrl)} ({comparison.missingOverdue.count})
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <span className="font-semibold text-slate-600">
            Cancelled (Excluded from Collections)
          </span>
          <p className="mt-1 text-base font-bold font-mono text-slate-600">
            {formatBrl(comparison.cancelledOutcome.amountBrl)} ({comparison.cancelledOutcome.count})
          </p>
        </div>
      </div>

      {/* Aging Buckets Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        {agingOverall.map((b) => {
          const theme =
            b.bucket === "1-30"
              ? {
                  box: "bg-blue-50/70 border-blue-200",
                  title: "text-blue-900",
                  amount: "text-blue-700",
                  sub: "text-blue-800",
                  dot: "bg-[#3b82f6]",
                }
              : b.bucket === "31-60"
                ? {
                    box: "bg-amber-50/70 border-amber-200",
                    title: "text-amber-900",
                    amount: "text-amber-700",
                    sub: "text-amber-800",
                    dot: "bg-[#f59e0b]",
                  }
                : b.bucket === "61-89"
                  ? {
                      box: "bg-orange-50/70 border-orange-200",
                      title: "text-orange-900",
                      amount: "text-orange-700",
                      sub: "text-orange-800",
                      dot: "bg-[#f97316]",
                    }
                  : {
                      box: "bg-red-50/70 border-red-200",
                      title: "text-red-800",
                      amount: "text-red-700",
                      sub: "text-red-700",
                      dot: "bg-[#dc2626]",
                    };
          return (
            <div
              key={b.bucket}
              className={`rounded-lg border p-3.5 ${theme.box}`}
            >
              <div className={`font-semibold flex items-center justify-between ${theme.title}`}>
                <span>Aging Bucket: {b.label}</span>
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${theme.dot}`} />
              </div>
              <div className={`mt-1.5 text-base font-bold tabular-nums ${theme.amount}`}>
                {formatBrl(b.amountBrl)}
              </div>
              <div className={`text-[11px] mt-0.5 ${theme.sub}`}>
                {b.count} installments · {b.percentageOfOverdueBrl}% of overdue BRL
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Recharts Component */}
      <AnalyticsCharts data={analytics} />

      {/* Aging Breakdown by Corporate Group */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              Overdue Aging Matrix by Corporate Group ({agingByGroup.length} Groups)
            </h2>
            <p className="text-xs text-slate-500">
              Standardized buckets: <strong>1–30 days</strong>, <strong>31–60 days</strong>, <strong>61–89 days</strong>, and <strong>90+ days</strong> overdue.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Calendar className="h-3.5 w-3.5" /> Snapshot: {formatBrDate(analytics.latestSnapshotDate)}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer Group</th>
                <th className="px-4 py-3 text-right">1–30 Days</th>
                <th className="px-4 py-3 text-right">31–60 Days</th>
                <th className="px-4 py-3 text-right">61–89 Days</th>
                <th className="px-4 py-3 text-right">90+ Days</th>
                <th className="px-4 py-3 text-right">Total Overdue Count</th>
                <th className="px-4 py-3 text-right">Total Overdue BRL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {agingByGroup.map((g) => (
                <tr key={g.organizationId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-bold text-slate-900">{g.organizationName}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">
                    <div>{formatBrl(g.b1_30Brl)}</div>
                    <div className="text-[10px] text-slate-400">{g.b1_30Count} inst.</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-800">
                    <div>{formatBrl(g.b31_60Brl)}</div>
                    <div className="text-[10px] text-slate-400">{g.b31_60Count} inst.</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-orange-800">
                    <div>{formatBrl(g.b61_89Brl)}</div>
                    <div className="text-[10px] text-slate-400">{g.b61_89Count} inst.</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-rose-700">
                    <div>{formatBrl(g.b90PlusBrl)}</div>
                    <div className="text-[10px] text-slate-400">{g.b90PlusCount} inst.</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">
                    {g.totalOverdueCount}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                    {formatBrl(g.totalOverdueBrl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
