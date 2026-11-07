import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Receipt,
  Clock,
  Scale,
  FileText,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Download,
} from "lucide-react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerInstallmentDetail } from "@/lib/data/customer-queries";
import {
  submitPaymentReceiptAction,
  submitExtensionRequestAction,
  submitAmountDisputeAction,
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
} from "@/components/ui/badges";
import { PendingSubmitButton } from "@/components/internal/pending-submit-button";
import { FileInput } from "@/components/ui/file-input";

export default async function CustomerInstallmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCustomerUser();
  const { id } = await params;
  const detail = await getCustomerInstallmentDetail(user, id);

  if (!detail) {
    notFound();
  }

  const { installment, payments, extensions, exceptions, documents, timeline } =
    detail;

  const isOverdue =
    !installment.isCredit &&
    installment.paymentStatus !== "paid" &&
    installment.paymentStatus !== "cancelled" &&
    installment.outstandingBalanceBrl > 0 &&
    installment.daysFromToday !== null &&
    installment.daysFromToday < 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/installments"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {installment.organizationName} Installments
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">
              Policy {installment.policyNumber} · Installment{" "}
              {formatInstallmentLabel(
                installment.installmentNumber,
                installment.totalInstallments,
                installment.sourceInstallmentNumber
              )}
            </h1>
            <PaymentStatusBadge
              status={installment.paymentStatus}
              isOverdue={isOverdue}
              isCredit={installment.isCredit}
            />
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Policyholder: <span className="font-semibold text-slate-800">{installment.policyholderName}</span>{" "}
            ({installment.policyholderTaxId ?? "—"}) · Insurer:{" "}
            <span className="font-semibold text-slate-800">{installment.insurer}</span> ·{" "}
            {installment.insuranceType} (Endorsement {installment.endorsement})
          </p>
        </div>
      </div>

      {/* Cancelled Coverage Alert (Section 13) */}
      {installment.paymentStatus === "cancelled" && (
        <div className="rounded-xl bg-rose-50 border border-rose-300 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-950 space-y-1">
            <div className="font-bold text-sm text-rose-900">
              Coverage Cancelled According to Insurer Report
            </div>
            <p>
              This installment is marked as <strong>Cancelled</strong> in the insurer&apos;s receivables report.
              Historical payment, extension, and activity records are preserved below. Please contact your
              Meridian account manager ({installment.accountManager ?? "Receivables Team"}) for official insurer documentation.
            </p>
          </div>
        </div>
      )}

      {/* Summary Cards: Amounts & Separate Due Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Installment Amount
          </div>
          <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
            {formatBrl(installment.amountBrl)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {installment.isCredit ? "Refund / Credit Endorsement" : `Endorsement #${installment.endorsement}`}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-emerald-700">
            Confirmed Paid
          </div>
          <div className="mt-1.5 text-lg font-bold text-emerald-700 tabular-nums">
            {formatBrl(installment.confirmedPaidBrl)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Verified with {installment.insurer}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-700">
            Outstanding Balance
          </div>
          <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
            {installment.isCredit ? "R$ 0,00 (Credit)" : formatBrl(installment.outstandingBalanceBrl)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Reduced only by insurer-confirmed payments
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Original Due Date
          </div>
          <div className="mt-1.5 text-base font-bold text-slate-800 tabular-nums">
            {formatBrDate(installment.originalDueDate)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Permanent contractual baseline
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Extended Due Date
          </div>
          <div className="mt-1.5 text-base font-bold text-blue-700 tabular-nums">
            {formatBrDate(installment.extendedDueDate)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {installment.extendedDueDate ? "Insurer-approved extension" : "No approved extension"}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-blue-200 p-4 shadow-2xs bg-blue-50/30">
          <div className="text-[11px] font-semibold uppercase text-blue-800">
            Current Official Due Date
          </div>
          <div className="mt-1.5 text-base font-bold text-slate-900 tabular-nums">
            {formatBrDate(installment.currentDueDate)}
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            {installment.daysFromToday !== null
              ? installment.daysFromToday < 0
                ? `${Math.abs(installment.daysFromToday)} day(s) past due`
                : installment.daysFromToday === 0
                  ? "Due today"
                  : `Due in ${installment.daysFromToday} day(s)`
              : "—"}
          </div>
        </div>
      </div>

      {/* Main Content Grid: Left = History & Details (7 cols), Right = Customer Workflow Forms (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          {/* Policy Metadata */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Policy &amp; Servicing Information
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Corporate Group</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.organizationName}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Policyholder Subsidiary</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.policyholderName}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Policyholder Tax ID (CNPJ)</div>
                <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                  {installment.policyholderTaxId ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Insurer</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.insurer}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Line of Business</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.insuranceType}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Policy No. / Endorsement</div>
                <div className="font-semibold text-slate-900 tabular-nums mt-0.5">
                  {installment.policyNumber} (End. {installment.endorsement})
                </div>
              </div>
              <div>
                <div className="text-slate-500">Meridian Servicing Branch</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.branch ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Meridian Account Manager</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {installment.accountManager ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Installment Sequence</div>
                <div className="font-semibold text-slate-900 mt-0.5">
                  {formatInstallmentLabel(
                    installment.installmentNumber,
                    installment.totalInstallments,
                    installment.sourceInstallmentNumber
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Extension History Section (Section 8E & 11) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600" />
                Payment Extension History ({extensions.length} Attempt{extensions.length === 1 ? "" : "s"})
              </h2>
              <span className="text-xs text-slate-500">
                Approved: {extensions.filter((e) => e.status === "approved").length} / {extensions.length}
              </span>
            </div>

            {extensions.length >= 2 && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Multiple Extension Attempts ({extensions.length}):</span>{" "}
                  Insurers frequently become reluctant to grant a third extension. An extension is only valid once confirmed by {installment.insurer} with a protocol number.
                </div>
              </div>
            )}

            <div className="space-y-3">
              {extensions.map((ext) => (
                <div
                  key={ext.id}
                  className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      Attempt #{ext.attemptNumber} · Insurer: {ext.insurer}
                    </span>
                    <ExtensionStatusBadge status={ext.status} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 rounded-md p-2.5">
                    <div>
                      <div className="text-[11px] text-slate-500">Customer Requested Date</div>
                      <div className="font-semibold text-slate-900 tabular-nums">
                        {formatBrDate(ext.requestedDueDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Insurer Approved Date</div>
                      <div className="font-semibold text-emerald-700 tabular-nums">
                        {ext.approvedDueDate
                          ? formatBrDate(ext.approvedDueDate)
                          : "Pending Insurer Decision"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Insurer Protocol No.</div>
                      <div className="font-semibold text-slate-900 tabular-nums">
                        {ext.protocolNumber ?? "Awaiting Protocol"}
                      </div>
                    </div>
                  </div>

                  {ext.approvedDueDate && ext.approvedDueDate !== ext.requestedDueDate && (
                    <div className="rounded bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-[11px] text-blue-900">
                      <strong>Date Difference Notice:</strong> You requested{" "}
                      <strong>{formatBrDate(ext.requestedDueDate)}</strong>, and {ext.insurer} approved{" "}
                      <strong>{formatBrDate(ext.approvedDueDate)}</strong>.
                    </div>
                  )}

                  {ext.requestReason && (
                    <div className="text-slate-600">
                      <span className="font-medium text-slate-700">Request Reason:</span>{" "}
                      {ext.requestReason}
                    </div>
                  )}
                  {ext.responseNotes && (
                    <div className="text-slate-700 bg-slate-50 rounded px-2.5 py-1.5 border border-slate-200/80">
                      <span className="font-semibold text-slate-900">Meridian / Insurer Update:</span>{" "}
                      {ext.responseNotes}
                    </div>
                  )}
                </div>
              ))}

              {extensions.length === 0 && (
                <div className="text-xs text-slate-500 py-4 text-center">
                  No extension requests recorded for this installment.
                </div>
              )}
            </div>
          </div>

          {/* Payment History & Receipts (Section 8D & 12) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-emerald-600" />
                Payment &amp; Receipt History ({payments.length})
              </h2>
              <span className="text-xs text-slate-500">
                Confirmed: {formatBrl(installment.confirmedPaidBrl)} / {formatBrl(installment.amountBrl)}
              </span>
            </div>

            <div className="space-y-3">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-900 tabular-nums">
                        Submitted Amount: {formatBrl(p.amountBrl)}
                      </span>
                      <span className="text-slate-500 ml-2">
                        · Payment Date: {formatBrDate(p.paymentDate)}
                      </span>
                    </div>
                    <VerificationStatusBadge status={p.verificationStatus} />
                  </div>

                  {p.verificationStatus === "confirmed" && (
                    <div className="text-emerald-800 bg-emerald-50/70 border border-emerald-200 rounded px-2.5 py-1.5 flex items-center justify-between">
                      <span>
                        Confirmed by {installment.insurer}:{" "}
                        <strong>{formatBrl(p.confirmedAmountBrl ?? p.amountBrl)}</strong>
                      </span>
                      {p.insurerConfirmationDate && (
                        <span>Confirmed on {formatBrDate(p.insurerConfirmationDate)}</span>
                      )}
                    </div>
                  )}

                  {p.customerComment && (
                    <div className="text-slate-600">
                      <span className="font-medium text-slate-700">Comment:</span>{" "}
                      {p.customerComment}
                    </div>
                  )}

                  {p.receiptDocumentId && (
                    <div>
                      <a
                        href={`/api/documents/${p.receiptDocumentId}/download`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Uploaded Receipt
                      </a>
                    </div>
                  )}
                </div>
              ))}

              {payments.length === 0 && (
                <div className="text-xs text-slate-500 py-4 text-center">
                  No payment receipts submitted yet for this installment.
                </div>
              )}
            </div>
          </div>

          {/* Amount Disputes & Customer Requests (Section 8F & 15) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
              <Scale className="h-4 w-4 text-blue-600" />
              Amount Disputes &amp; Service Requests ({exceptions.length})
            </h2>

            <div className="space-y-3">
              {exceptions.map((ex) => (
                <div
                  key={ex.id}
                  className="rounded-lg border border-slate-200 p-3.5 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 uppercase tracking-wide text-[11px]">
                      {ex.type.replace(/_/g, " ")}
                    </span>
                    <ExceptionStatusBadge status={ex.status} />
                  </div>

                  {ex.description && (
                    <div className="text-slate-700">{ex.description}</div>
                  )}

                  {ex.requestedAmount !== null && (
                    <div className="text-slate-600">
                      Customer Expected Amount:{" "}
                      <strong className="text-slate-900 tabular-nums">
                        {formatBrl(ex.requestedAmount)}
                      </strong>{" "}
                      (Billed: {formatBrl(installment.amountBrl)})
                    </div>
                  )}

                  {ex.endorsementReference && (
                    <div className="rounded bg-blue-50 border border-blue-200 p-2.5 text-blue-950">
                      <div className="font-semibold">
                        Responsible Endorsement: {ex.endorsementReference}
                      </div>
                      {ex.insurerBreakdownReceivedOn && (
                        <div className="text-[11px] text-blue-800 mt-0.5">
                          Insurer Breakdown Received:{" "}
                          {formatBrDate(ex.insurerBreakdownReceivedOn)}
                        </div>
                      )}
                    </div>
                  )}

                  {ex.customerResponse && (
                    <div className="rounded bg-slate-50 border border-slate-200 p-2.5 text-slate-800">
                      <div className="font-semibold text-slate-900 mb-0.5">
                        Meridian Explanation:
                      </div>
                      {ex.customerResponse}
                    </div>
                  )}
                </div>
              ))}

              {exceptions.length === 0 && (
                <div className="text-xs text-slate-500 py-4 text-center">
                  No disputes or service requests opened on this installment.
                </div>
              )}
            </div>

            {documents.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                  Attached Customer-Visible Documents ({documents.length})
                </div>
                <div className="space-y-1.5">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-medium text-slate-900">{doc.fileName}</span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          ({doc.documentType.replace(/_/g, " ")})
                        </span>
                      </div>
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Customer-Visible Activity Timeline (Section 16) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Permanent Installment Activity Timeline
            </h2>
            <div className="space-y-3">
              {timeline.map((item) => (
                <div
                  key={item.id}
                  className="border-l-2 border-blue-500 pl-3.5 py-0.5 text-xs"
                >
                  <div className="font-medium text-slate-900">{item.description}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {item.actorLabel ?? "System"} · {formatBrDateTime(item.createdAt)}
                  </div>
                </div>
              ))}
              {timeline.length === 0 && (
                <div className="text-xs text-slate-500 py-3 text-center">
                  No customer-visible timeline events recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Action Forms (Submit Receipt, Request Extension, Dispute Amount) */}
        <div className="lg:col-span-5 space-y-6">
          {/* 1. Submit Payment Receipt Form (Section 8D) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Receipt className="h-4 w-4 text-emerald-600" />
              Submit Payment Receipt
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Upload your PDF, JPG, or PNG payment voucher. Partial payments are supported.
              Your installment will move to <strong>Receipt Under Review</strong> until confirmed by{" "}
              {installment.insurer}.
            </p>

            <form action={submitPaymentReceiptAction} className="mt-4 space-y-3">
              <input type="hidden" name="installmentId" value={installment.id} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount Paid (BRL)
                  </label>
                  <input
                    type="number"
                    name="amountPaidBrl"
                    step="0.01"
                    min="0.01"
                    required
                    defaultValue={
                      installment.outstandingBalanceBrl > 0
                        ? installment.outstandingBalanceBrl
                        : Math.abs(installment.amountBrl)
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    name="paymentDate"
                    required
                    defaultValue="2026-11-04"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Receipt Document (PDF, JPG, PNG)
                </label>
                <FileInput
                  name="receiptFile"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Optional Comment (e.g., partial payment tranche or bank reference)
                </label>
                <input
                  type="text"
                  name="comment"
                  placeholder="TED / PIX reference or partial payment explanation..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <PendingSubmitButton
                label="Upload Payment Receipt for Insurer Review"
                pendingLabel="Uploading Receipt..."
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors cursor-pointer"
              />
            </form>
          </div>

          {/* 2. Request Payment Extension Form (Section 8E) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Clock className="h-4 w-4 text-amber-600" />
              Request Payment Extension
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Propose a new due date for Meridian to submit to <strong>{installment.insurer}</strong>.
              Your current due date ({formatBrDate(installment.currentDueDate)}) will{" "}
              <strong>not</strong> change unless the insurer confirms approval.
            </p>

            <form action={submitExtensionRequestAction} className="mt-4 space-y-3">
              <input type="hidden" name="installmentId" value={installment.id} />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Proposed New Due Date
                </label>
                <input
                  type="date"
                  name="requestedDueDate"
                  required
                  defaultValue="2026-11-30"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Extension Request
                </label>
                <textarea
                  name="reason"
                  rows={2}
                  required
                  placeholder="Explain the business reason or cash-flow schedule for requesting a new due date..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <PendingSubmitButton
                label={`Submit Extension Request (Attempt #${extensions.length + 1})`}
                pendingLabel="Submitting Request..."
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              />
            </form>
          </div>

          {/* 3. Open Amount Dispute Form (Section 8F) */}
          <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Scale className="h-4 w-4 text-blue-600" />
              Dispute Installment Amount
            </div>
            <p className="text-xs text-slate-500 mt-1">
              If the billed amount ({formatBrl(installment.amountBrl)}) does not match your purchase
              order or contract, submit the expected amount and supporting documentation.
            </p>

            <form action={submitAmountDisputeAction} className="mt-4 space-y-3">
              <input type="hidden" name="installmentId" value={installment.id} />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Amount You Believe Is Correct (BRL)
                </label>
                <input
                  type="number"
                  name="expectedAmountBrl"
                  step="0.01"
                  min="0"
                  required
                  placeholder="e.g. 4820.00"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Explanation of Discrepancy
                </label>
                <textarea
                  name="description"
                  rows={2}
                  required
                  placeholder="Reference your Purchase Order (PO) number or endorsement calculation question..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supporting Document (Optional PO / Calculation PDF)
                </label>
                <FileInput
                  name="supportFile"
                  accept=".pdf,.jpg,.jpeg,.png"
                />
              </div>

              <PendingSubmitButton
                label="Open Amount Dispute"
                pendingLabel="Submitting Dispute..."
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
              />
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
