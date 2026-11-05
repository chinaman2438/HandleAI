import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { parseReceivablesWorkbook } from "../src/lib/import/parser";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const fileArg = process.argv[2] ?? "meridian-receivables-2026-11-02.xlsx";
  const filePath = path.resolve(process.cwd(), fileArg);

  const parsed = await parseReceivablesWorkbook(filePath, {
    fileName: path.basename(filePath),
  });

  const outDir = path.resolve(process.cwd(), "import-reports");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `import-report-${parsed.snapshotDate}.json`);
  const mdPath = path.join(outDir, `import-report-${parsed.snapshotDate}.md`);

  const heldRows = parsed.rows.filter((r) => r.outcome === "held");
  const dupRows = parsed.rows.filter((r) => r.outcome === "duplicate_skipped");
  const refRows = parsed.rows.filter((r) => r.hadRefErrorInCurrentDue);
  const zeroRows = parsed.rows.filter(
    (r) => r.sourceInstallmentNumber === 0 && r.outcome !== "ignored"
  );
  const creditRows = parsed.rows.filter((r) => r.isCredit && r.outcome !== "ignored");

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        fileName: parsed.fileName,
        snapshotDate: parsed.snapshotDate,
        headerRowNumber: parsed.headerRowNumber,
        summary: parsed.summary,
        heldRows: heldRows.map((r) => ({
          rowNumber: r.rowNumber,
          group: r.groupNameDisplay,
          policyholder: r.policyholderName,
          policyNumber: r.policyNumber,
          installment: `${r.sourceInstallmentNumber}/${r.totalInstallments}`,
          amountBrl: r.amountBrl,
          issues: r.issues,
        })),
        duplicateSkippedRows: dupRows.map((r) => ({
          rowNumber: r.rowNumber,
          recordKey: r.recordKey,
          issues: r.issues,
        })),
        formulaRefFixedRows: refRows.map((r) => ({
          rowNumber: r.rowNumber,
          policyNumber: r.policyNumber,
          resolvedCurrentDueDate: r.currentDueDate,
        })),
      },
      null,
      2
    ),
    "utf8"
  );

  const mdLines: string[] = [
    `# Import Report — ${parsed.fileName}`,
    ``,
    `- **Snapshot Date**: \`${parsed.snapshotDate}\``,
    `- **Detected Header Row**: Row \`${parsed.headerRowNumber}\``,
    `- **Total Data Rows**: \`${parsed.dataRowCount}\``,
    `- **Customer-Visible Valid Rows**: \`${parsed.summary.validCount}\``,
    `- **Held-Back Rows (Data-Quality Queue)**: \`${parsed.summary.heldCount}\``,
    `- **Duplicates Skipped**: \`${parsed.summary.duplicateSkippedCount}\``,
    `- **Ignored Blank/Footer Rows**: \`${parsed.summary.ignoredCount}\``,
    `- **#REF! Formula Errors Resolved**: \`${parsed.summary.refErrorCount}\``,
    `- **Swapped Date Flags**: \`${parsed.summary.swappedDateCount}\``,
    `- **Installment 0 (Upfront 1/1)**: \`${parsed.summary.installmentZeroCount}\``,
    `- **Negative Credit/Refund Rows**: \`${parsed.summary.negativeAmountCount}\``,
    ``,
    `## Rows Held Back from Customer Visibility (${heldRows.length})`,
    ``,
    `| Row | Group | Policy No. | Installment | Amount (BRL) | Reason Held Back |`,
    `|---|---|---|---|---:|---|`,
    ...heldRows.map(
      (r) =>
        `| ${r.rowNumber} | ${r.groupNameDisplay} | \`${r.policyNumber}\` | ${r.sourceInstallmentNumber}/${r.totalInstallments} | R$ ${r.amountBrl.toFixed(2)} | ${r.issues.map((i) => i.title).join("; ")} |`
    ),
    ``,
    `## Duplicate Rows Skipped (${dupRows.length})`,
    ``,
    `| Row | Key | Classification |`,
    `|---|---|---|`,
    ...dupRows.map(
      (r) =>
        `| ${r.rowNumber} | \`${r.recordKey}\` | ${r.issues.map((i) => i.title).join("; ")} |`
    ),
    ``,
    `## #REF! Formula Errors Resolved (${refRows.length})`,
    ``,
    `| Row | Group | Policy No. | Original Due | Extended Due | Resolved Current Due |`,
    `|---|---|---|---|---|---|`,
    ...refRows.map(
      (r) =>
        `| ${r.rowNumber} | ${r.groupNameDisplay} | \`${r.policyNumber}\` | ${r.originalDueDate} | ${r.extendedDueDate ?? "—"} | **${r.currentDueDate}** |`
    ),
    ``,
    `## Upfront Installment 0 Normalized to 1/1 (${zeroRows.length})`,
    ``,
    `| Row | Group | Policyholder | Policy No. | Amount (BRL) |`,
    `|---|---|---|---|---:|`,
    ...zeroRows.map(
      (r) =>
        `| ${r.rowNumber} | ${r.groupNameDisplay} | ${r.policyholderName} | \`${r.policyNumber}\` | R$ ${r.amountBrl.toFixed(2)} |`
    ),
    ``,
    `## Negative Credit / Refund Endorsements (${creditRows.length})`,
    ``,
    `| Row | Group | Policyholder | Policy No. | Endorsement | Credit Amount (BRL) |`,
    `|---|---|---|---|---|---:|`,
    ...creditRows.map(
      (r) =>
        `| ${r.rowNumber} | ${r.groupNameDisplay} | ${r.policyholderName} | \`${r.policyNumber}\` | ${r.endorsement} | R$ ${r.amountBrl.toFixed(2)} |`
    ),
  ];

  fs.writeFileSync(mdPath, mdLines.join("\n"), "utf8");
  console.log(`[generate-import-report] Wrote:\n  - ${mdPath}\n  - ${jsonPath}`);
}

main().catch((err) => {
  console.error("[generate-import-report] Failed:", err);
  process.exit(1);
});
