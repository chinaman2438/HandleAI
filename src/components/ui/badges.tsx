import React from "react";

export function PaymentStatusBadge({
  status,
  isOverdue,
  isCredit,
}: {
  status: string;
  isOverdue?: boolean;
  isCredit?: boolean;
}) {
  if (isCredit) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
        Credit / Refund
      </span>
    );
  }

  switch (status) {
    case "paid":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          Paid (Confirmed)
        </span>
      );
    case "partially_paid":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Partially Paid
        </span>
      );
    case "under_review":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Receipt Under Review
        </span>
      );
    case "cancelled":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-600/25">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
          Cancelled
        </span>
      );
    case "missing_from_latest_report":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-800 ring-1 ring-inset ring-purple-600/25">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-600" />
          Missing from Report
        </span>
      );
    default:
      if (isOverdue) {
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/25">
            <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
            Overdue
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          Open
        </span>
      );
  }
}

export function VerificationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "confirmed":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Confirmed by Insurer
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Awaiting Insurer Confirmation
        </span>
      );
  }
}

export function ExtensionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Approved by Insurer
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          Rejected by Insurer
        </span>
      );
    case "submitted_to_insurer":
    case "awaiting_response":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Submitted — Awaiting Insurer Response
        </span>
      );
    case "superseded":
      return (
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20">
          Superseded
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Requested (Pending Insurer Approval)
        </span>
      );
  }
}

export function RiskLevelBadge({ level }: { level: string }) {
  switch (level) {
    case "critical":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/30">
          Critical Risk
        </span>
      );
    case "high":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-orange-600/30">
          High Risk
        </span>
      );
    case "medium":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Medium Risk
        </span>
      );
    case "low":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
          Low Risk
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          None
        </span>
      );
  }
}

export function ExceptionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "approved":
    case "resolved":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          {status === "approved" ? "Approved" : "Resolved"}
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20">
          Rejected
        </span>
      );
    case "awaiting_insurer":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Awaiting Insurer
        </span>
      );
    case "awaiting_customer":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/25">
          Response Sent — Awaiting Customer
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/25">
          Pending Review
        </span>
      );
  }
}
