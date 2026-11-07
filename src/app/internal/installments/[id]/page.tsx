import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Lock,
  Receipt,
  Clock,
  Scale,
  AlertTriangle,
  ShieldAlert,
  Download,
  CheckCircle2,
  EyeOff,
  Eye,
} from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalInstallmentDetail } from "@/lib/data/internal-queries";
import {
  verifyPaymentWithInsurerAction,
  manageExtensionWorkflowAction,
  resolveAmountDisputeAction,
  addInternalNoteAction,
  resolveDataQualityIssueAction,
} from "@/lib/actions/portal-actions";
import {
  formatBrl,
  formatBrDate,
  formatBrDateTime,
  formatInstallmentLabel,
} from "@/lib/format";
import {
  PaymentStatusBadge,
  VerificationStatusBadge,
  ExtensionStatusBadge,
  ExceptionStatusBadge,
  RiskLevelBadge,
} from "@/components/ui/badges";

export default async function InternalInstallmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requireStaffUser();
  const { id } = await params;
  const detail = await getInternalInstallmentDetail(staff, id);

  if (!detail) {
    notFound();
  }

  const {
    installment,
    internalNotes,
    trackingHistory,
    payments,
    extensions,
    exceptions,
    dataQualityIssues,
    documents,
    timeline,
  } = detail;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/internal/receivables"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Internal Receivables Portfolio
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900">
              [{installment.organizationName}] Policy {installment.policyNumber} · Inst{" "}
              {formatInstallmentLabel(
                installment.installmentNumber,
                installment.totalInstallments,
                installment.sourceInstallmentNumber
              )}
            </h1>
            <PaymentStatusBadge
              status={installment.paymentStatus}
              isOverdue={installment.daysOverdue > 0}
              isCredit={installment.isCredit}
            />
            <RiskLevelBadge level={installment.riskLevel} />
            {installment.isCustomerVisible ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
                <Eye className="h-3 w-3" /> Visible to Customer
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800 ring-1 ring-inset ring-red-600/30">
                <EyeOff className="h-3 w-3" /> Held Back from Customer (DQ Queue)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Policyholder: <span className="font-semibold text-slate-800">{installment.policyholderName}</span>{" "}
            ({installment.policyholderTaxId ?? "Missing CNPJ"}) · Insurer:{" "}
            <span className="font-semibold text-slate-800">{installment.insurer}</span> ·{" "}
            {installment.insuranceType} · Endorsement #{installment.endorsement} · Source:{" "}
            <code className="text-slate-700">{installment.sourceRowId ?? "manual"}</code>
          </p>
        </div>
      </div>

      {/* Top Financial & Due-Date Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Installment Amount
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
            {formatBrl(installment.amountBrl)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-emerald-700">
            Confirmed Paid
          </div>
          <div className="mt-1 text-base font-bold text-emerald-700 tabular-nums">
            {formatBrl(installment.confirmedPaidBrl)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-700">
            Outstanding Balance
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
            {formatBrl(installment.outstandingBalanceBrl)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Original Due Date
          </div>
          <div className="mt-1 text-base font-bold text-slate-800 tabular-nums">
            {formatBrDate(installment.originalDueDate)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-slate-200 p-3.5 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-blue-700">
            Extended Due Date
          </div>
          <div className="mt-1 text-base font-bold text-blue-700 tabular-nums">
            {formatBrDate(installment.extendedDueDate)}
          </div>
        </div>
        <div className="rounded-xl bg-white border border-blue-200 p-3.5 shadow-2xs bg-blue-50/30">
          <div className="text-[11px] font-semibold uppercase text-blue-900">
            Current Due Date
          </div>
          <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
            {formatBrDate(installment.currentDueDate)}
          </div>
          <div className="text-[10px] text-slate-500">
            {installment.daysOverdue > 0 ? `${installment.daysOverdue}d overdue` : "Current"}
          </div>
        </div>
      </div>

      {/* Data Quality Warnings (if any) */}
      {dataQualityIssues.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-300 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-950 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              Data-Quality &amp; Synchronization Flags ({dataQualityIssues.length})
            </h2>
          </div>
          {dataQualityIssues.map((dq) => (
            <div
              key={dq.id}
              className="rounded-lg bg-white border border-amber-200 p-3.5 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  [{dq.issueCode}] {dq.title}
                </span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 uppercase">
                  Status: {dq.status}
                </span>
              </div>
              <p className="text-slate-700">{dq.description}</p>
              {dq.status === "open" && (
                <form action={resolveDataQualityIssueAction} className="flex flex-wrap items-center gap-2 pt-2">
                  <input type="hidden" name="issueId" value={dq.id} />
                  <input type="hidden" name="installmentId" value={installment.id} />
                  <select
                    name="resolutionAction"
                    defaultValue={
                      dq.issueCode === "swapped_dates"
                        ? "swap_dates_and_approve"
                        : "approve_for_customer"
                    }
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
                  >
                    <option value="approve_for_customer">
                      Approve &amp; Release to Customer Portal
                    </option>
                    <option value="swap_dates_and_approve">
                      Swap Original/Extended Dates &amp; Approve
                    </option>
                    <option value="mark_missing_paid">
                      Missing Overdue: Confirmed Paid
                    </option>
                    <option value="mark_missing_omitted">
                      Missing Overdue: Omitted by Insurer Report (Keep Open)
                    </option>
                    <option value="dismiss">Dismiss Flag</option>
                  </select>
                  <input
                    type="text"
                    name="resolutionNotes"
                    required
                    defaultValue="Verified against insurer portal; approved by Meridian receivables team."
                    className="flex-1 min-w-[220px] rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    Resolve &amp; Update
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Confidential Internal Notes, Checked By, Payment Verification, Extensions, Disputes */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. STRICTLY CONFIDENTIAL: Internal Notes & Checked By / Sent to Client On */}
          <div className="rounded-xl bg-slate-900 text-slate-100 border border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white">
                  Confidential Internal Notes &amp; Spreadsheet Tracking
                </h2>
              </div>
            </div>

            {/* Checked By & Sent to Client On History */}
            <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-3 text-xs">
              <div className="font-semibold text-slate-300 mb-2">
                Excel Operational Columns History (&ldquo;Checked By&rdquo; / &ldquo;Sent to Client On&rdquo;)
              </div>
              {trackingHistory.length > 0 ? (
                <div className="space-y-1.5">
                  {trackingHistory.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-slate-200 bg-slate-900/60 rounded px-2.5 py-1.5"
                    >
                      <span>
                        Checked By: <strong className="text-amber-300">{t.checkedBy ?? "—"}</strong> ·
                        Sent to Client On:{" "}
                        <strong className="text-blue-300">
                          {formatBrDate(t.sentToClientOn)}
                        </strong>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {t.fileName ?? "Manual Check"} · {formatBrDateTime(t.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-400">
                  No Checked By or Sent to Client On entries recorded yet.
                </div>
              )}
            </div>

            {/* Internal Notes List */}
            <div className="space-y-2.5">
              {internalNotes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg bg-slate-800 border border-slate-700 p-3 text-xs space-y-1"
                >
                  <div className="text-white font-medium">{n.content}</div>
                  <div className="text-[11px] text-slate-400 flex items-center justify-between">
                    <span>Author: {n.authorName}</span>
                    <span>{formatBrDateTime(n.createdAt)}</span>
                  </div>
                </div>
              ))}
              {internalNotes.length === 0 && (
                <div className="text-xs text-slate-400">
                  No confidential internal notes on this installment yet.
                </div>
              )}
            </div>

            {/* Add Internal Note Form */}
            <form action={addInternalNoteAction} className="pt-2 space-y-2">
              <input type="hidden" name="installmentId" value={installment.id} />
              <textarea
                name="content"
                rows={2}
                required
                placeholder="Add confidential internal note (e.g. broker competition note, AP contact preference, insurer call log)..."
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                Save Confidential Internal Note
              </button>
            </form>
          </div>

          {/* 2. Payment Verification Against Insurer (Section 9D & 12) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-600" />
                Payment Receipts &amp; Insurer Verification ({payments.length})
              </h2>
              <span className="text-xs text-slate-500">
                Only insurer-confirmed amounts reduce official balance
              </span>
            </div>

            {payments.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-slate-200 p-4 text-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-slate-900 text-sm tabular-nums">
                      Submitted Receipt: {formatBrl(p.amountBrl)}
                    </span>
                    <span className="text-slate-500 ml-2">
                      · Paid on {formatBrDate(p.paymentDate)}
                    </span>
                  </div>
                  <VerificationStatusBadge status={p.verificationStatus} />
                </div>

                {p.customerComment && (
                  <div className="text-slate-700 bg-slate-50 rounded p-2">
                    <strong>Customer Note:</strong> {p.customerComment}
                  </div>
                )}

                {p.verifiedByName && (
                  <div className="text-[11px] text-slate-500">
                    Last checked by <strong>{p.verifiedByName}</strong> at{" "}
                    {formatBrDateTime(p.verifiedAt)}
                    {p.notes ? ` — Internal Note: "${p.notes}"` : ""}
                  </div>
                )}

                {p.receiptDocumentId && (
                  <div>
                    <a
                      href={`/api/documents/${p.receiptDocumentId}/download`}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download Customer Receipt Voucher
                    </a>
                  </div>
                )}

                {/* Insurer Verification Action Form */}
                <form
                  action={verifyPaymentWithInsurerAction}
                  className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2.5"
                >
                  <input type="hidden" name="paymentId" value={p.id} />
                  <input type="hidden" name="installmentId" value={installment.id} />
                  <div className="font-semibold text-slate-800">
                    Record Insurer Verification Decision ({installment.insurer})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Insurer Decision
                      </label>
                      <select
                        name="decision"
                        defaultValue="confirmed"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="confirmed">Confirmed by Insurer</option>
                        <option value="under_review">Keep Under Review</option>
                        <option value="rejected">Rejected by Insurer</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Confirmed Amount (BRL)
                      </label>
                      <input
                        type="number"
                        name="confirmedAmountBrl"
                        step="0.01"
                        min="0"
                        defaultValue={p.confirmedAmountBrl ?? p.amountBrl}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Confirmation Date
                      </label>
                      <input
                        type="date"
                        name="insurerConfirmationDate"
                        defaultValue={p.insurerConfirmationDate ?? "2026-11-04"}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <input
                      type="text"
                      name="notes"
                      defaultValue={p.notes ?? ""}
                      placeholder="Internal verification note (e.g. clearing ref in insurer portal)..."
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    Save Insurer Verification &amp; Recalculate Balance
                  </button>
                </form>
              </div>
            ))}

            {payments.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">
                No payment receipts uploaded for this installment yet.
              </div>
            )}
          </div>

          {/* 3. Extension History & Insurer Protocol Workflow (Section 11) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                Extension Requests &amp; Insurer Protocol Management ({extensions.length})
              </h2>
              <span className="text-xs font-semibold text-slate-700">
                Attempts: {extensions.length} · Approved:{" "}
                {extensions.filter((e) => e.status === "approved").length}
              </span>
            </div>

            {extensions.length >= 2 && (
              <div className="rounded-lg bg-amber-50 border border-amber-300 p-3 text-xs text-amber-950 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>High Extension Count Warning ({extensions.length} attempts):</strong>{" "}
                  This installment has already been extended or requested two or more times.
                  Insurers frequently become reluctant to grant a 3rd extension, though no hard cap is imposed.
                </div>
              </div>
            )}

            {extensions.map((ext) => (
              <div
                key={ext.id}
                className="rounded-lg border border-slate-200 p-4 text-xs space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900 text-sm">
                    Attempt #{ext.attemptNumber} · Requested {formatBrDate(ext.requestedDueDate)}
                  </span>
                  <ExtensionStatusBadge status={ext.status} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 rounded p-2.5">
                  <div>
                    <div className="text-[11px] text-slate-500">Customer Requested</div>
                    <div className="font-bold text-slate-900 tabular-nums">
                      {formatBrDate(ext.requestedDueDate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Insurer Approved Date</div>
                    <div className="font-bold text-emerald-700 tabular-nums">
                      {ext.approvedDueDate ? formatBrDate(ext.approvedDueDate) : "Not Approved"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Insurer Protocol No.</div>
                    <div className="font-bold text-slate-900 font-mono">
                      {ext.protocolNumber ?? "—"}
                    </div>
                  </div>
                </div>

                {ext.requestReason && (
                  <div className="text-slate-600">
                    <strong>Reason:</strong> {ext.requestReason}
                  </div>
                )}
                {ext.responseNotes && (
                  <div className="text-slate-700">
                    <strong>Notes:</strong> {ext.responseNotes}
                  </div>
                )}

                {/* Employee Extension Decision Form */}
                <form
                  action={manageExtensionWorkflowAction}
                  className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2.5"
                >
                  <input type="hidden" name="extensionId" value={ext.id} />
                  <input type="hidden" name="installmentId" value={installment.id} />
                  <div className="font-semibold text-slate-800">
                    Update Attempt #{ext.attemptNumber} with {ext.insurer}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Workflow Step / Decision
                      </label>
                      <select
                        name="actionType"
                        defaultValue={
                          ext.status === "requested" ? "submit_to_insurer" : "approve"
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
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
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Insurer Approved Due Date
                      </label>
                      <input
                        type="date"
                        name="approvedDueDate"
                        defaultValue={ext.approvedDueDate ?? ext.requestedDueDate}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Insurer Protocol Number
                      </label>
                      <input
                        type="text"
                        name="protocolNumber"
                        defaultValue={ext.protocolNumber ?? ""}
                        placeholder="e.g. AUR-2026-124910"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <input
                      type="text"
                      name="responseNotes"
                      defaultValue={ext.responseNotes ?? ""}
                      placeholder="Customer-visible explanation of the insurer's response..."
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                  >
                    Record Extension Update
                  </button>
                </form>
              </div>
            ))}
          </div>

          {/* 4. Amount Disputes & Insurer Breakdown Resolution (Section 15) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Scale className="h-4 w-4 text-purple-600" />
              Amount Disputes &amp; Exceptions ({exceptions.length})
            </h2>

            {exceptions.map((ex) => (
              <div
                key={ex.id}
                className="rounded-lg border border-slate-200 p-4 text-xs space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold uppercase text-slate-900">
                    {ex.type.replace(/_/g, " ")}
                  </span>
                  <ExceptionStatusBadge status={ex.status} />
                </div>

                {ex.description && <p className="text-slate-700">{ex.description}</p>}

                {ex.type === "amount_dispute" && (
                  <form
                    action={resolveAmountDisputeAction}
                    className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2.5"
                  >
                    <input type="hidden" name="exceptionId" value={ex.id} />
                    <input type="hidden" name="installmentId" value={installment.id} />
                    <div className="font-semibold text-slate-800">
                      Attach Insurer Breakdown &amp; Explain Endorsement Discrepancy
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Dispute Status
                        </label>
                        <select
                          name="status"
                          defaultValue="resolved"
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        >
                          <option value="awaiting_insurer">
                            Requested Breakdown from Insurer
                          </option>
                          <option value="awaiting_customer">
                            Breakdown Sent — Awaiting Customer
                          </option>
                          <option value="resolved">Resolved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-0.5">
                          Insurer Breakdown Date
                        </label>
                        <input
                          type="date"
                          name="insurerBreakdownReceivedOn"
                          defaultValue={ex.insurerBreakdownReceivedOn ?? "2026-11-06"}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Endorsement Responsible for Amount Change
                      </label>
                      <input
                        type="text"
                        name="endorsementReference"
                        defaultValue={ex.endorsementReference ?? ""}
                        placeholder="e.g. Endorsement #1 (Added cargo coverage +R$ 829.25)"
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Customer-Facing Explanation
                      </label>
                      <textarea
                        name="customerResponse"
                        rows={2}
                        required
                        defaultValue={ex.customerResponse ?? ""}
                        placeholder="Explain the insurer's installment breakdown clearly to the customer..."
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-0.5">
                        Upload Insurer Breakdown PDF (Optional)
                      </label>
                      <input
                        type="file"
                        name="breakdownFile"
                        accept=".pdf,.jpg,.png"
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 cursor-pointer"
                    >
                      Save Breakdown &amp; Send Customer Response
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right 5 Columns: Cancellation Risk Detail, Documents, and Full Activity Timeline */}
        <div className="lg:col-span-5 space-y-6">
          {/* Cancellation Risk Assessment Card */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Cancellation-Risk Heuristic Assessment
              </h2>
              <RiskLevelBadge level={installment.riskLevel} />
            </div>
            <p className="text-xs text-slate-700 font-medium">
              {installment.recommendedFollowUp}
            </p>
            <div className="rounded bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-slate-500">
              <strong>Heuristic Disclaimer:</strong> Risk levels are internal prioritization
              heuristics (prioritizing Judicial Guarantees &amp; Surety), not official insurer
              cancellation rules. Actual cancellation timing varies by insurer and must be verified.
            </div>
          </div>

          {/* Attached Documents */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
            <h2 className="text-sm font-bold text-slate-900">
              Attached Documents ({documents.length})
            </h2>
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-900">{d.fileName}</div>
                  <div className="text-[11px] text-slate-500">
                    {d.documentType.replace(/_/g, " ")} · Visibility: {d.visibility}
                  </div>
                </div>
                <a
                  href={`/api/documents/${d.id}/download`}
                  className="inline-flex items-center gap-1 rounded bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            ))}
            {documents.length === 0 && (
              <div className="text-xs text-slate-500">No documents attached.</div>
            )}
          </div>

          {/* Complete Internal + Customer Activity Timeline */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Full Audit &amp; Activity Timeline ({timeline.length})
              </h2>
              <span className="text-[11px] text-slate-500">
                Preserved across all imports
              </span>
            </div>

            <div className="space-y-3">
              {timeline.map((a) => (
                <div
                  key={a.id}
                  className={`border-l-2 pl-3 py-0.5 text-xs ${
                    a.visibility === "internal"
                      ? "border-amber-500"
                      : "border-blue-600"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{a.action}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        a.visibility === "internal"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-blue-50 text-blue-700"
                      }`}
                    >
                      {a.visibility}
                    </span>
                  </div>
                  <div className="text-slate-700 mt-0.5">{a.description}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {a.actorLabel ?? "System"} · {formatBrDateTime(a.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
