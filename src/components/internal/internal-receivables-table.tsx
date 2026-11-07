"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Filter, AlertTriangle } from "lucide-react";
import { InternalReceivableRow } from "@/lib/data/internal-queries";
import {
  formatBrl,
  formatBrDate,
  formatInstallmentLabel,
} from "@/lib/format";
import {
  PaymentStatusBadge,
  RiskLevelBadge,
} from "@/components/ui/badges";

export function InternalReceivablesTable({
  rows,
}: {
  rows: InternalReceivableRow[];
}) {
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [policyholderFilter, setPolicyholderFilter] = useState("all");
  const [lobFilter, setLobFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");

  const orgs = useMemo(
    () => [...new Set(rows.map((r) => r.organizationName))].sort(),
    [rows]
  );
  const insurers = useMemo(
    () => [...new Set(rows.map((r) => r.insurer))].sort(),
    [rows]
  );
  const policyholders = useMemo(
    () => [...new Set(rows.map((r) => r.policyholderName))].sort(),
    [rows]
  );
  const lobs = useMemo(
    () => [...new Set(rows.map((r) => r.insuranceType))].sort(),
    [rows]
  );
  const managers = useMemo(
    () =>
      [...new Set(rows.map((r) => r.accountManager).filter(Boolean) as string[])].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (orgFilter !== "all" && r.organizationName !== orgFilter) return false;
      if (insurerFilter !== "all" && r.insurer !== insurerFilter) return false;
      if (policyholderFilter !== "all" && r.policyholderName !== policyholderFilter)
        return false;
      if (lobFilter !== "all" && r.insuranceType !== lobFilter) return false;
      if (statusFilter === "held") {
        if (r.isCustomerVisible) return false;
      } else if (statusFilter === "credit") {
        if (!r.isCredit) return false;
      } else if (statusFilter === "missing_from_latest_report") {
        if (r.paymentStatus !== "missing_from_latest_report" && !r.isMissingFromLatest) return false;
      } else if (statusFilter !== "all" && r.paymentStatus !== statusFilter) {
        return false;
      }
      if (bucketFilter !== "all" && r.agingBucket !== bucketFilter) return false;
      if (managerFilter !== "all" && r.accountManager !== managerFilter) return false;
      if (riskFilter !== "all" && r.riskLevel !== riskFilter) return false;

      if (q) {
        const hay = [
          r.organizationName,
          r.policyholderName,
          r.policyholderTaxId ?? "",
          r.policyNumber,
          r.insurer,
          r.insuranceType,
          r.accountManager ?? "",
          r.branch ?? "",
          r.latestInternalNote ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    search,
    orgFilter,
    insurerFilter,
    policyholderFilter,
    lobFilter,
    statusFilter,
    bucketFilter,
    managerFilter,
    riskFilter,
  ]);

  return (
    <div className="space-y-4">
      {/* Filter Panel */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Filter className="h-3.5 w-3.5 text-blue-600" />
            Portfolio Filters (Organization, Insurer, Policyholder, LOB, Status, Aging Bucket, Account Manager)
          </div>
          <div className="text-xs text-slate-600">
            Showing <span className="font-bold text-slate-900">{filtered.length}</span> of{" "}
            {rows.length} installments
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search group, policyholder, CNPJ, policy no., manager, or internal note..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            aria-label="Filter by organization"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Customer Groups ({orgs.length})</option>
            {orgs.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <select
            value={policyholderFilter}
            onChange={(e) => setPolicyholderFilter(e.target.value)}
            aria-label="Filter by policyholder"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Policyholders ({policyholders.length})</option>
            {policyholders.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={insurerFilter}
            onChange={(e) => setInsurerFilter(e.target.value)}
            aria-label="Filter by insurer"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Insurers ({insurers.length})</option>
            {insurers.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>

          <select
            value={lobFilter}
            onChange={(e) => setLobFilter(e.target.value)}
            aria-label="Filter by insurance type"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Insurance Types ({lobs.length})</option>
            {lobs.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Payment Statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Receipt Under Review</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="missing_from_latest_report">Missing from Latest Report</option>
            <option value="held">Held Back from Customer (DQ)</option>
            <option value="credit">Credits / Refunds Only</option>
          </select>

          <select
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value)}
            aria-label="Filter by aging bucket"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Aging Buckets</option>
            <option value="current">Current (Not Overdue)</option>
            <option value="1-30">1–30 Days Overdue</option>
            <option value="31-60">31–60 Days Overdue</option>
            <option value="61-89">61–89 Days Overdue</option>
            <option value="90+">90+ Days Overdue</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Account Manager:</span>
              <select
                value={managerFilter}
                onChange={(e) => setManagerFilter(e.target.value)}
                aria-label="Filter by account manager"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              >
                <option value="all">All Managers ({managers.length})</option>
                {managers.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Cancellation Risk:</span>
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                aria-label="Filter by risk level"
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              >
                <option value="all">All Risk Levels</option>
                <option value="critical">Critical Risk</option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setOrgFilter("all");
              setInsurerFilter("all");
              setPolicyholderFilter("all");
              setLobFilter("all");
              setStatusFilter("all");
              setBucketFilter("all");
              setManagerFilter("all");
              setRiskFilter("all");
            }}
            className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-3">Organization / Policyholder</th>
                <th className="py-3 px-3">Policy No.</th>
                <th className="py-3 px-3">Insurer / Type</th>
                <th className="py-3 px-2 text-center">Inst.</th>
                <th className="py-3 px-3 text-right">Amount</th>
                <th className="py-3 px-3 text-right">Outst. Balance</th>
                <th className="py-3 px-3">Current Due</th>
                <th className="py-3 px-2 text-center">Days Overdue</th>
                <th className="py-3 px-2 text-center">Aging Bucket</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-2 text-center">Ext. Count</th>
                <th className="py-3 px-3">Cancellation Risk</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.slice(0, 150).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/90">
                  <td className="py-2.5 px-3">
                    <div className="font-bold text-slate-900">{r.organizationName}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                      {r.policyholderName}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <Link
                      href={`/internal/installments/${r.id}`}
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {r.policyNumber}
                    </Link>
                    <div className="text-[11px] text-slate-400">
                      End. {r.endorsement} · {r.accountManager ?? "—"}
                    </div>
                    {!r.isCustomerVisible && (
                      <span className="mt-0.5 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                        HELD FROM CUSTOMER
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-900">{r.insurer}</div>
                    <div className="text-[11px] text-slate-500">{r.insuranceType}</div>
                  </td>
                  <td className="py-2.5 px-2 text-center tabular-nums font-medium text-slate-800">
                    {formatInstallmentLabel(
                      r.installmentNumber,
                      r.totalInstallments,
                      r.sourceInstallmentNumber
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 whitespace-nowrap">
                    {formatBrl(r.amountBrl)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900 whitespace-nowrap">
                    {r.isCredit ? "Credit" : formatBrl(r.outstandingBalanceBrl)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                    <div className="font-semibold text-slate-900">
                      {formatBrDate(r.currentDueDate)}
                    </div>
                    {r.latestCheckedBy && (
                      <div className="text-[10px] text-slate-400">
                        Chk: {r.latestCheckedBy}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center tabular-nums">
                    {r.daysOverdue > 0 ? (
                      <span className="font-bold text-red-700">{r.daysOverdue}d</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${
                        r.agingBucket === "90+"
                          ? "bg-red-100 text-red-800"
                          : r.agingBucket === "61-89"
                            ? "bg-orange-100 text-orange-800"
                            : r.agingBucket === "31-60"
                              ? "bg-amber-100 text-amber-800"
                              : r.agingBucket === "1-30"
                                ? "bg-blue-50 text-blue-700"
                                : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {r.agingBucket}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <PaymentStatusBadge
                      status={r.isMissingFromLatest ? "missing_from_latest_report" : r.paymentStatus}
                      isOverdue={r.daysOverdue > 0}
                      isCredit={r.isCredit}
                    />
                  </td>
                  <td className="py-2.5 px-2 text-center tabular-nums">
                    <div className="inline-flex items-center justify-center gap-1">
                      <span className="font-semibold text-slate-900">
                        {r.extensionAttempts}
                      </span>
                      {r.extensionAttempts >= 2 && (
                        <span title="2+ extensions — insurer reluctance warning">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <RiskLevelBadge level={r.riskLevel} />
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <Link
                      href={`/internal/installments/${r.id}`}
                      className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
                    >
                      Inspect
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-xs text-slate-500">
                    No installments match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 150 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            Showing first 150 of {filtered.length} matching records. Use filters or search to refine.
          </div>
        )}
      </div>
    </div>
  );
}
