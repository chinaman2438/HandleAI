import React from "react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalReceivablesList } from "@/lib/data/internal-queries";
import { InternalReceivablesTable } from "@/components/internal/internal-receivables-table";

export default async function InternalReceivablesPage() {
  const staff = await requireStaffUser();
  const rows = await getInternalReceivablesList(staff);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          Meridian Receivables Portfolio — All Corporate Groups
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Search and filter all {rows.length} installments across 12 corporate groups, 6 insurers, and 10 lines of business.
          Aging buckets follow the non-overlapping 1–30, 31–60, 61–89, and 90+ days convention.
        </p>
      </div>

      <InternalReceivablesTable rows={rows} />
    </div>
  );
}
