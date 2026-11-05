import { Building2, Users, GitMerge, ShieldCheck, UserPlus } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalCustomersAndUsers } from "@/lib/data/internal-queries";
import { createOrgAndUserAction } from "@/lib/actions/portal-actions";
import { formatBrl } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InternalCustomersPage() {
  const user = await requireStaffUser();
  const { organizations, users, jointVentures } = await getInternalCustomersAndUsers(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800 border border-indigo-200">
            Section 4 • Corporate Groups, Joint-Venture Policyholders & Access Control
          </span>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Customer Groups, Subsidiaries & Portal Users
          </h1>
          <p className="text-sm text-slate-600">
            Normalized corporate groups, subsidiary policyholders, Joint-Venture cross-group isolation, and role-based user accounts.
          </p>
        </div>
      </div>

      {/* Joint Venture Isolation Highlight */}
      {jointVentures.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-indigo-600 p-2 text-white shrink-0">
              <GitMerge className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-indigo-950">
                Joint-Venture Policyholder Isolation Verified ({jointVentures.length} Shared Entity)
              </h2>
              <p className="mt-0.5 text-xs text-indigo-900">
                In the reference dataset, <strong>Terminal Portuário Sul S.A.</strong> (CNPJ{" "}
                <code>85.551.345/0001-10</code>) is a joint venture with policies under multiple corporate groups. Because <code>policyholders</code> are modeled independently and scoped via <code>policies.organization_id</code>, each corporate group only sees its own policies and installments for this policyholder under PostgreSQL Row Level Security.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {jointVentures.map((jv) =>
                  jv.breakdown.map((b) => (
                    <span
                      key={b}
                      className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-indigo-900 border border-indigo-200"
                    >
                      {jv.name} → {b}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Corporate Groups Table */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-600" />
                Canonical Corporate Groups ({organizations.length})
              </h2>
              <p className="text-xs text-slate-500">
                Normalized from 15 raw spreadsheet strings (casing, accents, and punctuation unified).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Corporate Group</th>
                  <th className="px-4 py-3">Subsidiary Policyholders</th>
                  <th className="px-4 py-3 text-right">Policies</th>
                  <th className="px-4 py-3 text-right">Installments</th>
                  <th className="px-4 py-3 text-right">Overdue BRL</th>
                  <th className="px-4 py-3 text-right">Total Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {organizations.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-bold text-slate-900">{org.name}</div>
                      <div className="font-mono text-[10px] text-slate-400">
                        key: {org.normalizedName}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {org.policyholders.map((ph) => (
                          <span
                            key={ph}
                            className={`rounded px-1.5 py-0.5 text-[11px] ${
                              ph.includes("Terminal Portuário Sul")
                                ? "bg-indigo-100 font-semibold text-indigo-900"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {ph}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono text-slate-700">
                      {org.policyCount}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono text-slate-700">
                      {org.visibleCount}/{org.installmentCount}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono font-semibold text-rose-700">
                      {formatBrl(org.overdueBrl)}
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono font-bold text-slate-900">
                      {formatBrl(org.outstandingBrl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Admin Provisioning Form & Active Users */}
        <div className="space-y-6">
          {user.role === "admin" && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Admin: Create / Assign Portal Account
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Provision a new customer organization or link a portal user to an existing corporate group.
              </p>

              <form action={createOrgAndUserAction} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Corporate Group Name
                  </label>
                  <input
                    type="text"
                    name="organizationName"
                    required
                    placeholder="e.g. Grupo Atlântica"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    User Full Name
                  </label>
                  <input
                    type="text"
                    name="userFullName"
                    placeholder="e.g. Carla Mendes"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    User Email
                  </label>
                  <input
                    type="email"
                    name="userEmail"
                    placeholder="carla@atlantica.demo"
                    className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Portal Role
                  </label>
                  <select
                    name="userRole"
                    defaultValue="customer"
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  >
                    <option value="customer">Customer (Organization Scoped via RLS)</option>
                    <option value="employee">Meridian Employee (Internal Portfolio)</option>
                    <option value="admin">Meridian Admin (Full Access)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  Save Organization & User Profile
                </button>
              </form>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-600" />
                Provisioned Portal Accounts ({users.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {users.map((u) => (
                <div key={u.id} className="p-3.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{u.fullName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        u.role === "admin"
                          ? "bg-purple-100 text-purple-800"
                          : u.role === "employee"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-slate-500">{u.email}</div>
                  <div className="mt-1 flex items-center gap-1 text-slate-600">
                    <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                    {u.organizationName ? (
                      <span>Scoped to: <strong>{u.organizationName}</strong></span>
                    ) : (
                      <span>Meridian Internal Staff (All Organizations)</span>
                    )}
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
