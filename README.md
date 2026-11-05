# Meridian Receivables Portal

A full-stack B2B insurance brokerage **Customer Receivables Portal**, **Internal Receivables Operations Workspace**, **Idempotent Excel Synchronization Engine**, **Week-over-Week Historical Snapshot Analytics**, and **Configurable Upcoming Payment Reminder System** built for **Meridian Corretora de Seguros**.

---

## 1. Key Capabilities

- **Customer Self-Service Portal (`/dashboard`, `/installments`, `/installments/[id]`, `/requests`, `/documents`, `/profile`)**:
  - Strictly scoped to the authenticated customer's corporate group (`organization_id`) via **PostgreSQL Row Level Security (RLS)**.
  - Displays all three due dates (**Original Due Date**, **Extended Due Date**, and **Official Current Due Date**) separately so original contract terms are never overwritten.
  - Supports **Payment Receipt Uploads** (`PDF`, `JPG`, `PNG` with amount paid and payment date), **Due-Date Extension Requests**, and **Amount Disputes / Endorsement Breakdown Requests**.
  - Enforces strict insurer verification: uploading a receipt sets `verification_status = 'submitted'` (Displayed as *Payment Under Review / Awaiting Insurer Confirmation*) and **never** marks an installment as `paid` until Meridian confirms receipt with the insurer.
  - Supports **Partial Payments** (`partially_paid`) and multiple receipts per installment with live remaining balance calculation.
  - **Strict Confidentiality**: `Internal Notes`, `Checked By`, `Sent to Client On`, internal audit logs (`visibility = 'internal'`), and held-back data-quality rows (`is_customer_visible = false`) are completely inaccessible to customer accounts at both the PostgreSQL RLS layer and the query layer.

- **Meridian Internal Operations Portal (`/internal/*`)**:
  - **Executive Dashboard & Week-over-Week Analytics (`/internal/dashboard`, `/internal/reports`)**: Compares stored weekly snapshots (`public.installment_snapshots`) to surface net overdue movement, newly overdue receivables, confirmed paid collections, extension-driven improvements, missing overdue rows, and aging buckets (`1–30`, `31–60`, `61–89`, `90+` days) overall and by corporate group.
  - **Full Receivables Portfolio (`/internal/receivables`, `/internal/installments/[id]`)**: Multi-criteria filtering, sorting, CSV export, confidential `Internal Notes`, `Checked By` & `Sent to Client On` tracking, and complete audit timeline.
  - **Multi-Attempt Extension Queue (`/internal/extensions`)**: Tracks 1st, 2nd, and 3rd+ extension requests per installment without overwriting prior attempts, records insurer protocol numbers, and handles cases where the insurer approves a different date than requested.
  - **Payment Verification Queue (`/internal/payments`)**: One-click insurer verification supporting full and partial payments.
  - **Dispute & Endorsement Queue (`/internal/disputes`)**: Tracks insurer endorsement breakdown requests, dates received, and customer explanations.
  - **Cancellation-Risk Triage (`/internal/cancellation-risk`)**: Prioritizes overdue exposure by line sensitivity (**Priority 1: Judicial Guarantee**, **Priority 2: Other Surety**, **Priority 3: Other Lines**), days overdue, and BRL amount, with an explicit heuristic disclaimer.
  - **Excel Import & Data-Quality Queue (`/internal/imports`, `/internal/data-quality`)**: Idempotent `.xlsx` import pipeline that auto-detects header row 4, normalizes 15 dirty group names to 12 corporate groups, repairs `#REF!` formula errors, deduplicates exact duplicates, and holds back conflicting duplicates, swapped dates, and missing-policyholder rows until staff approval.
  - **Configurable Payment Reminders (`/internal/reminders`)**: Configurable `X days before due date` engine that clearly distinguishes `generated` (Demo / In-Portal) from `sent` (Live Email via Resend).

---

## 2. Tech Stack

- **Framework**: Next.js 16 (App Router, Server Components, Server Actions) + TypeScript
- **Database & Security**: Supabase PostgreSQL + Row Level Security (RLS) on all 22 tables + dual-mode embedded PostgreSQL (`@electric-sql/pglite`) fallback so local evaluation and automated tests run zero-config out of the box
- **Spreadsheet Engine**: `exceljs`
- **Charts & UI**: Tailwind CSS v4, `recharts`, `lucide-react`, `zod`
- **Testing**: `vitest` (Unit tests for parser/normalizer + Integration tests against real PostgreSQL RLS and workflows)

---

## 3. Quick Start (Local Development)

### Prerequisites
- Node.js 20+ and npm

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
- **Zero-Config Local / Demo Mode**: Even if `SUPABASE_DB_URL` is not yet set in `.env.local`, the application automatically boots an embedded PostgreSQL instance (`PGlite`), applies all SQL migrations in `supabase/migrations/*.sql`, enables PostgreSQL Row Level Security, and seeds the real 1,454-row workbook (`meridian-receivables-2026-11-02.xlsx` if present locally) plus 4 weekly snapshots and demo accounts.
- **Remote Supabase Mode**: Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL` in `.env.local` to run against your hosted Supabase Postgres instance.

### 3. Database Migration, Import & Seed Commands
```bash
# Apply all SQL migrations in supabase/migrations/
npm run db:migrate

# Validate and profile the Excel workbook without writing to the database
npm run import:validate

# Generate the markdown reconciliation report (docs/import-validation-report.md)
npm run import:report

# Seed the workbook, demo personas, required demo scenarios, and 4 weekly snapshots
npm run db:seed

# Trigger the upcoming payment reminder job via CLI
npm run reminders:run
```

### 4. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) (or `/login`) to sign in with one click using any of the pre-configured demo accounts.

---

## 4. Demo Accounts & Pre-Seeded End-to-End Scenarios

| Role | Name | Email | Scoped Organization |
| :--- | :--- | :--- | :--- |
| **Meridian Admin** | Alex Moraes | `admin@meridian.demo` | All Organizations (Full Admin + Provisioning) |
| **Meridian Employee** | Bruno Tavares | `employee@meridian.demo` | All Organizations (Internal Operations) |
| **Customer (Grupo Atlântica)** | Mariana Costa | `finance@atlantica.demo` | **Grupo Atlântica** (RLS-isolated) |
| **Customer (Grupo Serra Verde)** | Roberto Almeida | `finance@serraverde.demo` | **Grupo Serra Verde** (RLS-isolated) |
| **Customer (Construtora Pilar)** | Carla Mendes | `finance@pilar.demo` | **Construtora Pilar** (RLS-isolated) |

### Highlighted Demo Scenarios to Inspect
1. **Extension Request & Multi-Attempt History (`Grupo Atlântica` — Policy `01.18.0004471`, Installment `5/10`)**:
   - Original Due Date `14/09/2026` was extended in Attempt #1 to `29/09/2026` (Protocol `ATL-884120`).
   - Attempt #2 requesting `18/11/2026` is currently in `awaiting_response` (Protocol `ATL-992411`). Log in as `employee@meridian.demo` → `/internal/extensions` to approve it (even with a different insurer-approved date) and observe the customer view update immediately while preserving Attempt #1 and the original due date.
2. **Amount Dispute & Insurer Endorsement Breakdown (`Grupo Atlântica` — Policy `01.18.4183925`, Installment `4/6`)**:
   - Customer disputed the `R$ 104.351,64` installment expecting `R$ 89.500,00` due to an endorsement adjustment.
   - Meridian requested the insurer calculation memory (`Endosso #02-B`) and posted a detailed breakdown for customer review.
3. **Partial Payment & Insurer Verification (`Grupo Atlântica` — Policy `01.18.0004471`, Installment `6/10`)**:
   - Installment total is `R$ 41.839,25`. First payment of `R$ 20.000,00` was confirmed by the insurer (`partially_paid`, remaining balance `R$ 21.839,25`).
   - Second receipt for the remaining `R$ 21.839,25` has been uploaded by the customer and awaits insurer confirmation (`verification_status = 'submitted'`). Confirm it in `/internal/payments` to transition the installment to `paid` (`R$ 0,00` remaining).
4. **Joint-Venture Policyholder Isolation (`Terminal Portuário Sul S.A.` — CNPJ `85.551.345/0001-10`)**:
   - Appears under both `Grupo Atlântica` (13 installments) and `Grupo Serra Verde` (7 installments). Sign in as `finance@atlantica.demo` vs. `finance@serraverde.demo` to verify strict per-group RLS isolation.

---

## 5. Automated Testing

```bash
npm test
```
Runs Vitest across:
- `tests/unit/import-parser.test.ts`: Validates BRL currency parsing, Brazilian date parsing, `#REF!` detection, group normalization, and all 12 data-quality edge cases in `meridian-receivables-2026-11-02.xlsx`.
- `tests/integration/rls-and-workflows.test.ts`: Executes against real PostgreSQL with Row Level Security enabled to verify cross-organization isolation, Joint-Venture policyholder isolation, confidentiality of `Internal Notes` / `Checked By` / `Sent to Client On`, held-back row visibility, partial payment verification, multi-attempt extensions, and idempotent re-imports.

---

## 6. Documentation Index

- [Architecture & Security Design (`docs/architecture.md`)](docs/architecture.md)
- [Database Schema, Views & RLS Policies (`docs/data-model.md`)](docs/data-model.md)
- [Excel Import Reconciliation Report (`docs/import-validation-report.md`)](docs/import-validation-report.md)
- [Assumptions & Engineering Decisions (`docs/assumptions-and-decisions.md`)](docs/assumptions-and-decisions.md)
- [Executive Solution Write-Up (`docs/solution-writeup.md`)](docs/solution-writeup.md)
