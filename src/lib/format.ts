export const DEFAULT_REFERENCE_DATE = "2026-11-04";

/**
 * Formats a numeric value in Brazilian Real (BRL).
 * Negative values are formatted with a leading minus or credit indicator.
 */
export function formatBrl(amount: number | string | null | undefined): string {
  const num = typeof amount === "string" ? Number(amount) : amount ?? 0;
  if (!Number.isFinite(num)) return "R$ 0,00";
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return num < 0 ? `-R$ ${formatted}` : `R$ ${formatted}`;
}

/**
 * Formats an ISO date (`YYYY-MM-DD` or timestamp) in Brazilian `dd/MM/yyyy` format.
 */
export function formatBrDate(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  if (dateInput instanceof Date) {
    if (Number.isNaN(dateInput.getTime())) return "—";
    const d = String(dateInput.getUTCDate()).padStart(2, "0");
    const m = String(dateInput.getUTCMonth() + 1).padStart(2, "0");
    const y = dateInput.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  const str = String(dateInput).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(dt);
  }
  return str;
}

/**
 * Formats an ISO timestamp in Brazilian `dd/MM/yyyy HH:mm` (America/Sao_Paulo).
 */
export function formatBrDateTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return "—";
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(dt.getTime())) return String(dateInput);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

/**
 * Computes signed day difference `(dueDate - referenceDate)`.
 * Negative = overdue (`-daysOverdue`), Positive = days until due (`+daysUntilDue`), 0 = due today.
 */
export function diffDaysFromReference(
  dueDateIso: string | null | undefined,
  referenceDateIso: string = DEFAULT_REFERENCE_DATE
): number | null {
  if (!dueDateIso) return null;
  const dueStr = dueDateIso.slice(0, 10);
  const refStr = referenceDateIso.slice(0, 10);
  const dueMs = Date.parse(`${dueStr}T00:00:00Z`);
  const refMs = Date.parse(`${refStr}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(refMs)) return null;
  return Math.round((dueMs - refMs) / (86400 * 1000));
}

export function formatInstallmentLabel(
  installmentNumber: number,
  totalInstallments: number,
  sourceInstallmentNumber?: number
): string {
  if (sourceInstallmentNumber === 0) {
    return "1/1 (Upfront #0)";
  }
  return `${installmentNumber}/${totalInstallments}`;
}
