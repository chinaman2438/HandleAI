import Link from "next/link";
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalImportsAndDq } from "@/lib/data/internal-queries";
import { formatBrDate, formatBrDateTime } from "@/lib/format";
import { ExcelUploadForm } from "@/components/internal/excel-upload-form";

export const dynamic = "force-dynamic";

export default async function InternalImportsPage() {
  const user = await requireStaffUser();
  const { batches, issues } = await getInternalImportsAndDq(user);

  const openHeldIssues = issues.filter((i) => i.status === "open" && i.holdsVisibility);
  const openWarnings = issues.filter((i) => i.status === "open" && !i.holdsVisibility);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Excel Import & Weekly Snapshot Synchronization
          </h1>
          <p className="text-sm text-slate-600">
            Upload weekly receivables workbooks, inspect import reconciliation summaries, and verify historical preservation.
          </p>
        </div>
        <Link
          href="/internal/data-quality"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-amber-700"
        >
          <AlertTriangle className="h-4 w-4" />
          Review Data-Quality Queue ({openHeldIssues.length} held)
        </Link>
      </div>

      {/* Upload Form & Pipeline Rules */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Upload Receivables Workbook</h2>
              <p className="text-xs text-slate-500">Supports .xlsx exports with title banner rows</p>
            </div>
          </div>

          <ExcelUploadForm />
        </div>

        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Import Normalization & Data-Quality Safeguards
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Every uploaded workbook passes through a deterministic 12-rule normalization and validation pipeline before touching customer-visible records:
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="font-bold text-slate-900">1. Header & Footer Auto-Detection</p>
              <p className="mt-0.5 text-slate-600">
                Automatically locates the true header row, extracts the snapshot date from Row 2, and skips blank or <code>TOTAL</code> summary rows.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="font-bold text-slate-900">2. Group Name & Policyholder Normalization</p>
              <p className="mt-0.5 text-slate-600">
                Normalizes casing, accents, and punctuation across Customer Groups while preserving Joint-Venture policyholders across groups.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="font-bold text-slate-900">3. Formula Errors (#REF!) & Swapped Dates</p>
              <p className="mt-0.5 text-slate-600">
                Replaces <code>#REF!</code> in Current Due Date with <code>COALESCE(Extended, Original)</code> and logs a warning. Holds back rows where Extended Due Date &lt; Original Due Date.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="font-bold text-slate-900">4. Duplicate & Historical Preservation</p>
              <p className="mt-0.5 text-slate-600">
                Deduplicates identical rows, holds back conflicting duplicates, never overwrites portal receipts/extensions, and flags missing overdue rows for investigation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Import Batch History Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-600" />
              Import Batch History ({batches.length})
            </h2>
            <p className="text-xs text-slate-500">
              Audit log of every spreadsheet import and weekly historical snapshot stored in <code>public.import_batches</code>.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            Open Warnings: <strong>{openWarnings.length}</strong> • Held Rows: <strong>{openHeldIssues.length}</strong>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Snapshot Date</th>
                <th className="px-4 py-3">File Name & Status</th>
                <th className="px-4 py-3 text-right">Data Rows</th>
                <th className="px-4 py-3 text-right">Inserted</th>
                <th className="px-4 py-3 text-right">Updated</th>
                <th className="px-4 py-3 text-right">Unchanged</th>
                <th className="px-4 py-3 text-right">Held Back</th>
                <th className="px-4 py-3 text-right">Duplicates Skipped</th>
                <th className="px-4 py-3 text-right">Warnings</th>
                <th className="px-4 py-3">Imported At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">
                    {formatBrDate(b.snapshotDate)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold text-slate-900">{b.fileName}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        {b.status}
                      </span>
                      {b.duplicateOf && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                          Idempotent Re-import
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{b.totalRows}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700">
                    {b.importedRows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-blue-700">{b.updatedRows}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {b.unchangedRows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-amber-700">
                    {b.heldRows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {b.duplicateRows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">
                    {b.warningCount}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatBrDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
