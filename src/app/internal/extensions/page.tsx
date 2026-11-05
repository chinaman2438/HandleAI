import React from "react";
import Link from "next/link";
import { Clock, AlertTriangle, ArrowUpRight } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalExtensionsQueue } from "@/lib/data/internal-queries";
import { manageExtensionWorkflowAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate } from "@/lib/format";
import { ExtensionStatusBadge } from "@/components/ui/badges";

export default async function InternalExtensionsPage() {
  const staff = await requireStaffUser();
  const rows = await getInternalExtensionsQueue(staff);

  const pendingRows = rows.filter(
    (r) =>
      r.status === "requested" ||
      r.status === "submitted_to_insurer" ||
      r.status === "awaiting_response"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Extension Management &amp; Insurer Protocol Queue
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Customers propose new due dates, but only an insurer decision recorded here with a protocol number updates an installment&apos;s official due date. Every attempt is preserved permanently.
        </p>
      </div>

      {/* Active / Pending Extension Requests */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-amber-50/40 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              Active Extension Requests Awaiting Insurer / Employee Action ({pendingRows.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Includes the required demo scenario: Policy <code className="font-semibold text-slate-800">01.18.0004471</code> Installment 5/10 (Attempt #2 awaiting Aurora Seguros response).
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {pendingRows.map((ext) => (
            <div key={ext.id} className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                    {ext.organizationName}
                  </span>
                  <Link
                    href={`/internal/installments/${ext.installmentId}`}
                    className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Policy {ext.policyNumber} · Inst {ext.installmentNumber}/{ext.totalInstallments}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                  <span className="text-xs text-slate-600">
                    ({ext.policyholderName} · {ext.insurer} · {formatBrl(ext.amountBrl)})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
                    Attempt #{ext.attemptNumber} (Total: {ext.totalAttempts}, Approved: {ext.approvedAttempts})
                  </span>
                  <ExtensionStatusBadge status={ext.status} />
                </div>
              </div>

              {ext.totalAttempts >= 2 && (
                <div className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-950 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    <strong>Reluctance Warning ({ext.totalAttempts} attempts):</strong> This installment has 2+ extension attempts. Insurers often become reluctant to grant a 3rd extension.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-lg p-3 text-xs">
                <div>
                  <div className="text-slate-500">Original Due Date</div>
                  <div className="font-semibold text-slate-900 tabular-nums">
                    {formatBrDate(ext.originalDueDate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Current Official Due Date</div>
                  <div className="font-bold text-blue-700 tabular-nums">
                    {formatBrDate(ext.currentDueDate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Customer Requested Date</div>
                  <div className="font-bold text-amber-800 tabular-nums">
                    {formatBrDate(ext.requestedDueDate)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Protocol Number</div>
                  <div className="font-bold text-slate-900 font-mono">
                    {ext.protocolNumber ?? "Awaiting Protocol"}
                  </div>
                </div>
              </div>

              {ext.requestReason && (
                <div className="text-xs text-slate-700">
                  <strong>Customer Reason:</strong> {ext.requestReason}
                </div>
              )}
              {ext.responseNotes && (
                <div className="text-xs text-slate-600">
                  <strong>Latest Status Note:</strong> {ext.responseNotes}
                </div>
              )}

              {/* Inline Decision Form */}
              <form
                action={manageExtensionWorkflowAction}
                className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex flex-wrap items-end gap-3 text-xs"
              >
                <input type="hidden" name="extensionId" value={ext.id} />
                <input type="hidden" name="installmentId" value={ext.installmentId} />

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Action
                  </label>
                  <select
                    name="actionType"
                    defaultValue="approve"
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="submit_to_insurer">
                      Submit to Insurer (Awaiting Response)
                    </option>
                    <option value="approve">
                      Record Insurer Approval (Updates Due Date)
                    </option>
                    <option value="reject">Record Insurer Rejection</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Insurer Approved Date
                  </label>
                  <input
                    type="date"
                    name="approvedDueDate"
                    defaultValue={ext.requestedDueDate}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Protocol Number
                  </label>
                  <input
                    type="text"
                    name="protocolNumber"
                    defaultValue={ext.protocolNumber ?? ""}
                    placeholder="e.g. AUR-2026-124910"
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>

                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Insurer Decision Notes (Customer-Visible)
                  </label>
                  <input
                    type="text"
                    name="responseNotes"
                    placeholder="Record insurer decision details..."
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                >
                  Save Decision
                </button>
              </form>
            </div>
          ))}

          {pendingRows.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">
              No pending extension requests at the moment.
            </div>
          )}
        </div>
      </div>

      {/* Complete Historical Extension Attempts Table */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900">
            Complete Historical Extension Log ({rows.length} Total Attempts)
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-4">Group / Policyholder</th>
                <th className="py-3 px-3">Policy / Inst.</th>
                <th className="py-3 px-3">Insurer</th>
                <th className="py-3 px-2 text-center">Attempt</th>
                <th className="py-3 px-3">Orig. Due</th>
                <th className="py-3 px-3">Requested</th>
                <th className="py-3 px-3">Approved</th>
                <th className="py-3 px-3">Protocol No.</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {rows.slice(0, 100).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900">{r.organizationName}</div>
                    <div className="text-[11px] text-slate-500">{r.policyholderName}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <Link
                      href={`/internal/installments/${r.installmentId}`}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {r.policyNumber} ({r.installmentNumber}/{r.totalInstallments})
                    </Link>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700">{r.insurer}</td>
                  <td className="py-2.5 px-2 text-center font-semibold">
                    #{r.attemptNumber} of {r.totalAttempts}
                    {r.totalAttempts >= 2 && (
                      <span className="ml-1 text-amber-600" title="2+ attempts">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums text-slate-600">
                    {formatBrDate(r.originalDueDate)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums text-slate-800">
                    {formatBrDate(r.requestedDueDate)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums font-semibold text-emerald-700">
                    {formatBrDate(r.approvedDueDate)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-800">
                    {r.protocolNumber ?? "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <ExtensionStatusBadge status={r.status} />
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
