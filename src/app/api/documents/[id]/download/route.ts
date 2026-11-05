import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withRlsSession } from "@/lib/db/engine";
import { formatBrl, formatBrDate } from "@/lib/format";

function buildSimplePdfBuffer(lines: string[]): Buffer {
  const escapedLines = lines.map((line) =>
    line
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
  );

  let textOps = "BT\n/F1 11 Tf\n50 760 Td\n16 TL\n";
  escapedLines.forEach((line, idx) => {
    if (idx === 0) {
      textOps += `(${line}) Tj\n`;
    } else {
      textOps += `T* (${line}) Tj\n`;
    }
  });
  textOps += "ET\n";

  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(textOps, "utf8")} >>\nstream\n${textOps}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await context.params;

  const doc = await withRlsSession(user.id, async (tx) => {
    const res = await tx.query<{
      id: string;
      file_name: string;
      mime_type: string;
      document_type: string;
      storage_path: string;
      created_at: string;
      organization_name: string;
      policy_number: string | null;
      insurer: string | null;
      installment_number: number | null;
      total_installments: number | null;
      amount_brl: string | null;
    }>(
      `select
         d.id,
         d.file_name,
         d.mime_type,
         d.document_type,
         d.storage_path,
         d.created_at::text,
         o.name as organization_name,
         p.policy_number,
         p.insurer,
         i.installment_number,
         i.total_installments,
         i.amount_brl::text
       from public.documents d
       join public.organizations o on o.id = d.organization_id
       left join public.installments i on i.id = d.installment_id
       left join public.policies p on p.id = i.policy_id
      where d.id = $1
      limit 1`,
      [id]
    );
    return res.rows[0] ?? null;
  });

  if (!doc) {
    return NextResponse.json(
      { error: "Document not found or access denied by Row Level Security" },
      { status: 404 }
    );
  }

  const pdfBuffer = buildSimplePdfBuffer([
    "MERIDIAN CORRETORA DE SEGUROS - PORTAL DE RECEBIVEIS",
    "--------------------------------------------------------------------",
    `Document ID: ${doc.id}`,
    `File Name: ${doc.file_name}`,
    `Document Type: ${doc.document_type.toUpperCase()}`,
    `Corporate Group: ${doc.organization_name}`,
    `Policy Number: ${doc.policy_number ?? "N/A"} (${doc.insurer ?? "N/A"})`,
    `Installment: ${doc.installment_number ?? "-"} / ${doc.total_installments ?? "-"}`,
    `Installment Amount: ${doc.amount_brl ? formatBrl(Number(doc.amount_brl)) : "N/A"}`,
    `Uploaded On: ${formatBrDate(doc.created_at.slice(0, 10))}`,
    `Storage Path: ${doc.storage_path}`,
    "--------------------------------------------------------------------",
    "Authenticated via PostgreSQL Row Level Security (RLS) Verification.",
    `Downloaded by: ${user.fullName} (${user.email} - Role: ${user.role})`,
  ]);

  const safeFilename = doc.file_name.endsWith(".pdf")
    ? doc.file_name
    : `${doc.file_name}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
