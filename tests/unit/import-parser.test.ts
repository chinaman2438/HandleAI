import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalGroupDisplayName,
  isExcelFormulaError,
  normalizeGroupKey,
  parseBrazilianDate,
  parseBrlAmount,
  parseReceivablesWorkbook,
} from "../../src/lib/import/parser";

describe("Excel Import Parser & Normalization Unit Tests", () => {
  it("parses Brazilian currency values including negative credit amounts", () => {
    expect(parseBrlAmount(41839.25)).toBe(41839.25);
    expect(parseBrlAmount("R$ 128.450,90")).toBe(128450.9);
    expect(parseBrlAmount("-R$ 4.185,54")).toBe(-4185.54);
    expect(parseBrlAmount("(1.250,00)")).toBe(-1250);
    expect(parseBrlAmount("")).toBeNull();
  });

  it("parses Brazilian DD/MM/YYYY dates and detects #REF! formula errors", () => {
    expect(parseBrazilianDate("02/11/2026")).toBe("2026-11-02");
    expect(parseBrazilianDate("2026-11-15")).toBe("2026-11-15");
    expect(isExcelFormulaError("#REF!")).toBe("#REF!");
    expect(isExcelFormulaError({ error: "#REF!" })).toBe("#REF!");
    expect(parseBrazilianDate("#REF!")).toBeNull();
  });

  it("normalizes all dirty Customer Group variants to canonical corporate groups", () => {
    expect(normalizeGroupKey("GRUPO ATLANTICA")).toBe("grupo atlantica");
    expect(normalizeGroupKey("Grupo Atlantica")).toBe("grupo atlantica");
    expect(normalizeGroupKey("Grupo Atlântica")).toBe("grupo atlantica");
    expect(canonicalGroupDisplayName("GRUPO ATLANTICA").display).toBe("Grupo Atlântica");
    expect(canonicalGroupDisplayName("GRUPO SERRA VERDE").display).toBe("Grupo Serra Verde");
    expect(canonicalGroupDisplayName("CONSTRUTORA PILAR").display).toBe("Construtora Pilar");
  });

  it("profiles meridian-receivables-2026-11-02.xlsx and handles all 12 data-quality edge cases", async () => {
    const filePath = path.resolve(process.cwd(), "meridian-receivables-2026-11-02.xlsx");
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseReceivablesWorkbook(buffer, {
      fileName: "meridian-receivables-2026-11-02.xlsx",
    });

    // Header & Snapshot detection
    expect(parsed.headerRowNumber).toBe(4);
    expect(parsed.snapshotDate).toBe("2026-11-02");

    // Row counts: 1458 total rows -> Row 4 header, Rows 1457-1458 footer -> 1452 data rows
    expect(parsed.totalSheetRows).toBe(1458);
    expect(parsed.dataRowCount).toBe(1452);
    expect(parsed.summary.ignoredCount).toBe(2);

    // 9 duplicate-skipped rows -> 1443 unique installments (1429 valid + 14 held) across 12 canonical corporate groups
    expect(parsed.summary.duplicateSkippedCount).toBe(9);
    expect(parsed.summary.validCount).toBe(1429);
    expect(parsed.summary.heldCount).toBe(14);

    const activeRows = parsed.rows.filter(
      (r) => r.outcome === "valid" || r.outcome === "held"
    );
    expect(activeRows.length).toBe(1443);

    const uniqueGroups = new Set(activeRows.map((r) => r.groupNameDisplay));
    expect(uniqueGroups.size).toBe(12);

    // 2 missing policyholder rows (Rows 7 and 263)
    const missingPhRows = parsed.rows.filter((r) =>
      r.issues.some((i) => i.code === "missing_policyholder")
    );
    expect(missingPhRows.map((r) => r.rowNumber).sort((a, b) => a - b)).toEqual([7, 263]);

    // 5 #REF! formula errors in Current Due Date repaired via fallback
    expect(parsed.summary.refErrorCount).toBe(5);
    const refRows = parsed.rows.filter((r) => r.hadRefErrorInCurrentDue);
    expect(refRows.length).toBe(5);
    for (const r of refRows) {
      expect(r.currentDueDate).toBeTruthy();
    }

    // 10 swapped-date rows detected
    expect(parsed.summary.swappedDateCount).toBe(10);

    // 8 rows with installment = 0 normalized to 1/1 while preserving sourceInstallmentNumber = 0
    expect(parsed.summary.installmentZeroCount).toBe(8);
    const instZeroRows = activeRows.filter((r) => r.sourceInstallmentNumber === 0);
    expect(instZeroRows.length).toBe(8);
    for (const r of instZeroRows) {
      expect(r.installmentNumber).toBe(1);
    }

    // 3 negative credit / endorsement adjustment rows
    expect(parsed.summary.negativeAmountCount).toBe(3);
    const creditRows = activeRows.filter((r) => r.isCredit);
    expect(creditRows.length).toBe(3);
    for (const c of creditRows) {
      expect(c.amountBrl).toBeLessThan(0);
    }

    // Joint-Venture policyholder Terminal Portuário Sul S.A. present under both Grupo Atlântica and Grupo Serra Verde
    const tpsRows = activeRows.filter((r) => r.policyholderTaxId === "85.551.345/0001-10");
    expect(tpsRows.length).toBe(49);
    const tpsAtlantica = tpsRows.filter((r) => r.groupNameDisplay === "Grupo Atlântica");
    const tpsSerraVerde = tpsRows.filter((r) => r.groupNameDisplay === "Grupo Serra Verde");
    expect(tpsAtlantica.length).toBe(35);
    expect(tpsSerraVerde.length).toBe(14);
  });

  it("detects snapshot date from filename when uploading meridian-receivables-2026-11-09", async () => {
    const filePath = path.resolve(process.cwd(), "meridian-receivables-2026-11-02.xlsx");
    const buffer = fs.readFileSync(filePath);
    const parsed = await parseReceivablesWorkbook(buffer, {
      fileName: "meridian-receivables-2026-11-09.xlsx",
    });

    expect(parsed.snapshotDate).toBe("2026-11-09");
  });
});
