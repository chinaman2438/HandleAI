import ExcelJS from "exceljs";
import crypto from "crypto";

export interface RawExcelRow {
  rowNumber: number;
  group: string | null;
  policyholder: string | null;
  policyholderTaxId: string | null;
  insurer: string | null;
  lineOfBusiness: string | null;
  policyNumber: string | null;
  endorsement: string | null;
  installment: string | null;
  totalInstallments: string | null;
  amountRaw: string | number | null;
  originalDueDateRaw: unknown;
  extendedDueDateRaw: unknown;
  currentDueDateRaw: unknown;
  paymentStatusRaw: string | null;
  branch: string | null;
  accountManager: string | null;
  internalNotes: string | null;
  checkedBy: string | null;
  sentToClientOnRaw: unknown;
}

export interface RowIssue {
  code:
    | "missing_required_field"
    | "missing_policyholder"
    | "invalid_amount"
    | "invalid_date"
    | "formula_ref_error"
    | "swapped_dates"
    | "current_due_mismatch"
    | "duplicate_exact"
    | "conflicting_duplicate"
    | "installment_zero_normalized"
    | "negative_credit_amount";
  severity: "info" | "warning" | "high";
  holdsVisibility: boolean;
  title: string;
  description: string;
  details?: Record<string, unknown>;
}

export interface NormalizedImportRow {
  rowNumber: number;
  sourceRowId: string;
  outcome:
    | "valid"
    | "held"
    | "rejected"
    | "duplicate_skipped"
    | "ignored";
  recordKey: string | null;
  groupNameDisplay: string;
  groupNameNormalized: string;
  policyholderName: string | null;
  policyholderTaxId: string | null;
  policyholderTaxIdDigits: string | null;
  insurer: string;
  insuranceType: string;
  policyNumber: string;
  endorsement: string;
  sourceInstallmentNumber: number;
  installmentNumber: number;
  totalInstallments: number;
  amountBrl: number;
  isCredit: boolean;
  originalDueDate: string | null;
  extendedDueDate: string | null;
  currentDueDate: string | null;
  hadRefErrorInCurrentDue: boolean;
  hasSwappedDates: boolean;
  sourceStatus: "open" | "paid" | "cancelled";
  branch: string | null;
  accountManager: string | null;
  internalNotes: string | null;
  checkedBy: string | null;
  sentToClientOn: string | null;
  extractedExtensionMeta: {
    attemptCount: number;
    protocolNumber: string | null;
    refusedFurther: boolean;
  } | null;
  issues: RowIssue[];
  raw: Record<string, unknown>;
}

export interface ParsedWorkbookResult {
  fileName: string;
  fileHash: string;
  sheetName: string;
  headerRowNumber: number;
  snapshotDate: string;
  totalSheetRows: number;
  dataRowCount: number;
  rows: NormalizedImportRow[];
  summary: {
    validCount: number;
    heldCount: number;
    rejectedCount: number;
    duplicateSkippedCount: number;
    ignoredCount: number;
    warningCount: number;
    refErrorCount: number;
    swappedDateCount: number;
    installmentZeroCount: number;
    negativeAmountCount: number;
  };
}

const HEADER_ALIASES: Record<string, string[]> = {
  group: ["group", "customer group", "grupo", "organization", "client group"],
  policyholder: ["policyholder", "insured", "segurado", "tomador"],
  policyholderTaxId: ["policyholder tax id", "tax id", "cnpj", "cpf/cnpj"],
  insurer: ["insurer", "seguradora", "carrier"],
  lineOfBusiness: ["line of business", "insurance type", "ramo", "lob"],
  policyNumber: ["policy no.", "policy no", "policy number", "apolice", "apólice"],
  endorsement: ["endorsement", "endosso"],
  installment: ["installment", "parcela", "installment no", "installment number"],
  totalInstallments: ["total installments", "total parcelas", "installments total"],
  amount: ["amount (brl)", "amount", "valor", "valor (r$)", "amount brl"],
  originalDueDate: ["original due date", "vencimento original"],
  extendedDueDate: ["extended due date", "vencimento prorrogado"],
  currentDueDate: ["current due date", "vencimento atual", "due date"],
  paymentStatus: ["payment status", "status", "situacao", "situação"],
  branch: ["branch", "filial", "sucursal"],
  accountManager: ["account manager", "gerente de conta", "executivo"],
  internalNotes: ["internal notes", "observacoes internas", "internal comments", "notes"],
  checkedBy: ["checked by", "conferido por", "verificado por"],
  sentToClientOn: ["sent to client on", "enviado ao cliente em", "sent on"],
};

/**
 * Strips accents, collapses whitespace, and lowercases for group normalization.
 */
export function normalizeGroupKey(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean display name for a customer group (canonicalizes casing & accents).
 */
const CANONICAL_GROUP_NAMES: Record<string, string> = {
  "grupo atlantica": "Grupo Atlântica",
  "grupo serra verde": "Grupo Serra Verde",
  "transportadora rota sul": "Transportadora Rota Sul",
  "construtora pilar": "Construtora Pilar",
  "grupo horizonte": "Grupo Horizonte",
  "grupo vertice quimica": "Grupo Vértice Química",
  "grupo mare alimentos": "Grupo Maré Alimentos",
  "cooperativa campos gerais": "Cooperativa Campos Gerais",
  "grupo lumen": "Grupo Lumen",
  "grupo nobre hoteis": "Grupo Nobre Hotéis",
  "mineracao ferro alto": "Mineração Ferro Alto",
  "instituto educacional apice": "Instituto Educacional Ápice",
};

export function canonicalGroupDisplayName(raw: string): {
  normalized: string;
  display: string;
} {
  const normalized = normalizeGroupKey(raw);
  const display =
    CANONICAL_GROUP_NAMES[normalized] ??
    raw
      .replace(/\s+/g, " ")
      .trim();
  return { normalized, display };
}

/**
 * Parse Brazilian currency values:
 * - numeric `20998.43`, `-6716.89`
 * - Brazilian formatted strings `"R$ 4.465,39"`, `"-R$ 1.234,56"`, `"23.197,27"`
 * - US/plain numeric strings `"4465.39"`
 */
export function parseBrlAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value === "object" && value !== null) {
    if ("result" in value) {
      return parseBrlAmount((value as { result: unknown }).result);
    }
    if ("error" in value) return null;
  }
  const str = String(value).trim();
  if (!str) return null;

  const isNegative = str.includes("-") || /^\(.*\)$/.test(str);
  const cleaned = str
    .replace(/[R$\s()]/gi, "")
    .replace(/^-+/, "")
    .trim();

  if (!cleaned) return null;

  let normalized: string;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Brazilian format: 1.234.567,89 -> 1234567.89
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma !== -1) {
    // US format with thousands comma: 1,234,567.89 -> 1234567.89
    normalized = cleaned.replace(/,/g, "");
  } else if (lastComma !== -1 && lastDot === -1) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  const signed = isNegative ? -Math.abs(num) : num;
  return Math.round(signed * 100) / 100;
}

/**
 * Checks whether an Excel cell value represents a formula error (such as `#REF!`).
 */
export function isExcelFormulaError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if ("error" in (value as Record<string, unknown>)) {
      return String((value as { error: unknown }).error);
    }
    if (
      "result" in (value as Record<string, unknown>) &&
      typeof (value as { result: unknown }).result === "object" &&
      (value as { result: { error?: unknown } }).result !== null &&
      "error" in ((value as { result: { error?: unknown } }).result ?? {})
    ) {
      return String((value as { result: { error: unknown } }).result.error);
    }
  }
  if (typeof value === "string" && /^#(REF!|VALUE!|NAME\?|DIV\/0!|N\/A|NUM!|NULL!)$/i.test(value.trim())) {
    return value.trim().toUpperCase();
  }
  return null;
}

/**
 * Parses a date from Excel Date, Brazilian `dd/mm/yyyy` string, ISO `yyyy-mm-dd` string,
 * or Excel serial number into `YYYY-MM-DD`.
 */
export function parseBrazilianDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (isExcelFormulaError(value)) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "object" && value !== null && "result" in value) {
    return parseBrazilianDate((value as { result: unknown }).result);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    // Excel serial date (1900 epoch)
    const utcDays = Math.floor(value - 25569);
    const ms = utcDays * 86400 * 1000;
    const dt = new Date(ms);
    return parseBrazilianDate(dt);
  }

  const str = String(value).trim();
  if (!str) return null;

  // Brazilian dd/mm/yyyy or dd-mm-yyyy
  const brMatch = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(str);
  if (brMatch) {
    const day = Number(brMatch[1]);
    const month = Number(brMatch[2]);
    const year = Number(brMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1990 && year <= 2100) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }

  // ISO yyyy-mm-dd
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}

/**
 * Extracts extension count and protocol number from Internal Notes when present.
 * E.g. "3rd extension granted (protocol ATL-232033). Insurer refused a new extension."
 */
export function extractExtensionMetaFromNote(note: string | null): {
  attemptCount: number;
  protocolNumber: string | null;
  refusedFurther: boolean;
} | null {
  if (!note) return null;
  const protoMatch = /protocol\s+([A-Z0-9\-]+)/i.exec(note);
  const nthMatch = /(\d+)(?:st|nd|rd|th)\s+extension\s+granted/i.exec(note);
  const singleMatch = /extension\s+granted/i.test(note);
  const askedApprovedMatch = /client asked for .* insurer approved .*protocol\s+([A-Z0-9\-]+)/i.exec(note);

  if (!protoMatch && !nthMatch && !singleMatch && !askedApprovedMatch) {
    return null;
  }

  const attemptCount = nthMatch ? Number(nthMatch[1]) : 1;
  const protocolNumber = protoMatch?.[1] ?? askedApprovedMatch?.[1] ?? null;
  const refusedFurther = /refused a new extension/i.test(note);

  return { attemptCount, protocolNumber, refusedFurther };
}

function cellToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if ("richText" in (value as Record<string, unknown>)) {
      const parts = (value as { richText: { text: string }[] }).richText;
      return parts.map((p) => p.text).join("").trim() || null;
    }
    if ("result" in (value as Record<string, unknown>)) {
      return cellToString((value as { result: unknown }).result);
    }
    if ("error" in (value as Record<string, unknown>)) {
      return String((value as { error: unknown }).error);
    }
  }
  const s = String(value).trim();
  return s === "" ? null : s;
}

function cellToInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

/**
 * Detects the real header row by scoring the first 20 rows against known column names.
 */
export function detectHeaderRow(ws: ExcelJS.Worksheet): {
  headerRowNumber: number;
  columnMap: Record<string, number>;
  snapshotDateFromBanner: string | null;
} {
  let bestRow = 1;
  let bestScore = 0;
  let bestMap: Record<string, number> = {};
  let snapshotDateFromBanner: string | null = null;

  const maxScan = Math.min(25, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const colMap: Record<string, number> = {};
    let score = 0;

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cellToString(cell.value);
      if (!text) return;

      // Check banner for "Snapshot: dd/mm/yyyy"
      const snapMatch = /snapshot:\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})/i.exec(text);
      if (snapMatch && !snapshotDateFromBanner) {
        snapshotDateFromBanner = parseBrazilianDate(snapMatch[1]);
      }

      const lowered = text.toLowerCase().replace(/\s+/g, " ").trim();
      for (const [canonicalKey, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.includes(lowered)) {
          colMap[canonicalKey] = colNumber;
          score++;
          break;
        }
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      bestMap = colMap;
    }
  }

  if (bestScore < 6) {
    throw new Error(
      `Could not detect a valid receivables header row (best match had only ${bestScore} recognizable columns).`
    );
  }

  return {
    headerRowNumber: bestRow,
    columnMap: bestMap,
    snapshotDateFromBanner,
  };
}

/**
 * Parses an Excel buffer or file into normalized rows with full anomaly detection.
 */
export async function parseReceivablesWorkbook(
  input: Buffer | ArrayBuffer | Uint8Array | string,
  options: { fileName?: string; overrideSnapshotDate?: string } = {}
): Promise<ParsedWorkbookResult> {
  const wb = new ExcelJS.Workbook();
  let fileBuffer: Buffer;
  let fileName = options.fileName ?? "receivables.xlsx";

  if (typeof input === "string") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fileBuffer = fs.readFileSync(input);
    fileName = options.fileName ?? path.basename(input);
  } else if (Buffer.isBuffer(input)) {
    fileBuffer = input;
  } else if (input instanceof Uint8Array) {
    fileBuffer = Buffer.from(input);
  } else {
    fileBuffer = Buffer.from(new Uint8Array(input));
  }

  const fileHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(fileBuffer as any);

  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error("Workbook does not contain any worksheets.");
  }

  const { headerRowNumber, columnMap, snapshotDateFromBanner } = detectHeaderRow(ws);

  const fileDateMatch = /(\d{4}-\d{2}-\d{2})/.exec(fileName);
  const snapshotDate =
    options.overrideSnapshotDate ??
    snapshotDateFromBanner ??
    fileDateMatch?.[1] ??
    new Date().toISOString().slice(0, 10);

  const parsedRows: NormalizedImportRow[] = [];

  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const getVal = (key: string): unknown => {
      const col = columnMap[key];
      return col ? row.getCell(col).value : null;
    };

    const rawGroup = cellToString(getVal("group"));
    const rawPolicyholder = cellToString(getVal("policyholder"));
    const rawTaxId = cellToString(getVal("policyholderTaxId"));
    const rawInsurer = cellToString(getVal("insurer"));
    const rawLob = cellToString(getVal("lineOfBusiness"));
    const rawPolicyNo = cellToString(getVal("policyNumber"));
    const rawEndorsement = getVal("endorsement");
    const rawInstallment = getVal("installment");
    const rawTotalInstallments = getVal("totalInstallments");
    const rawAmount = getVal("amount");
    const rawOrigDue = getVal("originalDueDate");
    const rawExtDue = getVal("extendedDueDate");
    const rawCurDue = getVal("currentDueDate");
    const rawStatus = cellToString(getVal("paymentStatus"));
    const rawBranch = cellToString(getVal("branch"));
    const rawAccountManager = cellToString(getVal("accountManager"));
    const rawInternalNotes = cellToString(getVal("internalNotes"));
    const rawCheckedBy = cellToString(getVal("checkedBy"));
    const rawSentToClient = getVal("sentToClientOn");

    const sourceRowId = `${fileName}#R${r}`;

    const rawSnapshot: Record<string, unknown> = {
      rowNumber: r,
      Group: rawGroup,
      Policyholder: rawPolicyholder,
      "Policyholder Tax ID": rawTaxId,
      Insurer: rawInsurer,
      "Line of Business": rawLob,
      "Policy No.": rawPolicyNo,
      Endorsement: cellToString(rawEndorsement),
      Installment: cellToString(rawInstallment),
      "Total Installments": cellToString(rawTotalInstallments),
      "Amount (BRL)": typeof rawAmount === "number" ? rawAmount : cellToString(rawAmount),
      "Original Due Date": parseBrazilianDate(rawOrigDue) ?? cellToString(rawOrigDue),
      "Extended Due Date": parseBrazilianDate(rawExtDue) ?? cellToString(rawExtDue),
      "Current Due Date": isExcelFormulaError(rawCurDue) ?? parseBrazilianDate(rawCurDue) ?? cellToString(rawCurDue),
      "Payment Status": rawStatus,
      Branch: rawBranch,
      "Account Manager": rawAccountManager,
      "Internal Notes": rawInternalNotes,
      "Checked By": rawCheckedBy,
      "Sent to Client On": parseBrazilianDate(rawSentToClient) ?? cellToString(rawSentToClient),
    };

    // 1. Check if completely blank or a TOTAL footer row
    const isCompletelyBlank =
      !rawGroup &&
      !rawPolicyholder &&
      !rawPolicyNo &&
      !rawInsurer &&
      (rawAmount === null || rawAmount === undefined || rawAmount === "");

    const isTotalFooter =
      !rawGroup &&
      !rawPolicyNo &&
      rawPolicyholder !== null &&
      /^total$/i.test(rawPolicyholder.trim());

    if (isCompletelyBlank || isTotalFooter) {
      parsedRows.push({
        rowNumber: r,
        sourceRowId,
        outcome: "ignored",
        recordKey: null,
        groupNameDisplay: "",
        groupNameNormalized: "",
        policyholderName: rawPolicyholder,
        policyholderTaxId: null,
        policyholderTaxIdDigits: null,
        insurer: "",
        insuranceType: "",
        policyNumber: "",
        endorsement: "0",
        sourceInstallmentNumber: 0,
        installmentNumber: 1,
        totalInstallments: 1,
        amountBrl: 0,
        isCredit: false,
        originalDueDate: null,
        extendedDueDate: null,
        currentDueDate: null,
        hadRefErrorInCurrentDue: false,
        hasSwappedDates: false,
        sourceStatus: "open",
        branch: null,
        accountManager: null,
        internalNotes: null,
        checkedBy: null,
        sentToClientOn: null,
        extractedExtensionMeta: null,
        issues: [],
        raw: rawSnapshot,
      });
      continue;
    }

    const issues: RowIssue[] = [];

    // 2. Check mandatory identity fields (Group, Policy No., Installment, Insurer, LOB)
    const endorsementInt = cellToInt(rawEndorsement);
    const installmentInt = cellToInt(rawInstallment);
    const totalInstallmentsInt = cellToInt(rawTotalInstallments);
    const amountBrl = parseBrlAmount(rawAmount);

    if (
      !rawGroup ||
      !rawPolicyNo ||
      !rawInsurer ||
      !rawLob ||
      endorsementInt === null ||
      installmentInt === null ||
      totalInstallmentsInt === null ||
      amountBrl === null
    ) {
      issues.push({
        code: "missing_required_field",
        severity: "high",
        holdsVisibility: true,
        title: "Missing core required field(s)",
        description:
          "Row is missing one or more required identity or financial fields (Group, Policy No., Endorsement, Installment, Insurer, Line of Business, or Amount).",
      });
      parsedRows.push({
        rowNumber: r,
        sourceRowId,
        outcome: "rejected",
        recordKey: null,
        groupNameDisplay: rawGroup ?? "",
        groupNameNormalized: rawGroup ? normalizeGroupKey(rawGroup) : "",
        policyholderName: rawPolicyholder,
        policyholderTaxId: rawTaxId,
        policyholderTaxIdDigits: rawTaxId ? rawTaxId.replace(/\D/g, "") : null,
        insurer: rawInsurer ?? "",
        insuranceType: rawLob ?? "",
        policyNumber: rawPolicyNo ?? "",
        endorsement: endorsementInt !== null ? String(endorsementInt) : "0",
        sourceInstallmentNumber: installmentInt ?? 1,
        installmentNumber: Math.max(1, installmentInt ?? 1),
        totalInstallments: Math.max(1, totalInstallmentsInt ?? 1),
        amountBrl: amountBrl ?? 0,
        isCredit: (amountBrl ?? 0) < 0,
        originalDueDate: parseBrazilianDate(rawOrigDue),
        extendedDueDate: parseBrazilianDate(rawExtDue),
        currentDueDate: parseBrazilianDate(rawCurDue),
        hadRefErrorInCurrentDue: Boolean(isExcelFormulaError(rawCurDue)),
        hasSwappedDates: false,
        sourceStatus: "open",
        branch: rawBranch,
        accountManager: rawAccountManager,
        internalNotes: rawInternalNotes,
        checkedBy: rawCheckedBy,
        sentToClientOn: parseBrazilianDate(rawSentToClient),
        extractedExtensionMeta: extractExtensionMetaFromNote(rawInternalNotes),
        issues,
        raw: rawSnapshot,
      });
      continue;
    }

    const { normalized: groupNameNormalized, display: groupNameDisplay } =
      canonicalGroupDisplayName(rawGroup);
    const endorsement = String(endorsementInt);
    const sourceInstallmentNumber = installmentInt;
    // Installment 0 rule: single upfront payment -> 1 of 1 in business logic
    const installmentNumber = sourceInstallmentNumber === 0 ? 1 : sourceInstallmentNumber;
    const totalInstallments = sourceInstallmentsToTotal(sourceInstallmentNumber, totalInstallmentsInt);

    if (sourceInstallmentNumber === 0) {
      issues.push({
        code: "installment_zero_normalized",
        severity: "info",
        holdsVisibility: false,
        title: "Upfront single installment (Installment 0)",
        description:
          "Source row has Installment = 0. Treated as 1 of 1 upfront payment while preserving source_installment_number = 0.",
      });
    }

    if (amountBrl < 0) {
      issues.push({
        code: "negative_credit_amount",
        severity: "info",
        holdsVisibility: false,
        title: "Negative installment amount (Credit / Refund)",
        description: `Installment has a negative amount (R$ ${amountBrl.toFixed(2)}). Treated as credit/refund and excluded from overdue debt and cancellation risk.`,
      });
    }

    // Missing Policyholder name or Tax ID -> Hold back from customer view!
    const taxIdDigits = rawTaxId ? rawTaxId.replace(/\D/g, "") : null;
    if (!rawPolicyholder || !taxIdDigits) {
      issues.push({
        code: "missing_policyholder",
        severity: "high",
        holdsVisibility: true,
        title: "Missing Policyholder name or Tax ID",
        description: `Row ${r} (Policy ${rawPolicyNo}) has ${!rawPolicyholder ? "missing Policyholder name" : "missing Tax ID"}${rawTaxId ? ` (Tax ID ${rawTaxId} is present)` : ""}. Held back from customer view until verified by an employee.`,
        details: {
          policyNumber: rawPolicyNo,
          policyholder: rawPolicyholder,
          policyholderTaxId: rawTaxId,
        },
      });
    }

    // Dates & #REF! handling
    const originalDueDate = parseBrazilianDate(rawOrigDue);
    const extendedDueDate = parseBrazilianDate(rawExtDue);
    const curRefError = isExcelFormulaError(rawCurDue);
    let currentDueDate = parseBrazilianDate(rawCurDue);
    let hadRefErrorInCurrentDue = false;

    if (curRefError) {
      hadRefErrorInCurrentDue = true;
      currentDueDate = extendedDueDate ?? originalDueDate;
      issues.push({
        code: "formula_ref_error",
        severity: "warning",
        holdsVisibility: false,
        title: `Excel formula error (${curRefError}) in Current Due Date`,
        description: `Row ${r} had ${curRefError} in Current Due Date. Replaced with ${extendedDueDate ? `Extended Due Date (${extendedDueDate})` : `Original Due Date (${originalDueDate})`}.`,
        details: {
          rawError: curRefError,
          originalDueDate,
          extendedDueDate,
          resolvedCurrentDueDate: currentDueDate,
        },
      });
    }

    if (!originalDueDate || !currentDueDate) {
      issues.push({
        code: "invalid_date",
        severity: "high",
        holdsVisibility: true,
        title: "Missing or unparseable due date",
        description: `Row ${r} has an invalid Original or Current Due Date. Held back from customer view.`,
      });
    }

    // Check swapped original and extended due dates
    let hasSwappedDates = false;
    if (originalDueDate && extendedDueDate && extendedDueDate < originalDueDate) {
      hasSwappedDates = true;
      issues.push({
        code: "swapped_dates",
        severity: "high",
        holdsVisibility: true,
        title: "Suspicious date order: Extended Due Date is earlier than Original Due Date",
        description: `Original Due Date (${originalDueDate}) is later than Extended Due Date (${extendedDueDate}). Original values preserved without automatic swap; held for employee review.`,
        details: {
          originalDueDate,
          extendedDueDate,
          currentDueDate,
        },
      });
    }

    // Payment Status normalization
    const statusLower = (rawStatus ?? "open").toLowerCase().trim();
    const sourceStatus: "open" | "paid" | "cancelled" =
      statusLower === "paid"
        ? "paid"
        : statusLower === "cancelled" || statusLower === "canceled"
          ? "cancelled"
          : "open";

    const recordKey = `${groupNameNormalized}|${rawPolicyNo.trim()}|${endorsement}|${sourceInstallmentNumber}`;

    const holdsVisibility = issues.some((i) => i.holdsVisibility);

    parsedRows.push({
      rowNumber: r,
      sourceRowId,
      outcome: holdsVisibility ? "held" : "valid",
      recordKey,
      groupNameDisplay,
      groupNameNormalized,
      policyholderName: rawPolicyholder,
      policyholderTaxId: rawTaxId,
      policyholderTaxIdDigits: taxIdDigits,
      insurer: rawInsurer.trim(),
      insuranceType: rawLob.trim(),
      policyNumber: rawPolicyNo.trim(),
      endorsement,
      sourceInstallmentNumber,
      installmentNumber,
      totalInstallments,
      amountBrl,
      isCredit: amountBrl < 0,
      originalDueDate,
      extendedDueDate,
      currentDueDate,
      hadRefErrorInCurrentDue,
      hasSwappedDates,
      sourceStatus,
      branch: rawBranch,
      accountManager: rawAccountManager,
      internalNotes: rawInternalNotes,
      checkedBy: rawCheckedBy,
      sentToClientOn: parseBrazilianDate(rawSentToClient),
      extractedExtensionMeta: extractExtensionMetaFromNote(rawInternalNotes),
      issues,
      raw: rawSnapshot,
    });
  }

  // Second pass: Detect exact duplicates and conflicting duplicates by recordKey
  const byKey = new Map<string, NormalizedImportRow[]>();
  for (const row of parsedRows) {
    if (!row.recordKey || row.outcome === "ignored" || row.outcome === "rejected") continue;
    const list = byKey.get(row.recordKey) ?? [];
    list.push(row);
    byKey.set(row.recordKey, list);
  }

  for (const [key, group] of byKey.entries()) {
    if (group.length <= 1) continue;

    // Compare core financial & date fields across rows with the same key
    const first = group[0];
    const allIdentical = group.every(
      (r) =>
        r.amountBrl === first.amountBrl &&
        r.originalDueDate === first.originalDueDate &&
        r.extendedDueDate === first.extendedDueDate &&
        r.currentDueDate === first.currentDueDate &&
        r.sourceStatus === first.sourceStatus
    );

    if (allIdentical) {
      // Exact duplicates: keep first row, mark subsequent ones as duplicate_skipped
      first.issues.push({
        code: "duplicate_exact",
        severity: "warning",
        holdsVisibility: false,
        title: `Exact duplicate row detected (rows ${group.map((g) => g.rowNumber).join(", ")})`,
        description: `Rows ${group.map((g) => g.rowNumber).join(" and ")} have identical values for key ${key}. Deduplicated automatically.`,
        details: { rows: group.map((g) => g.rowNumber) },
      });
      for (let i = 1; i < group.length; i++) {
        group[i].outcome = "duplicate_skipped";
        group[i].issues.push({
          code: "duplicate_exact",
          severity: "warning",
          holdsVisibility: false,
          title: `Exact duplicate of row ${first.rowNumber}`,
          description: `Skipped because row ${first.rowNumber} has the exact same key and values.`,
        });
      }
    } else {
      // Conflicting duplicate! Check if one of the rows has swapped dates while the other has valid chronological dates
      const nonSwapped = group.find((g) => !g.hasSwappedDates);
      const primary = nonSwapped ?? first;

      for (const r of group) {
        if (r === primary) {
          r.outcome = "held";
          r.issues.push({
            code: "conflicting_duplicate",
            severity: "high",
            holdsVisibility: true,
            title: `Conflicting duplicate records in spreadsheet (rows ${group.map((g) => g.rowNumber).join(" vs ")})`,
            description: `Multiple rows share key ${key} with conflicting values (${group
              .map(
                (g) =>
                  `Row ${g.rowNumber}: R$ ${g.amountBrl.toFixed(2)}, orig=${g.originalDueDate}, ext=${g.extendedDueDate ?? "—"}, cur=${g.currentDueDate}`
              )
              .join(" | ")}). Held back from customer view until an employee resolves the discrepancy.`,
            details: {
              conflictingRows: group.map((g) => ({
                rowNumber: g.rowNumber,
                amountBrl: g.amountBrl,
                originalDueDate: g.originalDueDate,
                extendedDueDate: g.extendedDueDate,
                currentDueDate: g.currentDueDate,
              })),
            },
          });
        } else {
          r.outcome = "duplicate_skipped";
          r.issues.push({
            code: "conflicting_duplicate",
            severity: "high",
            holdsVisibility: true,
            title: `Conflicting duplicate with row ${primary.rowNumber}`,
            description: `Held on primary row ${primary.rowNumber} for employee review.`,
          });
        }
      }
    }
  }

  // Compute summary stats
  let validCount = 0;
  let heldCount = 0;
  let rejectedCount = 0;
  let duplicateSkippedCount = 0;
  let ignoredCount = 0;
  let warningCount = 0;
  let refErrorCount = 0;
  let swappedDateCount = 0;
  let installmentZeroCount = 0;
  let negativeAmountCount = 0;

  for (const r of parsedRows) {
    if (r.outcome === "valid") validCount++;
    else if (r.outcome === "held") heldCount++;
    else if (r.outcome === "rejected") rejectedCount++;
    else if (r.outcome === "duplicate_skipped") duplicateSkippedCount++;
    else if (r.outcome === "ignored") ignoredCount++;

    if (r.issues.length > 0) warningCount += r.issues.length;
    if (r.hadRefErrorInCurrentDue) refErrorCount++;
    if (r.hasSwappedDates) swappedDateCount++;
    if (r.sourceInstallmentNumber === 0 && r.outcome !== "ignored") installmentZeroCount++;
    if (r.isCredit && r.outcome !== "ignored") negativeAmountCount++;
  }

  return {
    fileName,
    fileHash,
    sheetName: ws.name,
    headerRowNumber,
    snapshotDate,
    totalSheetRows: ws.rowCount,
    dataRowCount: parsedRows.filter((r) => r.outcome !== "ignored").length,
    rows: parsedRows,
    summary: {
      validCount,
      heldCount,
      rejectedCount,
      duplicateSkippedCount,
      ignoredCount,
      warningCount,
      refErrorCount,
      swappedDateCount,
      installmentZeroCount,
      negativeAmountCount,
    },
  };
}

function sourceInstallmentsToTotal(sourceInst: number, rawTotal: number): number {
  if (sourceInst === 0) return 1;
  return Math.max(1, rawTotal);
}
