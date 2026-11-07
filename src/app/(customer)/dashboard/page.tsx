import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  Receipt,
  Clock,
  Scale,
  ArrowUpRight,
  CreditCard,
  Bell,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerDashboardData } from "@/lib/data/customer-queries";
import {
  formatBrl,
  formatBrDate,
  formatBrDateTime,
  formatInstallmentLabel,
} from "@/lib/format";
import {
  PaymentStatusBadge,
  VerificationStatusBadge,
} from "@/components/ui/badges";

export default async function CustomerDashboardPage() {
  const user = await requireCustomerUser();
  const data = await getCustomerDashboardData(user);
  const { kpis } = data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {data.organizationName} — Receivables Overview
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Prioritizing overdue installments and payments due in the next 30 days across all subsidiaries filed under{" "}
            <span className="font-semibold text-slate-800">{data.organizationName}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/installments?view=all"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            View All Installments
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Track My Requests ({kpis.pendingExtensionsCount + kpis.pendingDisputesCount + kpis.paymentsUnderReviewCount})
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="rounded-xl bg-white border border-red-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-red-700">
            <span>Overdue Installments</span>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-red-700 tabular-nums">
            {formatBrl(kpis.overdueAmountBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{kpis.overdueCount}</span> overdue installments
          </div>
        </div>

        <div className="rounded-xl bg-white border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
            <span>Due in Next 30 Days</span>
            <CalendarClock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
            {formatBrl(kpis.dueNext30AmountBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{kpis.dueNext30Count}</span> upcoming (1–30d)
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Total Outstanding Debt</span>
            <CreditCard className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
            {formatBrl(kpis.totalOutstandingBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Positive debt only (credits excluded)
          </div>
        </div>

        <div className="rounded-xl bg-white border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
            <span>Receipts Under Review</span>
            <Receipt className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-amber-800 tabular-nums">
            {formatBrl(kpis.paymentsUnderReviewBrl)}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">{kpis.paymentsUnderReviewCount}</span> awaiting insurer
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Pending Extensions</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
            {kpis.pendingExtensionsCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Awaiting insurer decision
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span>Pending Disputes</span>
            <Scale className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums">
            {kpis.pendingDisputesCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Active amount discrepancies
          </div>
        </div>
      </div>

      {/* Credits / Refunds Callout (Always separated from debt) */}
      {kpis.creditsCount > 0 && (
        <div className="rounded-xl bg-blue-50/80 border border-blue-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-950">
              <span className="font-semibold">
                {kpis.creditsCount} Credit / Refund Endorsement(s) totaling {formatBrl(kpis.creditsAmountBrl)}:
              </span>{" "}
              Negative installment amounts represent premium return credits and are strictly excluded from your overdue and outstanding debt totals.
            </div>
          </div>
          <Link
            href="/installments?status=credit"
            className="text-xs font-semibold text-blue-700 hover:underline shrink-0"
          >
            View Credit Endorsements →
          </Link>
        </div>
      )}

      {/* Main Two-Column Grid: Overdue & Due in Next 30 Days */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Section 1: Overdue Installments */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-red-50/40">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-600" />
                Overdue Installments ({data.overdueInstallments.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Immediate action recommended to avoid insurer late-payment or cancellation notices.
              </p>
            </div>
            <Link
              href="/installments?window=overdue"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              View All ({data.overdueInstallments.length}) →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                  <th className="py-2.5 px-4">Policy / Policyholder</th>
                  <th className="py-2.5 px-3">Inst.</th>
                  <th className="py-2.5 px-3">Due Date</th>
                  <th className="py-2.5 px-3 text-right">Balance (BRL)</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {data.overdueInstallments.slice(0, 8).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{item.policyNumber}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                        {item.policyholderName} · {item.insurer}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-700">
                      {formatInstallmentLabel(
                        item.installmentNumber,
                        item.totalInstallments,
                        item.sourceInstallmentNumber
                      )}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">
                      <div className="font-medium text-red-700">
                        {formatBrDate(item.currentDueDate)}
                      </div>
                      <div className="text-[11px] text-red-600">
                        {Math.abs(item.daysFromToday ?? 0)}d overdue
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                      {formatBrl(item.outstandingBalanceBrl)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Link
                        href={`/installments/${item.id}`}
                        className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
                {data.overdueInstallments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                      No overdue installments for {data.organizationName}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 2: Due in Next 30 Days */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50/40">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Installments Due in Next 30 Days ({data.dueSoonInstallments.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload payment receipts or request insurer extensions before the due date.
              </p>
            </div>
            <Link
              href="/installments?window=due_30"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              View All ({data.dueSoonInstallments.length}) →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                  <th className="py-2.5 px-4">Policy / Policyholder</th>
                  <th className="py-2.5 px-3">Inst.</th>
                  <th className="py-2.5 px-3">Current Due</th>
                  <th className="py-2.5 px-3 text-right">Balance (BRL)</th>
                  <th className="py-2.5 px-4 text-right">Status / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {data.dueSoonInstallments.slice(0, 8).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{item.policyNumber}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                        {item.policyholderName} · {item.insurer}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-700">
                      {formatInstallmentLabel(
                        item.installmentNumber,
                        item.totalInstallments,
                        item.sourceInstallmentNumber
                      )}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">
                      <div className="font-medium text-slate-900">
                        {formatBrDate(item.currentDueDate)}
                      </div>
                      <div className="text-[11px] text-amber-700">
                        {item.daysFromToday === 0
                          ? "Due today"
                          : `In ${item.daysFromToday} day(s)`}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-slate-900">
                      {formatBrl(item.outstandingBalanceBrl)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <PaymentStatusBadge status={item.paymentStatus} />
                        <Link
                          href={`/installments/${item.id}`}
                          className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                        >
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.dueSoonInstallments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                      No installments due in the next 30 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Three-Column Grid: Payments Awaiting Confirmation, Upcoming Reminders, Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payments Awaiting Confirmation */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-600" />
              Payments Awaiting Insurer Confirmation
            </h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {data.paymentsAwaitingConfirmation.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Submitted receipts remain under review until the insurer confirms settlement. Only confirmed amounts reduce your official balance.
          </p>
          <div className="space-y-3">
            {data.paymentsAwaitingConfirmation.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-slate-200 p-3 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <Link
                    href={`/installments/${p.installmentId}`}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Policy {p.policyNumber} · Inst {p.installmentNumber}/{p.totalInstallments}
                  </Link>
                  <span className="text-xs font-bold text-slate-900 tabular-nums">
                    {formatBrl(p.amountBrl)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {p.policyholderName} · Paid on {formatBrDate(p.paymentDate)}
                </div>
                <div className="mt-2">
                  <VerificationStatusBadge status={p.verificationStatus} />
                </div>
              </div>
            ))}
            {data.paymentsAwaitingConfirmation.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">
                No unconfirmed payment receipts currently under review.
              </div>
            )}
          </div>
        </div>

        {/* Upcoming Payment Reminders Timeline (Section 14) */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-600" />
              Upcoming Due-Date &amp; Reminder Schedule
            </h3>
            <span className="text-[11px] font-medium text-slate-500">Default: T-3 days</span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Automated reminders are scheduled 3 days before each active positive-balance installment falls due.
          </p>
          <div className="space-y-2.5">
            {data.upcomingReminders.map((r) => (
              <Link
                key={r.installmentId}
                href={`/installments/${r.installmentId}`}
                className="block rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    {r.policyNumber} ({r.installmentNumber}/{r.totalInstallments})
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatBrl(r.outstandingBalanceBrl)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                  <span className="truncate max-w-[160px]">{r.policyholderName}</span>
                  <span className="font-medium text-amber-700">
                    Due {formatBrDate(r.currentDueDate)} ({r.daysUntilDue}d)
                  </span>
                </div>
              </Link>
            ))}
            {data.upcomingReminders.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">
                No installments due within the next 14 days.
              </div>
            )}
          </div>
        </div>

        {/* Recent Customer-Visible Activity */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              Recent Activity Timeline
            </h3>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Permanent audit log of your receipt uploads, extension approvals, and dispute updates.
          </p>
          <div className="space-y-3">
            {data.recentActivity.slice(0, 6).map((a) => (
              <div key={a.id} className="border-l-2 border-blue-500 pl-3 py-0.5">
                <div className="text-xs text-slate-800">{a.description}</div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-400">
                  <span>{formatBrDateTime(a.createdAt)}</span>
                  {a.installmentId && (
                    <Link
                      href={`/installments/${a.installmentId}`}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Open installment →
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {data.recentActivity.length === 0 && (
              <div className="text-xs text-slate-500 py-4 text-center">
                No recent activity recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
