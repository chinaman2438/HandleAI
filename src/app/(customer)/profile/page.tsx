import React from "react";
import { Building2, ShieldCheck, UserCircle } from "lucide-react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerInstallments } from "@/lib/data/customer-queries";
import { formatBrl } from "@/lib/format";

export default async function CustomerProfilePage() {
  const user = await requireCustomerUser();
  const installments = await getCustomerInstallments(user);

  // Group subsidiary policyholders filed under this customer organization
  const subMap = new Map<
    string,
    {
      name: string;
      taxId: string | null;
      installmentCount: number;
      outstandingBrl: number;
      policies: Set<string>;
    }
  >();

  for (const inst of installments) {
    const key = `${inst.policyholderName}|${inst.policyholderTaxId ?? ""}`;
    let entry = subMap.get(key);
    if (!entry) {
      entry = {
        name: inst.policyholderName,
        taxId: inst.policyholderTaxId,
        installmentCount: 0,
        outstandingBrl: 0,
        policies: new Set(),
      };
      subMap.set(key, entry);
    }
    entry.installmentCount++;
    entry.policies.add(inst.policyNumber);
    if (!inst.isCredit && inst.paymentStatus !== "paid" && inst.paymentStatus !== "cancelled") {
      entry.outstandingBrl += inst.outstandingBalanceBrl;
    }
  }

  const subsidiaries = [...subMap.values()].sort(
    (a, b) => b.installmentCount - a.installmentCount
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {user.organizationName} — Corporate Group Profile &amp; Subsidiary Scope
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Account details, RLS security scope, and subsidiary legal entities filed under{" "}
          <span className="font-semibold text-slate-800">{user.organizationName}</span>.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900">
            <UserCircle className="h-5 w-5 text-blue-600" />
            Authenticated User Profile
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <div className="text-slate-500">Full Name</div>
              <div className="font-semibold text-slate-900">{user.fullName}</div>
            </div>
            <div>
              <div className="text-slate-500">Email</div>
              <div className="font-semibold text-slate-900">{user.email}</div>
            </div>
            <div>
              <div className="text-slate-500">Portal Role</div>
              <div className="font-semibold text-blue-700 uppercase">{user.role}</div>
            </div>
            <div>
              <div className="text-slate-500">Assigned Corporate Group</div>
              <div className="font-semibold text-slate-900">{user.organizationName}</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl bg-white border border-slate-200 p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-2.5 text-sm font-bold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Multi-Subsidiary &amp; Joint-Venture Access Control Rule
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            In Meridian&apos;s receivables architecture, access is determined strictly by the{" "}
            <strong>Corporate Group</strong> recorded on each policy rather than by the subsidiary&apos;s
            name or CNPJ alone. When a joint-venture legal entity (such as{" "}
            <strong>Terminal Portuário Sul S.A.</strong>) has policies placed through different corporate
            groups, PostgreSQL Row Level Security (RLS) ensures{" "}
            <strong>{user.organizationName}</strong> only sees the policies and installments contracted
            under {user.organizationName}.
          </p>
        </div>
      </div>

      {/* Subsidiary Policyholders Table */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-600" />
            Policyholders Filed Under {user.organizationName} ({subsidiaries.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-4">Policyholder Legal Entity</th>
                <th className="py-3 px-3">Brazilian Tax ID (CNPJ)</th>
                <th className="py-3 px-3 text-right">Policies in Group</th>
                <th className="py-3 px-3 text-right">Visible Installments</th>
                <th className="py-3 px-4 text-right">Outstanding Balance (BRL)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {subsidiaries.map((sub) => (
                <tr key={`${sub.name}-${sub.taxId}`} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {sub.name}
                    {sub.name.toLowerCase().includes("terminal") && (
                      <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20">
                        Joint-Venture Entity (Scoped to {user.organizationName})
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 tabular-nums text-slate-600">
                    {sub.taxId ?? "—"}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums text-slate-700">
                    {sub.policies.size}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-medium text-slate-900">
                    {sub.installmentCount}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">
                    {formatBrl(sub.outstandingBrl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
