import path from "node:path";
import dotenv from "dotenv";
import { parseReceivablesWorkbook } from "../src/lib/import/parser";
import { syncWorkbookToDatabase } from "../src/lib/import/sync";
import { getServiceDb } from "../src/lib/db/engine";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const fileArg = process.argv[2] ?? "meridian-receivables-2026-11-02.xlsx";
  const filePath = path.resolve(process.cwd(), fileArg);

  console.log(`[import-excel] Parsing ${path.basename(filePath)}...`);
  const parsed = await parseReceivablesWorkbook(filePath, {
    fileName: path.basename(filePath),
  });

  const db = await getServiceDb();
  console.log(`[import-excel] Synchronizing ${parsed.dataRowCount} rows into PostgreSQL...`);
  const result = await syncWorkbookToDatabase(db, parsed, {
    actorLabel: "CLI Import (scripts/import-excel.ts)",
  });

  console.log("============================================================");
  console.log("IMPORT SYNCHRONIZATION COMPLETE");
  console.log("============================================================");
  console.log(`Batch ID            : ${result.batchId}`);
  console.log(`File Name           : ${result.fileName}`);
  console.log(`Snapshot Date       : ${result.snapshotDate}`);
  console.log(`Total Data Rows     : ${result.totalRows}`);
  console.log(`New Imported        : ${result.importedRows}`);
  console.log(`Updated             : ${result.updatedRows}`);
  console.log(`Unchanged           : ${result.unchangedRows}`);
  console.log(`Held Back (DQ Queue): ${result.heldRows}`);
  console.log(`Rejected            : ${result.rejectedRows}`);
  console.log(`Duplicates Skipped  : ${result.duplicateRows}`);
  console.log(`Missing vs Previous : ${result.missingRows} (Overdue: ${result.missingOverdueRows})`);
  console.log(`Idempotent Re-import: ${result.isIdempotentReimport}`);
  console.log("============================================================");
}

main().catch((err) => {
  console.error("[import-excel] Failed:", err);
  process.exit(1);
});
