import path from "node:path";
import dotenv from "dotenv";
import { parseReceivablesWorkbook } from "../src/lib/import/parser";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const fileArg = process.argv[2] ?? "meridian-receivables-2026-11-02.xlsx";
  const filePath = path.resolve(process.cwd(), fileArg);

  console.log(`[validate-import] Parsing workbook: ${filePath}`);
  const parsed = await parseReceivablesWorkbook(filePath, {
    fileName: path.basename(filePath),
  });

  console.log("------------------------------------------------------------");
  console.log(`File Name          : ${parsed.fileName}`);
  console.log(`SHA-256 Hash       : ${parsed.fileHash.slice(0, 16)}...`);
  console.log(`Worksheet          : ${parsed.sheetName}`);
  console.log(`Detected Header Row: Row ${parsed.headerRowNumber}`);
  console.log(`Snapshot Date      : ${parsed.snapshotDate}`);
  console.log(`Total Sheet Rows   : ${parsed.totalSheetRows}`);
  console.log(`Data Rows          : ${parsed.dataRowCount}`);
  console.log("------------------------------------------------------------");
  console.log(`Valid Rows         : ${parsed.summary.validCount}`);
  console.log(`Held-Back Rows     : ${parsed.summary.heldCount}`);
  console.log(`Rejected Rows      : ${parsed.summary.rejectedCount}`);
  console.log(`Duplicate Skipped  : ${parsed.summary.duplicateSkippedCount}`);
  console.log(`Ignored (Blank/Tot): ${parsed.summary.ignoredCount}`);
  console.log(`#REF! Formula Fixed: ${parsed.summary.refErrorCount}`);
  console.log(`Swapped Dates Flag : ${parsed.summary.swappedDateCount}`);
  console.log(`Installment 0 (1/1): ${parsed.summary.installmentZeroCount}`);
  console.log(`Negative Credits   : ${parsed.summary.negativeAmountCount}`);
  console.log("------------------------------------------------------------");

  const heldRows = parsed.rows.filter((r) => r.outcome === "held" || r.outcome === "rejected");
  if (heldRows.length > 0) {
    console.log(`\nHeld-Back / Rejected Rows (${heldRows.length}):`);
    for (const r of heldRows) {
      console.log(
        `  - Row ${r.rowNumber} [${r.groupNameDisplay} | Policy ${r.policyNumber} | Inst ${r.sourceInstallmentNumber}]: ${r.issues.map((i) => i.title).join("; ")}`
      );
    }
  }
}

main().catch((err) => {
  console.error("[validate-import] Failed:", err);
  process.exit(1);
});
