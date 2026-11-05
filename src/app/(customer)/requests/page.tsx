import React from "react";
import Link from "next/link";
import { Clock, Scale, Receipt, ArrowUpRight } from "lucide-react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerRequestsAndDocuments } from "@/lib/data/customer-queries";
import { formatBrl, formatBrDate, formatBrDateTime } from "@/lib/format";
import {
  ExtensionStatusBadge,
  ExceptionStatusBadge,
} from "@/components/ui/badges";

export default async function CustomerRequestsPage() {
  const user = await requireCustomerUser();
  const { exceptions, extensions } = await getCustomerRequestsAndDocuments(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {user.organizationName} — Request &amp; Extension History
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Track the real-time status of your extension requests, payment receipt verifications,
          and amount disputes without internal jargon.
        </p>
      </div>

      {/* Section 1: Service Requests (Receipts, Extensions, Amount Disputes) */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Scale className="h-4 w-4 text-blue-600" />
              Active &amp; Resolved Customer Requests ({exceptions.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Includes payment receipt reviews, extension requests, and amount discrepancy investigations.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {exceptions.map((req) => (
            <div key={req.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-700">
                    {req.type.replace(/_/g, " ")}
                  </span>
                  <Link
                    href={`/installments/${req.installmentId}`}
                    className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Policy {req.policyNumber} · Inst {req.installmentNumber}/{req.totalInstallments}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                  <span className="text-xs text-slate-500">
                    ({req.policyholderName} · {req.insurer})
                  </span>
                </div>
                <ExceptionStatusBadge status={req.status} />
              </div>

              {req.description && (
                <div className="text-xs text-slate-700">{req.description}</div>
              )}

              {req.requestedAmount !== null && (
                <div className="text-xs text-slate-600">
                  Customer Expected Amount:{" "}
                  <strong className="text-slate-900 tabular-nums">
                    {formatBrl(req.requestedAmount)}
                  </strong>{" "}
                  · Billed Installment Amount:{" "}
                  <strong className="text-slate-900 tabular-nums">
                    {formatBrl(req.amountBrl)}
                  </strong>
                </div>
              )}

              {req.endorsementReference && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-950">
                  <span className="font-semibold">Insurer Breakdown Reference:</span>{" "}
                  {req.endorsementReference}
                  {req.insurerBreakdownReceivedOn && (
                    <span className="ml-2 text-blue-800">
                      (Received {formatBrDate(req.insurerBreakdownReceivedOn)})
                    </span>
                  )}
                </div>
              )}

              {req.customerResponse && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-800">
                  <span className="font-semibold text-slate-900">Meridian Response:</span>{" "}
                  {req.customerResponse}
                </div>
              )}

              <div className="text-[11px] text-slate-400">
                Opened {formatBrDateTime(req.createdAt)} · Current Due Date:{" "}
                {formatBrDate(req.currentDueDate)}
              </div>
            </div>
          ))}

          {exceptions.length === 0 && (
            <div className="py-10 text-center text-xs text-slate-500">
              No customer service requests submitted yet.
            </div>
          )}
        </div>
      </div>

      {/* Section 2: All Extension Attempts History */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            All Extension Attempts Across {user.organizationName} ({extensions.length})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every extension attempt is preserved permanently. Only insurer-confirmed decisions change an installment&apos;s official due date.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-4">Policy / Policyholder</th>
                <th className="py-3 px-3">Inst.</th>
                <th className="py-3 px-3">Attempt</th>
                <th className="py-3 px-3">Requested Date</th>
                <th className="py-3 px-3">Approved Date</th>
                <th className="py-3 px-3">Current Official Due</th>
                <th className="py-3 px-3">Protocol No.</th>
                <th className="py-3 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {extensions.slice(0, 60).map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4">
                    <Link
                      href={`/installments/${e.installmentId}`}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {e.policyNumber}
                    </Link>
                    <div className="text-[11px] text-slate-500">
                      {e.policyholderName} · {e.insurer}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 tabular-nums text-slate-700">
                    {e.installmentNumber}/{e.totalInstallments}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                    #{e.attemptNumber}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums text-slate-700">
                    {formatBrDate(e.requestedDueDate)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums font-semibold text-emerald-700">
                    {e.approvedDueDate ? formatBrDate(e.approvedDueDate) : "—"}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums font-semibold text-slate-900">
                    {formatBrDate(e.currentDueDate)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">
                    {e.protocolNumber ?? "Pending"}
                  </td>
                  <td className="py-2.5 px-3">
                    <ExtensionStatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
              {extensions.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                    No extension attempts recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
