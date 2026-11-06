import React from "react";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { loginWithEmailAction } from "@/lib/actions/portal-actions";

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
      ? "Invalid email or password."
      : sp.error === "missing_org"
        ? "Customer profile is not assigned to a corporate group."
        : null;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full mx-auto">
        <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 sm:p-8">
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
        </div>
      </div>
    </div>
  );
}
