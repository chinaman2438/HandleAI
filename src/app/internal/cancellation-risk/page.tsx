import Link from "next/link";
import { AlertTriangle, ShieldAlert, Scale, Layers, Info } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalReceivablesList } from "@/lib/data/internal-queries";
import { formatBrl, formatBrDate } from "@/lib/format";
import { PaymentStatusBadge, RiskLevelBadge } from "@/components/ui/badges";

export const dynamic = "force-dynamic";

export default async function InternalCancellationRiskPage() {
  const user = await requireStaffUser();
  const allRows = await getInternalReceivablesList(user);

  const atRiskRows = allRows
    .filter(
      (r) =>
        !r.isCredit &&
        r.paymentStatus !== "paid" &&
        r.paymentStatus !== "cancelled" &&
        r.outstandingBalanceBrl > 0 &&
        (r.riskLevel === "critical" || r.riskLevel === "high" || r.riskLevel === "medium")
    )
    .sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
      const lineRank = { judicial_guarantee: 1, other_surety: 2, other_lines: 3 };
      if (rank[a.riskLevel] !== rank[b.riskLevel]) {
        return rank[a.riskLevel] - rank[b.riskLevel];
      }
      if (lineRank[a.linePriority] !== lineRank[b.linePriority]) {
        return lineRank[a.linePriority] - lineRank[b.linePriority];
      }
      return b.outstandingBalanceBrl - a.outstandingBalanceBrl;
    });

  const cancelledRows = allRows
    .filter((r) => r.paymentStatus === "cancelled")
    .sort((a, b) => b.amountBrl - a.amountBrl);

  const judicialGuaranteeAtRisk = atRiskRows.filter(
    (r) => r.linePriority === "judicial_guarantee"
  );
  const otherSuretyAtRisk = atRiskRows.filter((r) => r.linePriority === "other_surety");
  const otherLinesAtRisk = atRiskRows.filter((r) => r.linePriority === "other_lines");

  const criticalBrl = atRiskRows
    .filter((r) => r.riskLevel === "critical")
    .reduce((s, r) => s + r.outstandingBalanceBrl, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Cancellation-Risk Monitoring & Cancelled Policies
          </h1>
          <p className="text-sm text-slate-600">
            Prioritizes overdue receivables by insurance line sensitivity, days overdue, BRL exposure, and unconfirmed payment status.
          </p>
        </div>
      </div>

      {/* Explicit Heuristic Disclaimer */}
      <div className="rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-xs text-amber-950 shadow-xs">
        <div className="flex items-start gap-2.5">
          <Info className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
          <div>
            <p className="font-bold">
              Internal Heuristic Risk Model Disclaimer (Not Legal or Insurer Cancellation Rules)
            </p>
            <p className="mt-0.5 text-amber-900">
              Cancellation risk levels shown on this screen are <strong>internal operational heuristics</strong> designed to help Meridian account managers prioritize follow-ups before policies lapse or court guarantees are compromised. Actual policy cancellation terms depend on insurer-specific clauses, SUSEP regulations, and judicial orders.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards by Line Priority */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Priority 1: Judicial Guarantee
            </span>
            <Scale className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-950 font-mono">
            {formatBrl(judicialGuaranteeAtRisk.reduce((s, r) => s + r.outstandingBalanceBrl, 0))}
          </p>
          <p className="mt-1 text-xs text-rose-800">
            {judicialGuaranteeAtRisk.length} installments at risk • Court exposure if bond lapses
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Priority 2: Other Surety Bonds
            </span>
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-950 font-mono">
            {formatBrl(otherSuretyAtRisk.reduce((s, r) => s + r.outstandingBalanceBrl, 0))}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {otherSuretyAtRisk.length} installments at risk • Performance, Bid & Financial Surety
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Priority 3: Other Lines
            </span>
            <Layers className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono">
            {formatBrl(otherLinesAtRisk.reduce((s, r) => s + r.outstandingBalanceBrl, 0))}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {otherLinesAtRisk.length} installments at risk • Property, Fleet, Civil Liability, D&O, Health
          </p>
        </div>

        <div className="rounded-xl border border-slate-300 bg-slate-900 p-4 text-white shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-300">
              Critical Immediate Triage
            </span>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </div>
          <p className="mt-2 text-2xl font-bold font-mono text-white">
            {formatBrl(criticalBrl)}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {atRiskRows.filter((r) => r.riskLevel === "critical").length} critical installments •{" "}
            {cancelledRows.length} already cancelled
          </p>
        </div>
      </div>

      {/* Active At-Risk Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Active Overdue Installments At Risk of Cancellation ({atRiskRows.length})
            </h2>
            <p className="text-xs text-slate-500">
              Sorted by Risk Level (Critical → High → Medium), then Line Priority (Judicial → Surety → Other), then BRL Exposure.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Risk & Line Priority</th>
                <th className="px-4 py-3">Customer Group & Policyholder</th>
                <th className="px-4 py-3">Policy / Endorsement / Line</th>
                <th className="px-4 py-3">Inst.</th>
                <th className="px-4 py-3 text-right">Outstanding BRL</th>
                <th className="px-4 py-3">Current Due & Overdue</th>
                <th className="px-4 py-3">Recommended Follow-Up Action</th>
                <th className="px-4 py-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {atRiskRows.slice(0, 120).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/90">
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <RiskLevelBadge level={row.riskLevel} />
                      <span className="text-[11px] font-medium text-slate-500">
                        {row.linePriority === "judicial_guarantee"
                          ? "Priority 1: Judicial Guarantee"
                          : row.linePriority === "other_surety"
                            ? "Priority 2: Other Surety"
                            : "Priority 3: Standard Line"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">{row.organizationName}</div>
                    <div className="text-slate-600">{row.policyholderName}</div>
                    {row.accountManager && (
                      <div className="text-[11px] text-slate-400">Mgr: {row.accountManager}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-mono font-semibold text-slate-900">{row.policyNumber}</div>
                    <div className="text-slate-500">
                      {row.insurer} • {row.insuranceType}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-slate-700">
                    {row.installmentNumber}/{row.totalInstallments}
                  </td>
                  <td className="px-4 py-3 align-top text-right font-mono font-bold text-rose-700">
                    {formatBrl(row.outstandingBalanceBrl)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-slate-900">
                      {formatBrDate(row.currentDueDate)}
                    </div>
                    <div className="font-semibold text-rose-600">
                      {row.daysOverdue} days overdue ({row.agingBucket}d)
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top max-w-xs text-slate-700">
                    <div>{row.recommendedFollowUp}</div>
                    {row.latestInternalNote && (
                      <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-900 border border-amber-200">
                        <span className="font-semibold">Staff Note:</span> {row.latestInternalNote}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <Link
                      href={`/internal/installments/${row.id}`}
                      className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Open Workspace
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Already Cancelled Installments Section */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">
            Cancelled Installments & Policies ({cancelledRows.length})
          </h2>
          <p className="text-xs text-slate-500">
            Installments with status <code>Cancelado</code> in the insurer export or marked cancelled during investigation. Tracked separately from paid collections in Week-over-Week analytics.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Customer Group & Policyholder</th>
                <th className="px-4 py-3">Policy / Insurer / Line</th>
                <th className="px-4 py-3">Inst.</th>
                <th className="px-4 py-3 text-right">Original Amount BRL</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Internal Notes / Cancellation Context</th>
                <th className="px-4 py-3 text-right">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {cancelledRows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <PaymentStatusBadge status="cancelled" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{row.organizationName}</div>
                    <div className="text-slate-500">{row.policyholderName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-slate-900">{row.policyNumber}</div>
                    <div className="text-slate-500">
                      {row.insurer} • {row.insuranceType}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {row.installmentNumber}/{row.totalInstallments}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600 line-through">
                    {formatBrl(row.amountBrl)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatBrDate(row.currentDueDate)}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-sm">
                    {row.latestInternalNote ?? "Spreadsheet status: Cancelado"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/internal/installments/${row.id}`}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      Inspect
                    </Link>
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
