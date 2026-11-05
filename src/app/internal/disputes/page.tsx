import React from "react";
import Link from "next/link";
import { Scale, ArrowUpRight } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalDisputesQueue } from "@/lib/data/internal-queries";
import { resolveAmountDisputeAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate } from "@/lib/format";
import { ExceptionStatusBadge } from "@/components/ui/badges";

export default async function InternalDisputesPage() {
  const staff = await requireStaffUser();
  const rows = await getInternalDisputesQueue(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Amount Dispute Investigation &amp; Endorsement Breakdowns
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Investigate disputed installment amounts, attach insurer-provided premium breakdowns, and identify the endorsement responsible for coverage changes.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((d) => (
          <div
            key={d.id}
            className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                  {d.organizationName}
                </span>
                <Link
                  href={`/internal/installments/${d.installmentId}`}
                  className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  Policy {d.policyNumber} (End. {d.endorsement}) · Inst {d.installmentNumber}/{d.totalInstallments}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <span className="text-xs text-slate-600">
                  ({d.policyholderName} · {d.insurer} · {d.insuranceType})
                </span>
              </div>
              <ExceptionStatusBadge status={d.status} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 rounded-lg p-3 text-xs">
              <div>
                <div className="text-slate-500">Billed Installment Amount</div>
                <div className="font-bold text-slate-900 tabular-nums text-sm">
                  {formatBrl(d.amountBrl)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Customer Expected Amount (PO)</div>
                <div className="font-bold text-amber-800 tabular-nums text-sm">
                  {d.requestedAmount !== null ? formatBrl(d.requestedAmount) : "—"}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Discrepancy Delta</div>
                <div className="font-bold text-blue-700 tabular-nums text-sm">
                  {d.requestedAmount !== null
                    ? formatBrl(d.amountBrl - d.requestedAmount)
                    : "—"}
                </div>
              </div>
            </div>

            {d.description && (
              <div className="text-xs text-slate-700">
                <strong>Customer Dispute Reason:</strong> {d.description}
              </div>
            )}

            <form
              action={resolveAmountDisputeAction}
              className="rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-3 text-xs"
            >
              <input type="hidden" name="exceptionId" value={d.id} />
              <input type="hidden" name="installmentId" value={d.installmentId} />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Dispute Status
                  </label>
                  <select
                    name="status"
                    defaultValue={d.status === "resolved" ? "resolved" : "awaiting_customer"}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="awaiting_insurer">Awaiting Insurer Breakdown</option>
                    <option value="awaiting_customer">
                      Breakdown Sent — Awaiting Customer
                    </option>
                    <option value="resolved">Resolved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Insurer Breakdown Date
                  </label>
                  <input
                    type="date"
                    name="insurerBreakdownReceivedOn"
                    defaultValue={d.insurerBreakdownReceivedOn ?? "2026-11-06"}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    Attach Breakdown PDF
                  </label>
                  <input
                    type="file"
                    name="breakdownFile"
                    accept=".pdf,.jpg,.png"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Responsible Endorsement Reference
                </label>
                <input
                  type="text"
                  name="endorsementReference"
                  defaultValue={d.endorsementReference ?? ""}
                  placeholder="Identify the endorsement that added or modified coverage..."
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Customer-Facing Explanation &amp; Breakdown Summary
                </label>
                <textarea
                  name="customerResponse"
                  rows={2}
                  required
                  defaultValue={d.customerResponse ?? ""}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>

              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
              >
                Save Breakdown &amp; Update Customer
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
