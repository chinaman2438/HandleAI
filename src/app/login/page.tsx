import React from "react";
import { redirect } from "next/navigation";
import { ShieldCheck, Building2, Briefcase, Lock, ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import {
  loginAsDemoUserAction,
  loginWithEmailAction,
} from "@/lib/actions/portal-actions";
import { DEMO_USERS } from "@/lib/auth/demo-users";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.role === "customer" ? "/dashboard" : "/internal/dashboard");
  }

  const sp = await searchParams;
  const errorMsg =
    sp.error === "invalid_credentials"
      ? "Invalid email or password. Use one of the demo emails below or click a Demo Persona card."
      : sp.error === "missing_org"
        ? "Customer profile is not assigned to a corporate group."
        : null;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Brand & Standard Sign-In */}
        <div className="lg:col-span-5 bg-white rounded-xl shadow-xl border border-slate-200 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-xs">
              M
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                Meridian Insurance Brokers
              </h1>
              <p className="text-xs text-slate-500">
                Corporate Receivables & Policy Installments Portal
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          <form action={loginWithEmailAction} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Corporate Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                defaultValue="admin@meridian.demo"
                placeholder="name@company.com.br"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                defaultValue="Meridian2026!"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <Lock className="h-4 w-4" />
              Sign In to Portal
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200 space-y-2 text-xs text-slate-500">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
              Strict PostgreSQL Row Level Security (RLS)
            </div>
            <p>
              Customer accounts only access installments filed under their own corporate group.
              Internal notes, Checked By, and Sent to Client On are isolated to Meridian staff.
            </p>
          </div>
        </div>

        {/* Right Column: Instant Demo Personas */}
        <div className="lg:col-span-7 bg-slate-800/70 backdrop-blur-xs rounded-xl border border-slate-700 p-6 sm:p-8 text-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <span className="inline-flex items-center rounded-md bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-300 ring-1 ring-inset ring-blue-400/30">
                1-Click Evaluation Access
              </span>
              <h2 className="text-base font-bold text-white mt-2">
                Select a Role to Demonstrate Key Workflows
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Pre-loaded with the 1,454-row workbook (<code className="text-blue-300">meridian-receivables-2026-11-02.xlsx</code>) & historical snapshots.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {/* Internal Staff Personas */}
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              Meridian Internal Operations
            </div>

            <form action={loginAsDemoUserAction}>
              <input type="hidden" name="userId" value={DEMO_USERS.admin.id} />
              <button
                type="submit"
                className="w-full text-left rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-slate-700 hover:border-blue-500 p-3.5 transition-all flex items-center justify-between gap-4 cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0 mt-0.5">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      Alex Moraes — Head of Receivables
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                        MERIDIAN ADMIN
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Full access to all 12 corporate groups, Week-over-Week analytics, Cancellation Risk, Excel sync, DQ review queue & user management.
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-400 shrink-0" />
              </button>
            </form>

            <form action={loginAsDemoUserAction}>
              <input type="hidden" name="userId" value={DEMO_USERS.employee.id} />
              <button
                type="submit"
                className="w-full text-left rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-slate-700 hover:border-blue-500 p-3.5 transition-all flex items-center justify-between gap-4 cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-300 shrink-0 mt-0.5">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      Bruno Tavares — Account Manager & Receivables Specialist
                      <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                        MERIDIAN EMPLOYEE
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Verifies payment receipts with insurers, records extension protocol numbers, resolves amount disputes & adds confidential internal notes.
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-400 shrink-0" />
              </button>
            </form>

            {/* Customer Group Personas */}
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300 pt-2">
              Corporate Customer Groups (RLS Scoped)
            </div>

            <form action={loginAsDemoUserAction}>
              <input type="hidden" name="userId" value={DEMO_USERS.atlantica.id} />
              <button
                type="submit"
                className="w-full text-left rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-slate-700 hover:border-emerald-500 p-3.5 transition-all flex items-center justify-between gap-4 cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      Mariana Costa — Grupo Atlântica Finance Team
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        CUSTOMER GROUP
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Sees Atlântica Logística, Ferrovias, Portos, Energia &amp; Terminal Portuário Sul (Atlântica policies only). Includes Demo Extension (<code className="text-emerald-300">01.18.0004471</code>) &amp; Demo Dispute (<code className="text-emerald-300">01.18.4183925</code>).
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-400 shrink-0" />
              </button>
            </form>

            <form action={loginAsDemoUserAction}>
              <input type="hidden" name="userId" value={DEMO_USERS.serraVerde.id} />
              <button
                type="submit"
                className="w-full text-left rounded-lg bg-slate-900/90 hover:bg-slate-900 border border-slate-700 hover:border-emerald-500 p-3.5 transition-all flex items-center justify-between gap-4 cursor-pointer group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0 mt-0.5">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-2">
                      Roberto Almeida — Grupo Serra Verde Finance Team
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        JOINT-VENTURE TEST
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Sees Serra Verde Agroindustrial, Serra Verde Açúcar e Etanol, Usina Boa Vista &amp; ONLY Terminal Portuário Sul policies hired by Grupo Serra Verde.
                    </p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-400 shrink-0" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
