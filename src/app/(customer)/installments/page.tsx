import React from "react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerInstallments } from "@/lib/data/customer-queries";
import { CustomerInstallmentsTable } from "@/components/customer/customer-installments-table";

export default async function CustomerInstallmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; status?: string }>;
}) {
  const user = await requireCustomerUser();
  const rows = await getCustomerInstallments(user);
  const sp = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {user.organizationName} — Policy Installments
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Complete schedule of overdue, upcoming, and settled installments across all subsidiaries filed under{" "}
          <span className="font-semibold text-slate-800">{user.organizationName}</span>.
          Click any row to upload a payment receipt, request an extension, or open an amount dispute.
        </p>
      </div>

      <CustomerInstallmentsTable
        rows={rows}
        initialWindow={sp.window ?? "all"}
        initialStatus={sp.status ?? "all"}
      />
    </div>
  );
}
