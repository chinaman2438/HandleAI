# Meridian Receivables Portal — Architecture & Security Design

## 1. System Overview

The **Meridian Receivables Portal** is a full-stack B2B insurance brokerage platform built on **Next.js 16 (App Router)**, **TypeScript**, and **Supabase PostgreSQL with Row Level Security (RLS)**. It unifies:

1. **Customer Self-Service Receivables Portal** (`/dashboard`, `/installments`, `/installments/[id]`, `/requests`, `/documents`, `/profile`)
2. **Meridian Internal Receivables Operations Workspace** (`/internal/dashboard`, `/internal/receivables`, `/internal/installments/[id]`, `/internal/extensions`, `/internal/payments`, `/internal/disputes`, `/internal/cancellation-risk`, `/internal/imports`, `/internal/data-quality`, `/internal/customers`, `/internal/reminders`, `/internal/reports`)
3. **Idempotent Excel Synchronization & Historical Snapshot Engine** (`src/lib/import/parser.ts`, `src/lib/import/sync.ts`)
4. **Configurable Upcoming Payment Reminder Engine** (`src/lib/reminders/service.ts`, `/api/cron/reminders`)

---

## 2. High-Level Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                              Browser / Client Layer                               |
|  - Customer Portal UI (Scoped to Corporate Group)                                 |
|  - Meridian Internal Operations UI (Portfolio, Queues, Analytics, Data Quality)   |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        Next.js 16 App Router (Server Layer)                       |
|  - Server Components: Fetch data strictly on the server via RLS-scoped sessions   |
|  - Server Actions (`src/lib/actions/portal-actions.ts`): Zod-validated mutations  |
|  - API Routes: `/api/documents/[id]/download`, `/api/cron/reminders`              |
|  - CLI Scripts: `db:migrate`, `import:validate`, `import:excel`, `db:seed`        |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|             PostgreSQL Data & Security Layer (`src/lib/db/engine.ts`)             |
|  - Dual-Mode Engine:                                                              |
|      * Remote Supabase PostgreSQL (`pg.Pool` via `SUPABASE_DB_URL`)               |
|      * Embedded PostgreSQL (`@electric-sql/pglite`) zero-config local fallback    |
|  - `withRlsSession(userId, fn)`: Sets `role = authenticated` and                  |
|    `request.jwt.claim.sub = userId` inside a PostgreSQL transaction               |
|  - 22 Tables + 2 Customer-Safe Views + 7 SQL Migration Files                      |
+-----------------------------------------------------------------------------------+
```

---

## 3. Defense-in-Depth Security & Confidentiality Model

### 3.1 PostgreSQL Row Level Security (RLS)
Every table in `public` has Row Level Security enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
Helper functions in the `app` schema evaluate the caller's identity directly from `auth.uid()`:
- `app.current_user_role()`: Returns `'customer' | 'employee' | 'admin'`.
- `app.is_staff()`: Returns `true` only when `role IN ('employee', 'admin')`.
- `app.current_user_org_id()`: Returns the customer's `organization_id` from `public.profiles`.

### 3.2 Strict Confidentiality of Internal-Only Fields
The workbook contains three internal-only operational columns that **must never be exposed to customers**:
1. **`Internal Notes`**: Stored in a dedicated table `public.internal_notes` whose RLS policy grants `SELECT/INSERT/UPDATE/DELETE` exclusively to `app.is_staff()`.
2. **`Checked By`** and **`Sent to Client On`**: Stored in a dedicated table `public.installment_internal_tracking` whose RLS policy grants access exclusively to `app.is_staff()`.
3. **Internal Activity Logs & Data-Quality Issues**:
   - `public.activity_logs` has a `visibility` column (`'customer' | 'internal'`). Customer RLS policies require `visibility = 'customer' AND organization_id = app.current_user_org_id()`.
   - `public.data_quality_issues`, `public.import_batches`, `public.import_rows`, and `public.payment_verifications` are restricted to `app.is_staff()`.

### 3.3 Customer-Safe Views (`public.customer_installments` & `public.customer_payments`)
In addition to RLS on base tables, all customer portal screens query through `public.customer_installments` and `public.customer_payments`, which:
- Physically omit internal columns and tables.
- Filter `is_customer_visible = true` so rows held back by the data-quality pipeline (`data_quality_status = 'held'`) are invisible to customers until approved by Meridian staff.

### 3.4 Joint-Venture Policyholder Isolation
In corporate insurance, a joint-venture entity (such as **Terminal Portuário Sul S.A.**, CNPJ `85.551.345/0001-10`) can hold policies under multiple parent corporate groups (`Grupo Atlântica` and `Grupo Serra Verde`).
- `public.policyholders` does **not** carry a single `organization_id`.
- Instead, `public.policies` links `(organization_id, policyholder_id, policy_number, endorsement)`.
- Customer RLS on `public.policyholders` checks `EXISTS (SELECT 1 FROM public.policies p WHERE p.policyholder_id = policyholders.id AND p.organization_id = app.current_user_org_id())`, and customer RLS on `public.policies` and `public.installments` filters by `organization_id = app.current_user_org_id()`.
- As verified by automated integration tests (`tests/integration/rls-and-workflows.test.ts`), `Grupo Atlântica` sees only its 35 installments for `Terminal Portuário Sul S.A.` and `Grupo Serra Verde` sees only its 14 installments.
