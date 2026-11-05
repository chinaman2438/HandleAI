import React from "react";
import Link from "next/link";
import { FileText, Download, ShieldCheck } from "lucide-react";
import { requireCustomerUser } from "@/lib/auth/session";
import { getCustomerRequestsAndDocuments } from "@/lib/data/customer-queries";
import { formatBrDateTime } from "@/lib/format";

export default async function CustomerDocumentsPage() {
  const user = await requireCustomerUser();
  const { documents } = await getCustomerRequestsAndDocuments(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {user.organizationName} — Receipts &amp; Supporting Documents
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Private document vault for payment receipts uploaded by your team and official insurer breakdowns shared by Meridian.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-800">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Private Storage Bucket · Signed Download Authorization
        </div>
      </div>

      <div className="rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                <th className="py-3 px-4">File Name</th>
                <th className="py-3 px-3">Document Type</th>
                <th className="py-3 px-3">Policy / Installment</th>
                <th className="py-3 px-3">Policyholder / Insurer</th>
                <th className="py-3 px-3">Uploaded At</th>
                <th className="py-3 px-4 text-right">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                    <span>{doc.fileName}</span>
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 uppercase">
                      {doc.documentType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    {doc.installmentId ? (
                      <Link
                        href={`/installments/${doc.installmentId}`}
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        {doc.policyNumber ?? "View"} ({doc.installmentNumber}/{doc.totalInstallments})
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-3 px-3 text-slate-600">
                    {doc.policyholderName ?? "—"} · {doc.insurer ?? "—"}
                  </td>
                  <td className="py-3 px-3 text-slate-500 tabular-nums">
                    {formatBrDateTime(doc.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <a
                      href={`/api/documents/${doc.id}/download`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                    No documents uploaded for {user.organizationName} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
