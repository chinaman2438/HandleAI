"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { uploadExcelSpreadsheetAction } from "@/lib/actions/portal-actions";
import type { SyncBatchResult } from "@/lib/import/sync";
import { formatBrDate } from "@/lib/format";
import { FileInput } from "@/components/ui/file-input";

export function ExcelUploadForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const res = await uploadExcelSpreadsheetAction(formData);
        setResult(res);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to import Excel workbook.");
      }
    });
  }

  return (
    <div className="mt-4 space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Excel Workbook (.xlsx)
          </label>
          <FileInput
            name="excelFile"
            accept=".xlsx,.xls"
            required
            disabled={isPending}
            buttonVariant="primary"
            className="mt-1 py-2"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700">
            Override Snapshot Date (Optional)
          </label>
          <input
            type="date"
            name="snapshotDate"
            disabled={isPending}
            placeholder="Auto-detected from filename or banner"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 disabled:opacity-60"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Leave blank to auto-detect from filename (e.g. <code>meridian-receivables-2026-11-09</code>) or banner.
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing & Synchronizing Workbook...
            </>
          ) : (
            "Run Idempotent Import & Generate Snapshot"
          )}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Import Failed</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-950 space-y-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-emerald-900">
                Workbook Synchronized ({result.fileName})
              </p>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                Snapshot Date: <strong>{formatBrDate(result.snapshotDate)}</strong>
                {result.isIdempotentReimport ? " • Idempotent Re-import Verified" : ""}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px]">
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Data Rows</span>
              <span className="font-mono font-bold text-slate-900">{result.totalRows}</span>
            </div>
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Inserted / Updated</span>
              <span className="font-mono font-bold text-emerald-700">
                {result.importedRows} / {result.updatedRows}
              </span>
            </div>
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Unchanged</span>
              <span className="font-mono font-bold text-slate-800">
                {result.unchangedRows}
              </span>
            </div>
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Held Back (DQ)</span>
              <span className="font-mono font-bold text-amber-700">{result.heldRows}</span>
            </div>
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Duplicates Skipped</span>
              <span className="font-mono font-bold text-slate-700">
                {result.duplicateRows}
              </span>
            </div>
            <div className="rounded bg-white/80 border border-emerald-200/80 px-2 py-1">
              <span className="text-slate-500 block">Warnings</span>
              <span className="font-mono font-bold text-amber-700">
                {result.warningCount}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
