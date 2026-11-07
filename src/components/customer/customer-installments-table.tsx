"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Filter, ArrowUpDown } from "lucide-react";
import { CustomerInstallmentRow } from "@/lib/data/customer-queries";
import {
  formatBrl,
  formatBrDate,
  formatInstallmentLabel,
} from "@/lib/format";
import { PaymentStatusBadge } from "@/components/ui/badges";

export function CustomerInstallmentsTable({
  rows,
  initialWindow = "all",
  initialStatus = "all",
}: {
  rows: CustomerInstallmentRow[];
  initialWindow?: string;
  initialStatus?: string;
}) {
  const [search, setSearch] = useState("");
  const [windowFilter, setWindowFilter] = useState(initialWindow);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [insurerFilter, setInsurerFilter] = useState("all");
  const [lobFilter, setLobFilter] = useState("all");
  const [policyholderFilter, setPolicyholderFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"currentDueDate" | "amountBrl" | "outstandingBalanceBrl" | "policyNumber">("currentDueDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const insurers = useMemo(
    () => [...new Set(rows.map((r) => r.insurer))].sort(),
    [rows]
  );
  const lobs = useMemo(
    () => [...new Set(rows.map((r) => r.insuranceType))].sort(),
    [rows]
  );
  const policyholders = useMemo(
    () => [...new Set(rows.map((r) => r.policyholderName))].sort(),
    [rows]
  );
  const branches = useMemo(
    () => [...new Set(rows.map((r) => r.branch).filter(Boolean) as string[])].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (windowFilter === "overdue" && !r.isOverdue) return false;
        if (windowFilter === "due_30" && !r.isDueInNext30Days) return false;
        if (windowFilter === "priority" && !r.isOverdue && !r.isDueInNext30Days)
          return false;

        if (statusFilter === "credit") {
          if (!r.isCredit) return false;
        } else if (statusFilter !== "all" && r.paymentStatus !== statusFilter) {
          return false;
        }

        if (insurerFilter !== "all" && r.insurer !== insurerFilter) return false;
        if (lobFilter !== "all" && r.insuranceType !== lobFilter) return false;
        if (policyholderFilter !== "all" && r.policyholderName !== policyholderFilter)
          return false;
        if (branchFilter !== "all" && r.branch !== branchFilter) return false;

        if (q) {
          const hay = [
            r.policyNumber,
            r.policyholderName,
            r.policyholderTaxId ?? "",
            r.insurer,
            r.insuranceType,
            r.branch ?? "",
            r.accountManager ?? "",
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const mult = sortDir === "asc" ? 1 : -1;
        if (sortBy === "amountBrl") return (a.amountBrl - b.amountBrl) * mult;
        if (sortBy === "outstandingBalanceBrl")
          return (a.outstandingBalanceBrl - b.outstandingBalanceBrl) * mult;
        if (sortBy === "policyNumber")
          return a.policyNumber.localeCompare(b.policyNumber) * mult;
        return (
          (a.currentDueDate ?? "9999-99-99").localeCompare(
            b.currentDueDate ?? "9999-99-99"
          ) * mult
        );
      });
  }, [
    rows,
    search,
    windowFilter,
    statusFilter,
    insurerFilter,
    lobFilter,
    policyholderFilter,
    branchFilter,
    sortBy,
    sortDir,
  ]);

  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  return (
    <div className="space-y-4">
      {/* Quick Window Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-2xs">
          {[
            { id: "all", label: `All Installments (${rows.length})` },
            {
              id: "overdue",
              label: `Overdue (${rows.filter((r) => r.isOverdue).length})`,
            },
            {
              id: "due_30",
              label: `Due in Next 30 Days (${rows.filter((r) => r.isDueInNext30Days).length})`,
            },
            {
              id: "priority",
              label: "Overdue + Next 30 Days",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setWindowFilter(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                windowFilter === tab.id
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-600">
          Showing <span className="font-semibold text-slate-900">{filtered.length}</span> of{" "}
          {rows.length} records
        </div>
      </div>

      {/* Filter Bar */}
      <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <Filter className="h-3.5 w-3.5 text-blue-600" />
          Search &amp; Multi-Dimension Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search policy no., policyholder, CNPJ, manager..."
              className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by payment status"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All Payment Statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Receipt Under Review</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="paid">Paid (Confirmed)</option>
            <option value="cancelled">Cancelled</option>
            <option value="credit">Credits / Refunds Only</option>
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
            <option value="all">All Insurance Types</option>
            {lobs.map((l) => (
              <option key={l} value={l}>
                {l}
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">Branch:</label>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter by branch"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setWindowFilter("all");
              setStatusFilter("all");
              setInsurerFilter("all");
              setLobFilter("all");
              setPolicyholderFilter("all");
              setBranchFilter("all");
            }}
            className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
          >
            Reset all filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort("policyNumber")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                  >
                    Policy No. <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-3">Policyholder</th>
                <th className="py-3 px-3">Insurer / Type</th>
                <th className="py-3 px-3">Branch / Manager</th>
                <th className="py-3 px-2 text-center">End.</th>
                <th className="py-3 px-2 text-center">Inst.</th>
                <th className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("amountBrl")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                  >
                    Amount <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-3">Orig. Due</th>
                <th className="py-3 px-3">Ext. Due</th>
                <th className="py-3 px-3">
                  <button
                    type="button"
                    onClick={() => toggleSort("currentDueDate")}
                    className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                  >
                    Current Due <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.slice(0, 150).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/90">
                  <td className="py-2.5 px-3 font-semibold text-slate-900 whitespace-nowrap">
                    <Link
                      href={`/installments/${r.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.policyNumber}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-900">{r.policyholderName}</div>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {r.policyholderTaxId ?? "—"}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-800">{r.insurer}</div>
                    <div className="text-[11px] text-slate-500">{r.insuranceType}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="text-slate-800">{r.branch ?? "—"}</div>
                    <div className="text-[11px] text-slate-500">
                      {r.accountManager ?? "—"}
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-center tabular-nums text-slate-700">
                    {r.endorsement}
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
                  <td className="py-2.5 px-3 tabular-nums text-slate-600 whitespace-nowrap">
                    {formatBrDate(r.originalDueDate)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums text-slate-600 whitespace-nowrap">
                    {formatBrDate(r.extendedDueDate)}
                  </td>
                  <td className="py-2.5 px-3 tabular-nums whitespace-nowrap">
                    <div
                      className={`font-semibold ${
                        r.isOverdue ? "text-red-700" : "text-slate-900"
                      }`}
                    >
                      {formatBrDate(r.currentDueDate)}
                    </div>
                    {r.daysFromToday !== null &&
                      r.paymentStatus !== "paid" &&
                      r.paymentStatus !== "cancelled" &&
                      !r.isCredit && (
                        <div
                          className={`text-[10px] ${
                            r.daysFromToday < 0
                              ? "text-red-600 font-medium"
                              : r.daysFromToday <= 30
                                ? "text-amber-700"
                                : "text-slate-400"
                          }`}
                        >
                          {r.daysFromToday < 0
                            ? `${Math.abs(r.daysFromToday)}d overdue`
                            : r.daysFromToday === 0
                              ? "Due today"
                              : `In ${r.daysFromToday}d`}
                        </div>
                      )}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <PaymentStatusBadge
                      status={r.paymentStatus}
                      isOverdue={r.isOverdue}
                      isCredit={r.isCredit}
                    />
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <Link
                      href={`/installments/${r.id}`}
                      className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-xs text-slate-500">
                    No installments match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 150 && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
            Showing first 150 of {filtered.length} matching installments. Use search or filters above to narrow results.
          </div>
        )}
      </div>
    </div>
  );
}
