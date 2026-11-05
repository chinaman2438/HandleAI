# Meridian Receivables Portal — Data Model & Schema Reference

All SQL migrations live in `supabase/migrations/` (and are consolidated in `supabase/full-schema.sql`).

---

## 1. Entity-Relationship Summary

| Table / View | Purpose | Customer RLS Access | Staff RLS Access |
| :--- | :--- | :--- | :--- |
| `public.organizations` | Canonical corporate customer groups (12 groups normalized from 15 raw names) | `SELECT` own organization only | Full CRUD |
| `public.policyholders` | Subsidiary / insured legal entities (`name`, `tax_id`). Shared across groups for Joint Ventures | `SELECT` only if linked via own organization's policies | Full CRUD |
| `public.profiles` | Portal user profiles linked to `auth.users` (`role`, `organization_id`) | `SELECT/UPDATE` own profile | Full CRUD |
| `public.policies` | Insurance policies & endorsements scoped to `(organization_id, policy_number, endorsement)` | `SELECT` own organization only | Full CRUD |
| `public.installments` | Core receivable installments with separate `original_due_date`, `extended_due_date`, `current_due_date` | `SELECT` own organization where `is_customer_visible = true` | Full CRUD |
| `public.payments` | Payment receipts submitted by customers or recorded by staff | `SELECT` own org; `INSERT` only with `verification_status = 'submitted'` | Full CRUD |
| `public.payment_allocations` | Allocates single or partial payment records across installments | `SELECT` own organization | Full CRUD |
| `public.payment_verifications` | Insurer verification audit log (`insurer_confirmed`, `confirmed_amount_brl`, `remaining_balance_brl`) | **NONE (Blocked)** | Full CRUD |
| `public.extensions` | Multi-attempt due-date extension history (`attempt_number`, `requested_due_date`, `approved_due_date`, `protocol_number`) | `SELECT` own org; `INSERT` only with `status = 'requested'` and `approved_due_date IS NULL` | Full CRUD |
| `public.exceptions` | Unified workflow queue (`payment_receipt`, `extension_request`, `amount_dispute`, `missing_from_report`, `cancellation_risk`) | `SELECT` own org (except internal types); `INSERT` own org | Full CRUD |
| `public.exception_messages` | Threaded messages on exceptions with `visibility` (`customer` vs `internal`) | `SELECT/INSERT` where `visibility = 'customer'` | Full CRUD |
| `public.documents` | Metadata for uploaded receipts and insurer breakdowns in private `documents` bucket | `SELECT/INSERT` own org where `visibility = 'customer'` | Full CRUD |
| `public.internal_notes` | **Confidential** spreadsheet and manual staff notes | **NONE (Blocked)** | Full CRUD |
| `public.installment_internal_tracking` | **Confidential** `Checked By` and `Sent to Client On` audit records | **NONE (Blocked)** | Full CRUD |
| `public.activity_logs` | Immutable audit trail with `old_values`, `new_values`, and `visibility` (`customer` vs `internal`) | `SELECT` own org where `visibility = 'customer'` | Full CRUD |
| `public.import_batches` | Audit log of every Excel file import and reconciliation counts | **NONE (Blocked)** | Full CRUD |
| `public.import_rows` | Row-level import outcomes and raw JSONB payloads | **NONE (Blocked)** | Full CRUD |
| `public.data_quality_issues` | Data-quality holds and warnings (`formula_ref_error`, `swapped_dates`, `conflicting_duplicate`, `missing_policyholder`) | **NONE (Blocked)** | Full CRUD |
| `public.installment_snapshots` | Weekly point-in-time snapshots per `(snapshot_date, installment_id)` for Week-over-Week analytics | **NONE (Blocked)** | Full CRUD |
| `public.risk_rules` | Configurable line-of-business priority and overdue thresholds for cancellation-risk scoring | **NONE (Blocked)** | Full CRUD |
| `public.reminder_settings` | Configurable `days_before_due` lead window and provider mode (`demo` vs `resend`) | **NONE (Blocked)** | Full CRUD |
| `public.reminders` | Generated and sent upcoming payment reminders (`generated_at` vs `sent_at`) | `SELECT` own organization | Full CRUD |
| `public.customer_installments` | Customer-safe SQL view omitting all internal fields and filtering `is_customer_visible = true` | `SELECT` own organization | `SELECT` all |
| `public.customer_payments` | Customer-safe SQL view of payment submissions and confirmed amounts | `SELECT` own organization | `SELECT` all |

---

## 2. Key Financial & Workflow Invariants Enforced in SQL

1. **Three Separate Due Dates (`public.installments`)**:
   - `original_due_date`: Never overwritten when an extension is requested or approved.
   - `extended_due_date`: Updated only when an extension attempt is approved by the insurer (`status = 'approved'`).
   - `current_due_date`: Official active due date (`COALESCE(extended_due_date, original_due_date)`).
2. **Insurer Verification & Partial Payment Trigger (`app.recalculate_installment_financials`)**:
   - Sums `COALESCE(confirmed_amount_brl, amount_brl)` strictly across `public.payments` where `verification_status = 'confirmed'`.
   - Unconfirmed receipts (`verification_status IN ('submitted', 'under_review', 'rejected')`) contribute `R$ 0,00` to `confirmed_paid_brl`.
   - Automatically computes `outstanding_balance_brl = GREATEST(amount_brl - confirmed_paid_brl, 0)` for positive installments and transitions `payment_status` between `'open'`, `'overdue'`, `'partially_paid'`, and `'paid'`.
3. **Installment `0` Normalization**:
   - Rows with `Installment = 0` and `Total Installments = 1` store `source_installment_number = 0` and `installment_number = 1` so UI displays `1/1` while preserving source traceability.
4. **Negative Credit / Endorsement Rows**:
   - Rows with `amount_brl < 0` set `is_credit = true` and `outstanding_balance_brl = 0`, preventing negative endorsement credits from distorting overdue debt totals in Week-over-Week analytics.
