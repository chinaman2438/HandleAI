"use client";

import React, { useState } from "react";
import Link from "next/link";
import { EyeOff, ChevronDown } from "lucide-react";
import type { InternalReceivableRow } from "@/lib/data/internal-queries";
import { resolveMissingInstallmentAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate } from "@/lib/format";
import { PendingSubmitButton } from "@/components/internal/pending-submit-button";

const PAGE_STEP = 10;

export function MissingInstallmentsList({
  items,
}: {
  items: InternalReceivableRow[];
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  const remaining = items.length - visibleCount;

  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        All overdue missing installments have been resolved.
      </div>
    );
  }

  return (
    <div>
      <div className="divide-y divide-slate-200">
        {visibleItems.map((item) => (
          <div key={item.id} className="p-5 hover:bg-slate-50/60">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-800">
                    missing_from_latest_report
                  </span>
                  <span className="rounded-md bg-red-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-800">
                    {item.daysOverdue}d overdue
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    <EyeOff className="h-3 w-3" /> Hidden from Customer Portal
                  </span>
                </div>

                <h3 className="text-sm font-bold text-slate-900">
                  Overdue installment missing from latest report ({item.daysOverdue} days overdue)
                </h3>
                <p className="text-xs text-slate-600">
                  Installment {item.installmentNumber}/{item.totalInstallments} (
                  {formatBrl(item.outstandingBalanceBrl)}, due{" "}
                  {formatBrDate(item.currentDueDate)}) was overdue and disappeared from the
                  latest insurer report without Paid or Cancelled status.
                </p>

                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
                  <span>
                    <strong>Group:</strong> {item.organizationName}
                  </span>
                  <span>
                    <strong>Policyholder:</strong> {item.policyholderName}
                  </span>
                  <span>
                    <strong>Insurer:</strong> {item.insurer}
                  </span>
                  <span>
                    <strong>Policy:</strong>{" "}
                    <span className="font-mono">{item.policyNumber}</span>
                  </span>
                  <span>
                    <strong>Installment:</strong> {item.installmentNumber}/
                    {item.totalInstallments}
                  </span>
                  <span>
                    <strong>Amount:</strong>{" "}
                    <span className="font-mono font-semibold">
                      {formatBrl(item.outstandingBalanceBrl)}
                    </span>
                  </span>
                  <span>
                    <strong>Original Due:</strong> {formatBrDate(item.originalDueDate)}
                  </span>
                  <span>
                    <strong>Extended Due:</strong> {formatBrDate(item.extendedDueDate)}
                  </span>
                  <span>
                    <strong>Current Due:</strong> {formatBrDate(item.currentDueDate)}
                  </span>
                </div>

                <div className="pt-1">
                  <Link
                    href={`/internal/installments/${item.id}`}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Inspect full installment record →
                  </Link>
                </div>
              </div>

              {/* Staff Resolution Form */}
              <form
                action={resolveMissingInstallmentAction}
                className="w-full lg:w-96 rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5 shrink-0"
              >
                <input type="hidden" name="installmentId" value={item.id} />

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600">
                    Resolution Action
                  </label>
                  <select
                    name="resolutionAction"
                    defaultValue="return_open"
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  >
                    <option value="return_open">Return to report as Open</option>
                    <option value="paid_keep_hidden">Paid &amp; keep hidden</option>
                    <option value="return_cancelled">Return to report as Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600">
                    Audit Resolution Notes (Optional)
                  </label>
                  <input
                    type="text"
                    name="resolutionNotes"
                    placeholder="Verified against insurer policy schedule..."
                    className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>

                <PendingSubmitButton
                  label="Apply Resolution"
                  pendingLabel="Applying Resolution..."
                />
              </form>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="border-t border-slate-200 bg-slate-50 px-5 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-slate-600">
            Showing <strong>{visibleItems.length}</strong> of{" "}
            <strong>{items.length}</strong> overdue missing installments
          </span>
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => prev + PAGE_STEP)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
            Load more ({Math.min(PAGE_STEP, remaining)} more)
          </button>
        </div>
      )}
    </div>
  );
}
