import React from "react";
import Link from "next/link";
import { Receipt, Download, ArrowUpRight } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalPaymentsQueue } from "@/lib/data/internal-queries";
import { verifyPaymentWithInsurerAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate, formatBrDateTime } from "@/lib/format";
import {
  PaymentStatusBadge,
  VerificationStatusBadge,
} from "@/components/ui/badges";

export default async function InternalPaymentsPage() {
  const staff = await requireStaffUser();
  const rows = await getInternalPaymentsQueue(staff);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Payment Receipt Verification Queue
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          A customer receipt alone does not mark an installment Paid. Only insurer-confirmed payment amounts reduce the confirmed outstanding balance. Partial payments remain visible until 100% settled.
        </p>
      </div>

      <div className="space-y-4">
        {rows.map((p) => (
          <div
            key={p.id}
            className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                  {p.organizationName}
                </span>
                <Link
                  href={`/internal/installments/${p.installmentId}`}
                  className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
                >
                  Policy {p.policyNumber} · Inst {p.installmentNumber}/{p.totalInstallments}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
                <span className="text-xs text-slate-600">
                  ({p.policyholderName} · {p.insurer})
                </span>
              </div>

              <div className="flex items-center gap-2">
                <PaymentStatusBadge status={p.installmentPaymentStatus} />
                <VerificationStatusBadge status={p.verificationStatus} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 rounded-lg p-3 text-xs">
              <div>
                <div className="text-slate-500">Installment Total</div>
                <div className="font-bold text-slate-900 tabular-nums">
                  {formatBrl(p.installmentAmountBrl)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Receipt Submitted Amount</div>
                <div className="font-bold text-blue-700 tabular-nums">
                  {formatBrl(p.amountBrl)} (Paid {formatBrDate(p.paymentDate)})
                </div>
              </div>
              <div>
                <div className="text-slate-500">Total Confirmed Paid So Far</div>
                <div className="font-bold text-emerald-700 tabular-nums">
                  {formatBrl(p.confirmedPaidBrl)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Remaining Confirmed Balance</div>
                <div className="font-bold text-slate-900 tabular-nums">
                  {formatBrl(p.outstandingBalanceBrl)}
                </div>
              </div>
            </div>

            {p.customerComment && (
              <div className="text-xs text-slate-700">
                <strong>Customer Comment:</strong> {p.customerComment}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {p.receiptDocumentId ? (
                <a
                  href={`/api/documents/${p.receiptDocumentId}/download`}
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:underline font-semibold"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Receipt ({p.receiptFileName ?? "PDF"})
                </a>
              ) : (
                <span className="text-slate-400">No document attached</span>
              )}

              {p.verifiedByName && (
                <span className="text-slate-500">
                  Verified by <strong>{p.verifiedByName}</strong> on{" "}
                  {formatBrDateTime(p.verifiedAt)}
                  {p.notes ? ` · "${p.notes}"` : ""}
                </span>
              )}
            </div>

            {/* Inline Verification Form */}
            <form
              action={verifyPaymentWithInsurerAction}
              className="rounded-lg bg-slate-50 border border-slate-200 p-3 flex flex-wrap items-end gap-3 text-xs"
            >
              <input type="hidden" name="paymentId" value={p.id} />
              <input type="hidden" name="installmentId" value={p.installmentId} />

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Insurer Verification
                </label>
                <select
                  name="decision"
                  defaultValue="confirmed"
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="confirmed">Confirmed by Insurer</option>
                  <option value="under_review">Keep Under Review</option>
                  <option value="rejected">Rejected by Insurer</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Confirmed Amount (BRL)
                </label>
                <input
                  type="number"
                  name="confirmedAmountBrl"
                  step="0.01"
                  min="0"
                  defaultValue={p.confirmedAmountBrl ?? p.amountBrl}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Insurer Confirmation Date
                </label>
                <input
                  type="date"
                  name="insurerConfirmationDate"
                  defaultValue={p.insurerConfirmationDate ?? "2026-11-04"}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>

              <div className="flex-1 min-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                  Internal Verification Note
                </label>
                <input
                  type="text"
                  name="notes"
                  defaultValue={p.notes ?? ""}
                  placeholder="Insurer clearing reference / remaining balance note..."
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>

              <button
                type="submit"
                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
              >
                Record Verification
              </button>
            </form>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="rounded-xl bg-white border border-slate-200 p-10 text-center text-xs text-slate-500">
            No payment receipts submitted yet.
          </div>
        )}
      </div>
    </div>
  );
}
