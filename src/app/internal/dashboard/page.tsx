import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Receipt,
  Clock,
  Scale,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  Upload,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import {
  getInternalReceivablesList,
  getWeekOverWeekAnalytics,
  getInternalImportsAndDq,
} from "@/lib/data/internal-queries";
import { formatBrl, formatBrDate } from "@/lib/format";
import { AnalyticsCharts } from "@/components/internal/analytics-charts";

export default async function InternalDashboardPage() {
  const staff = await requireStaffUser();
  const [receivables, wow, importsDq] = await Promise.all([
    getInternalReceivablesList(staff),
    getWeekOverWeekAnalytics(staff),
    getInternalImportsAndDq(staff),
  ]);

  const activePositive = receivables.filter(
    (r) => !r.isCredit && r.paymentStatus !== "paid" && r.paymentStatus !== "cancelled"
  );
  const totalOutstandingBrl = activePositive.reduce(
    (s, r) => s + r.outstandingBalanceBrl,
    0
  );
  const overdueRows = activePositive.filter((r) => r.daysOverdue > 0);
  const totalOverdueBrl = overdueRows.reduce(
    (s, r) => s + r.outstandingBalanceBrl,
    0
  );
  const paymentsUnderReviewCount = receivables.filter((r) => r.hasPendingReceipt).length;
  const pendingExtensionsCount = receivables.filter((r) => r.hasPendingExtension).length;
  const pendingDisputesCount = receivables.filter((r) => r.hasOpenDispute).length;
  const missingOverdueCount = overdueRows.filter((r) => r.isMissingFromLatest).length;
  const cancellationRiskRows = receivables.filter(
    (r) => r.riskLevel === "critical" || r.riskLevel === "high"
  );
  const openDqCount = importsDq.issues.filter((i) => i.status === "open").length;

  // Locate required demo scenario IDs for 1-click jump
  const demoExtRow = receivables.find(
    (r) => r.policyNumber === "01.18.0004471" && r.installmentNumber === 5
  );
  const demoDispRow = receivables.find(
    (r) => r.policyNumber === "01.18.4183925" && r.installmentNumber === 4
  );
  const demoPartialRow = receivables.find(
    (r) => r.policyNumber === "01.18.0004471" && r.installmentNumber === 6
  );

  const { comparison } = wow;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Meridian Receivables Management Overview
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Portfolio-wide operational control center for Alex Moraes &amp; the receivables team ·{" "}
            {receivables.length} tracked installments across 12 corporate groups.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/internal/imports"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5 text-blue-600" />
            Upload Excel Report
          </Link>
          <Link
            href="/internal/data-quality"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Data-Quality Queue ({openDqCount})
          </Link>
        </div>
      </div>

      {/* 8 Mandatory Management KPI Cards (Section 9A) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-slate-500">
            1. Total Outstanding Balance
          </div>
          <div className="mt-1.5 text-xl font-bold text-slate-900 tabular-nums">
            {formatBrl(totalOutstandingBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {activePositive.length} active positive-balance installments
          </div>
        </div>

        <div className="rounded-xl bg-white border border-red-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-red-700">
            2. Total Overdue Balance &amp; Count
          </div>
          <div className="mt-1.5 text-xl font-bold text-red-700 tabular-nums">
            {formatBrl(totalOverdueBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="font-bold text-slate-900">{overdueRows.length}</span> overdue installments
          </div>
        </div>

        <div className="rounded-xl bg-white border border-orange-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-orange-800">
            <span>3. Critical / High Cancellation Risk</span>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </div>
          <div className="mt-1.5 text-xl font-bold text-orange-800 tabular-nums">
            {cancellationRiskRows.length}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
            <span>Judicial guarantees &amp; surety prioritized</span>
            <Link
              href="/internal/cancellation-risk"
              className="font-semibold text-blue-600 hover:underline"
            >
              Open →
            </Link>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-xs font-semibold text-slate-600">
            4. Action Queues (Receipts / Ext / Disputes / Missing)
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <Link
              href="/internal/payments"
              className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 hover:bg-amber-100/70"
            >
              <div className="font-bold text-amber-900">{paymentsUnderReviewCount}</div>
              <div className="text-[11px] text-amber-800">Receipts to Verify</div>
            </Link>
            <Link
              href="/internal/extensions"
              className="rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1.5 hover:bg-blue-100/70"
            >
              <div className="font-bold text-blue-900">{pendingExtensionsCount}</div>
              <div className="text-[11px] text-blue-800">Pending Extensions</div>
            </Link>
            <Link
              href="/internal/disputes"
              className="rounded-md bg-purple-50 border border-purple-200 px-2.5 py-1.5 hover:bg-purple-100/70"
            >
              <div className="font-bold text-purple-900">{pendingDisputesCount}</div>
              <div className="text-[11px] text-purple-800">Amount Disputes</div>
            </Link>
            <Link
              href="/internal/data-quality"
              className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 hover:bg-red-100/70"
            >
              <div className="font-bold text-red-900">
                {missingOverdueCount} missing / {openDqCount} DQ
              </div>
              <div className="text-[11px] text-red-800">Held &amp; Missing</div>
            </Link>
          </div>
        </div>
      </div>

      {/* Required Demo Walkthrough Scenarios Bar */}
      <div className="rounded-xl bg-slate-900 text-white p-5 shadow-sm border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold">
              Key Operational Walkthrough Scenarios (From Workbook <code className="text-blue-300">meridian-receivables-2026-11-02.xlsx</code>)
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            Click any scenario card to inspect or act on the live record
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {demoExtRow && (
            <Link
              href={`/internal/installments/${demoExtRow.id}`}
              className="rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-blue-400 p-3.5 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    SECTION 11 · EXTENSION WORKFLOW
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="font-bold text-white mt-2">
                  Policy 01.18.0004471 · Inst 5/10 ({formatBrl(demoExtRow.amountBrl)})
                </div>
                <div className="text-slate-300 mt-1">
                  Grupo Atlântica / Atlântica Ferrovias · Aurora Seguros. Customer requested 30/11; insurer approved 15/11 (AUR-2026-118843). 2nd attempt submitted 05/11 awaiting insurer response.
                </div>
              </div>
            </Link>
          )}

          {demoDispRow && (
            <Link
              href={`/internal/installments/${demoDispRow.id}`}
              className="rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-blue-400 p-3.5 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                    SECTION 15 · AMOUNT DISPUTE
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="font-bold text-white mt-2">
                  Policy 01.18.4183925 · Inst 4/6 ({formatBrl(demoDispRow.amountBrl)})
                </div>
                <div className="text-slate-300 mt-1">
                  Grupo Atlântica / Atlântica Portos · Aurora Seguros. Disputed vs PO (R$ 4,820.00). Insurer breakdown received 06/11 showing Endorsement #1 added R$ 829.25 coverage.
                </div>
              </div>
            </Link>
          )}

          {demoPartialRow && (
            <Link
              href={`/internal/installments/${demoPartialRow.id}`}
              className="rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-emerald-400 p-3.5 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    SECTION 12 · PARTIAL PAYMENT &amp; RECEIPT
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                </div>
                <div className="font-bold text-white mt-2">
                  Policy 01.18.0004471 · Inst 6/10 ({formatBrl(demoPartialRow.amountBrl)})
                </div>
                <div className="text-slate-300 mt-1">
                  1st partial payment of R$ 20,000.00 confirmed by Aurora Seguros (Remaining balance: R$ 21,870.55). 2nd receipt of R$ 21,870.55 under review ready to confirm!
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Section 10: Week-over-Week Receivables Movement Analytics */}
      <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Week-over-Week Receivables Movement ({formatBrDate(wow.previousSnapshotDate)} →{" "}
              {formatBrDate(wow.latestSnapshotDate)})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Decomposes weekly overdue balance changes into newly overdue, resolved paid, extension shifts, and cancelled policies.
            </p>
          </div>
          <Link
            href="/internal/reports"
            className="text-xs font-semibold text-blue-600 hover:underline"
          >
            Open Full Analytics &amp; Group Aging Report →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 text-xs">
          <div className="rounded-lg bg-red-50/70 border border-red-200 p-3">
            <div className="font-semibold text-red-800 flex items-center justify-between">
              <span>Newly Overdue</span>
              <TrendingUp className="h-3.5 w-3.5 text-red-600" />
            </div>
            <div className="mt-1.5 text-base font-bold text-red-700 tabular-nums">
              {formatBrl(comparison.newlyOverdue.amountBrl)}
            </div>
            <div className="text-[11px] text-red-700 mt-0.5">
              {comparison.newlyOverdue.count} installments became overdue
            </div>
          </div>

          <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-3">
            <div className="font-semibold text-emerald-800 flex items-center justify-between">
              <span>Resolved (Confirmed Paid)</span>
              <TrendingDown className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="mt-1.5 text-base font-bold text-emerald-700 tabular-nums">
              {formatBrl(comparison.resolvedPaid.amountBrl)}
            </div>
            <div className="text-[11px] text-emerald-800 mt-0.5">
              {comparison.resolvedPaid.count} previously overdue settled
            </div>
          </div>

          <div className="rounded-lg bg-amber-50/70 border border-amber-200 p-3">
            <div className="font-semibold text-amber-900">
              Improved via Extension
            </div>
            <div className="mt-1.5 text-base font-bold text-amber-800 tabular-nums">
              {formatBrl(comparison.improvedByExtension.amountBrl)}
            </div>
            <div className="text-[11px] text-amber-800 mt-0.5">
              {comparison.improvedByExtension.count} moved to future due date (not cash collected)
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="font-semibold text-slate-700">
              Still Overdue
            </div>
            <div className="mt-1.5 text-base font-bold text-slate-900 tabular-nums">
              {formatBrl(comparison.stillOutstanding.amountBrl)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {comparison.stillOutstanding.count} installments remain overdue
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="font-semibold text-slate-700">
              Increased in Balance
            </div>
            <div className="mt-1.5 text-base font-bold text-slate-900 tabular-nums">
              {formatBrl(comparison.increasedBalance.amountBrl)}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {comparison.increasedBalance.count} overdue rows increased
            </div>
          </div>

          <div className="rounded-lg bg-purple-50/70 border border-purple-200 p-3">
            <div className="font-semibold text-purple-900">
              Missing Overdue
            </div>
            <div className="mt-1.5 text-base font-bold text-purple-800 tabular-nums">
              {formatBrl(comparison.missingOverdue.amountBrl)}
            </div>
            <div className="text-[11px] text-purple-800 mt-0.5">
              {comparison.missingOverdue.count} disappeared from report
            </div>
          </div>

          <div className="rounded-lg bg-slate-900 text-white p-3">
            <div className="font-semibold text-slate-300">
              Net Overdue Change
            </div>
            <div className="mt-1.5 text-base font-bold tabular-nums">
              {comparison.netChangeBrl >= 0 ? "+" : ""}
              {formatBrl(comparison.netChangeBrl)}
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              Count: {comparison.netChangeCount >= 0 ? `+${comparison.netChangeCount}` : comparison.netChangeCount} (Cancelled:{" "}
              {comparison.cancelledOutcome.count})
            </div>
          </div>
        </div>

        {/* Aging Buckets Summary Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
          {wow.agingOverall.map((b) => (
            <div
              key={b.bucket}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-bold text-slate-900">
                  Aging Bucket: {b.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {b.count} installments · {b.percentageOfOverdueBrl}% of overdue BRL
                </div>
              </div>
              <div className="text-sm font-bold text-slate-900 tabular-nums">
                {formatBrl(b.amountBrl)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recharts Visual Analytics */}
      <AnalyticsCharts data={wow} />
    </div>
  );
}
