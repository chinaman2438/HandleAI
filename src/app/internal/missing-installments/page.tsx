import { CheckCircle2, EyeOff, Wrench } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalMissingInstallmentsData } from "@/lib/data/internal-queries";
import { MissingInstallmentsList } from "@/components/internal/missing-installments-list";

export const dynamic = "force-dynamic";

export default async function InternalMissingInstallmentsPage() {
  const user = await requireStaffUser();
  const { missingInstallments, resolvedCount } =
    await getInternalMissingInstallmentsData(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Missing Installments Review
          </h1>
          <p className="text-sm text-slate-600">
            Overdue installments that disappeared from the latest insurer report without Paid or Cancelled status. Review each record to return it to the customer report or confirm payment.
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 shadow-xs min-w-[220px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
              Missing Installments
            </span>
            <EyeOff className="h-4 w-4 text-rose-600 shrink-0" />
          </div>
          <p className="mt-1.5 text-xl font-bold text-rose-950">
            {missingInstallments.length} installments
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 shadow-xs min-w-[180px]">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Resolved
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          </div>
          <p className="mt-1.5 text-xl font-bold text-emerald-950">
            {resolvedCount}
          </p>
        </div>
      </div>

      {/* Overdue Missing Installments Queue */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-rose-600" />
            Overdue Installments Missing from Report ({missingInstallments.length})
          </h2>
          <p className="text-xs text-slate-500">
            Returning an installment to the report as Open or Cancelled makes it visible to the customer; marking it Paid keeps it hidden.
          </p>
        </div>

        <MissingInstallmentsList items={missingInstallments} />
      </div>
    </div>
  );
}
