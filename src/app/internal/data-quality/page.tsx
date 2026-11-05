import Link from "next/link";
import { AlertTriangle, CheckCircle2, EyeOff, Eye, Wrench } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalImportsAndDq } from "@/lib/data/internal-queries";
import { resolveDataQualityIssueAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InternalDataQualityPage() {
  const user = await requireStaffUser();
  const { issues } = await getInternalImportsAndDq(user);

  const openHeld = issues.filter((i) => i.status === "open" && i.holdsVisibility);
  const openWarnings = issues.filter((i) => i.status === "open" && !i.holdsVisibility);
  const resolvedIssues = issues.filter((i) => i.status !== "open");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Data-Quality Review & Held-Back Installments
          </h1>
          <p className="text-sm text-slate-600">
            Rows with conflicting duplicates, missing policyholder names, or inverted due dates are held back from customer visibility until reviewed and approved by Meridian staff.
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Held Back From Customers
            </span>
            <EyeOff className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-950">{openHeld.length} issues</p>
          <p className="mt-1 text-xs text-rose-800">
            <code>is_customer_visible = false</code> until staff resolution
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
              Auto-Repaired Warnings
            </span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-950">{openWarnings.length} warnings</p>
          <p className="mt-1 text-xs text-amber-800">
            Includes <code>#REF!</code> fallbacks, Installment 0→1/1, and exact deduplications
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Resolved / Approved
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-950">{resolvedIssues.length}</p>
          <p className="mt-1 text-xs text-emerald-800">
            Audited and logged in <code>public.data_quality_issues</code>
          </p>
        </div>
      </div>

      {/* Section 1: High-Severity Held-Back Rows Requiring Action */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-rose-600" />
            Held-Back Rows Requiring Staff Review ({openHeld.length})
          </h2>
          <p className="text-xs text-slate-500">
            Approve, repair swapped dates, or set missing policyholder names to release these installments to the Customer Portal.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {openHeld.map((issue) => (
            <div key={issue.id} className="p-5 hover:bg-slate-50/60">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-800">
                      {issue.issueCode}
                    </span>
                    {issue.rowNumber && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                        Excel Row {issue.rowNumber}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                      <EyeOff className="h-3 w-3" /> Hidden from Customer Portal
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900">{issue.title}</h3>
                  <p className="text-xs text-slate-600">{issue.description}</p>

                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
                    <span>
                      <strong>Group:</strong> {issue.organizationName ?? "N/A"}
                    </span>
                    <span>
                      <strong>Policyholder:</strong> {issue.policyholderName ?? "Missing"}
                    </span>
                    <span>
                      <strong>Policy:</strong>{" "}
                      <span className="font-mono">{issue.policyNumber ?? "N/A"}</span>
                    </span>
                    <span>
                      <strong>Installment:</strong>{" "}
                      {issue.installmentNumber}/{issue.totalInstallments}
                    </span>
                    <span>
                      <strong>Amount:</strong>{" "}
                      <span className="font-mono font-semibold">
                        {issue.amountBrl !== null ? formatBrl(issue.amountBrl) : "N/A"}
                      </span>
                    </span>
                    <span>
                      <strong>Original Due:</strong> {formatBrDate(issue.originalDueDate)}
                    </span>
                    <span>
                      <strong>Extended Due:</strong> {formatBrDate(issue.extendedDueDate)}
                    </span>
                  </div>

                  {issue.installmentId && (
                    <div className="pt-1">
                      <Link
                        href={`/internal/installments/${issue.installmentId}`}
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Inspect full installment record →
                      </Link>
                    </div>
                  )}
                </div>

                {/* Staff Resolution Form */}
                <form
                  action={resolveDataQualityIssueAction}
                  className="w-full lg:w-96 rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5 shrink-0"
                >
                  <input type="hidden" name="issueId" value={issue.id} />
                  {issue.installmentId && (
                    <input type="hidden" name="installmentId" value={issue.installmentId} />
                  )}

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600">
                      Resolution Action
                    </label>
                    <select
                      name="resolutionAction"
                      defaultValue={
                        issue.issueCode === "swapped_dates"
                          ? "swap_dates_and_approve"
                          : "approve_for_customer"
                      }
                      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    >
                      <option value="approve_for_customer">
                        Approve & Make Visible to Customer
                      </option>
                      <option value="swap_dates_and_approve">
                        Swap Original/Extended Dates & Approve
                      </option>
                      <option value="mark_missing_paid">
                        Missing Row: Confirm Paid
                      </option>
                      <option value="mark_missing_cancelled">
                        Missing Row: Confirm Cancelled
                      </option>
                      <option value="mark_missing_omitted">
                        Missing Row: Restore as Open
                      </option>
                      <option value="dismiss">Keep Held / Dismiss Issue</option>
                    </select>
                  </div>

                  {issue.issueCode === "missing_policyholder" && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600">
                        Set Subsidiary / Policyholder Name
                      </label>
                      <input
                        type="text"
                        name="policyholderName"
                        placeholder="e.g. Atlântica Logística S.A."
                        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  )}

                  {issue.issueCode === "conflicting_duplicate" && (
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600">
                        Confirmed Installment Amount (BRL, Optional)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        name="amountBrl"
                        defaultValue={issue.amountBrl ?? undefined}
                        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600">
                      Audit Resolution Notes
                    </label>
                    <input
                      type="text"
                      name="resolutionNotes"
                      required
                      placeholder="Verified against insurer policy schedule..."
                      className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    Apply Resolution
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Auto-Repaired Spreadsheet Warnings */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900">
            Non-Blocking Import Warnings & Normalizations ({openWarnings.length})
          </h2>
          <p className="text-xs text-slate-500">
            Automatically repaired during import (<code>#REF!</code> due date fallback, Installment <code>0</code> normalized to <code>1/1</code>, and identical duplicate rows skipped).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Row</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Customer Group</th>
                <th className="px-4 py-3">Summary & Auto-Repair Applied</th>
                <th className="px-4 py-3">Customer Visibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {openWarnings.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold text-slate-700">
                    {w.rowNumber ? `Row ${w.rowNumber}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-900">
                      {w.issueCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {w.organizationName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="font-semibold text-slate-800">{w.title}</div>
                    <div>{w.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    {w.isCustomerVisible ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <Eye className="h-3.5 w-3.5" /> Visible
                      </span>
                    ) : (
                      <span className="text-slate-400">Skipped Duplicate</span>
                    )}
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
