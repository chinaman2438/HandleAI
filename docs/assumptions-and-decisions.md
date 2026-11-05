# Assumptions & Engineering Decisions

This document records the explicit business and technical decisions made while designing and building the **Meridian Receivables Portal** against `PROMPT.docx` and the reference workbook (`meridian-receivables-2026-11-02.xlsx`).

---

## 1. Spreadsheet Data-Quality & Normalization Decisions

### 1.1 Header Row Auto-Detection & Summary Row Filtering
- **Observation**: Row 1 is a report title (`Meridian Corretora de Seguros — Receivables Report`), Row 2 is a subtitle containing the snapshot date (`Snapshot: 02/11/2026`), Row 3 is blank, and **Row 4** is the column header row. Row 1457 is blank and Row 1458 is a `TOTAL` summary row.
- **Decision**: Rather than hardcoding row indices, `parseReceivablesWorkbook` scans the first 15 rows for header aliases, extracts the `DD/MM/YYYY` snapshot date from any banner row above the header, and filters out blank and `TOTAL` footer rows (`outcome = 'ignored'`).

### 1.2 Corporate Group Normalization (15 Raw Strings → 12 Canonical Groups)
- **Observation**: The `Group` column contains 15 raw string variants due to inconsistent casing and accents (e.g., `GRUPO ATLANTICA`, `Grupo Atlantica`, and `Grupo Atlântica`).
- **Decision**: All group names are normalized via Unicode NFD accent stripping + lowercasing (`normalizeGroupKey`) for database uniqueness (`organizations.normalized_name`) and mapped to canonical display names with proper Portuguese diacritics (`Grupo Atlântica`, `Grupo Vértice Química`, `Grupo Maré Alimentos`, `Grupo Nobre Hotéis`, `Mineração Ferro Alto`, `Instituto Educacional Ápice`).

### 1.3 Joint-Venture Policyholder Isolation (`Terminal Portuário Sul S.A.`)
- **Observation**: `Terminal Portuário Sul S.A.` (CNPJ `85.551.345/0001-10`) appears under **both** `Grupo Atlântica` (35 installments across 13 policies) and `Grupo Serra Verde` (14 installments across 7 policies).
- **Decision**: `public.policyholders` does **not** have a single `organization_id` foreign key. Instead, `public.policies` is scoped to `(organization_id, policyholder_id, policy_number, endorsement)` and `public.installments` carries `organization_id`. Row Level Security ensures each corporate group only sees its own policies and installments for shared joint-venture entities.

### 1.4 Formula Errors (`#REF!`) in `Current Due Date` (5 Rows)
- **Observation**: Rows 101, 412, 725, 1018, and 1289 contain `#REF!` in `Current Due Date`, while `Original Due Date` (and `Extended Due Date` where applicable) are valid dates.
- **Decision**: Repair automatically using `COALESCE(extended_due_date, original_due_date)` so the installment remains usable, and record a non-blocking `formula_ref_error` warning in `public.data_quality_issues`.

### 1.5 Swapped Dates (`Extended Due Date < Original Due Date`) (10 Rows)
- **Observation**: 10 rows have an `Extended Due Date` earlier than `Original Due Date` (6 standalone rows + 4 rows that are also part of conflicting duplicate pairs).
- **Decision**: Import the rows into `public.installments` with `is_customer_visible = false` and `data_quality_status = 'held'`, and open a high-severity `swapped_dates` item in the Data-Quality Review Queue (`/internal/data-quality`) where Meridian staff can swap the dates and approve customer visibility with one click.

### 1.6 Missing Policyholder Name (Rows 7 & 263)
- **Observation**: Rows 7 and 263 have a valid `Group` and `Policyholder Tax ID` (`CNPJ`), but `Policyholder` name is blank.
- **Decision**: Match the policyholder entity via its normalized 14-digit CNPJ from other rows in the workbook so relational integrity is preserved, hold back the installment from customer visibility (`is_customer_visible = false`), and flag `missing_policyholder` in `/internal/data-quality` for staff confirmation.

### 1.7 Exact vs. Conflicting Duplicate Rows (9 Duplicate Pairs)
- **Observation**: 3 duplicate pairs are byte-for-byte identical across business fields; 6 duplicate pairs share `(Group, Policy, Endorsement, Installment)` but conflict on `Amount (BRL)` or `Extended Due Date`.
- **Decision**:
  - **Exact duplicates (3 pairs)**: Import the first row normally and skip the second row (`outcome = 'duplicate_skipped'`).
  - **Conflicting duplicates (6 pairs)**: Import the first row with `is_customer_visible = false` (`data_quality_status = 'held'`), skip the second row, and attach both rows' raw values to a `conflicting_duplicate` issue in `/internal/data-quality` so staff can confirm the authoritative amount/date before releasing to the customer.

### 1.8 Installment `0` of `1` (8 Rows) & Negative Credit Amounts (3 Rows)
- **Decision**:
  - **Installment `0`**: Normalized to `installment_number = 1`, `total_installments = 1` for clean display (`1/1`) while preserving `source_installment_number = 0`.
  - **Negative Amounts**: Stored with `is_credit = true` and `outstanding_balance_brl = 0`. Shown clearly as Credit / Endorsement Adjustments in tables and excluded from overdue debt totals in Week-over-Week analytics.

---

## 2. Workflow, Analytics & Operational Decisions

### 2.1 Payment Receipts Never Auto-Confirm
- Customer receipt uploads create a `public.payments` record with `verification_status = 'submitted'` and a `payment_receipt` exception in Meridian's queue.
- Only when a Meridian employee verifies the payment with the insurer (`verification_status = 'confirmed'`) does the PostgreSQL trigger `app.recalculate_installment_financials` reduce `outstanding_balance_brl` and transition the installment to `partially_paid` or `paid`.

### 2.2 Multi-Attempt Extensions & Insurer-Approved Date Differences
- `public.extensions` is append-only per `(installment_id, attempt_number)`.
- Requesting a 2nd or 3rd extension never overwrites Attempt #1.
- When an insurer approves a different date than requested (e.g., approving `15/11/2026` when the customer requested `30/11/2026` on Policy `01.18.0004471` Inst `5/10`), both `requested_due_date` and `approved_due_date` are stored and displayed side by side.

### 2.3 Cancellation-Risk Priority Heuristic
- Per Section 13, cancellation risk is explicitly labeled as an **internal prioritization heuristic** (not legal or SUSEP policy cancellation rules) and ranks lines of business in strict order:
  1. **Priority 1 — Judicial Guarantee (`Garantia Judicial`)**: Highest sensitivity due to court enforcement exposure.
  2. **Priority 2 — Other Surety Lines (`Garantia Performance`, `Garantia Licitante`, `Garantia Financeira`)**.
  3. **Priority 3 — Standard Commercial Lines (`Patrimonial`, `Frota`, `RC Geral`, `D&O`, `Saúde`, `Transporte`, `Vida em Grupo`)**.

### 2.4 Demo Mode vs. Live Email Reminders
- In Demo Mode (no `RESEND_API_KEY`), reminders are stored with `status = 'generated'`, `generated_at = now()`, and `sent_at = NULL`. The UI explicitly labels these as *Generated (In-Portal Demo)* and never claims an external email was sent unless `RESEND_API_KEY` is configured and delivery succeeds.
