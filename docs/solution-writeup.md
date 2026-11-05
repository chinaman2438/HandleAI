# Executive Solution Write-Up — Meridian Receivables Portal

## 1. Executive Summary

Meridian Corretora de Seguros previously managed `1,450+` active corporate insurance installments across `12` corporate groups using a weekly Excel export (`meridian-receivables-2026-11-02.xlsx`). While the spreadsheet served as an operational scratchpad, it created four structural bottlenecks:
1. **No Customer Self-Service or Transparency**: Corporate treasury teams had no visibility into official due dates, approved extension protocols, endorsement adjustments, or whether uploaded payment vouchers had been confirmed by the insurer.
2. **Confidentiality & Data-Quality Exposure Risks**: The raw workbook mixes internal-only broker commentary (`Internal Notes`, `Checked By`, `Sent to Client On`), `#REF!` formula errors, swapped due dates, missing policyholder names, and conflicting duplicate rows with customer-facing billing data.
3. **Destructive Weekly Overwrites**: Replacing the spreadsheet each week risked erasing in-flight customer receipts, multi-attempt extension histories, and open amount disputes—or silently losing track of overdue installments that disappeared from a new export.
4. **Lack of Historical Progression & Risk Prioritization**: Leadership could not reliably measure week-over-week overdue progression, distinguish real collections from policy cancellations or due-date extensions, or prioritize critical Judicial Guarantee bonds before cancellation risk escalated.

The **Meridian Receivables Portal** solves all four challenges in a unified, production-ready **Next.js 16 + Supabase PostgreSQL** platform.

---

## 2. How Each Core Business Requirement Is Solved

### A. Customer Self-Service Portal with Strict RLS & Confidentiality
- **Organization-Scoped Access**: Every customer account is bound to a canonical corporate group (`organization_id`) and enforced via PostgreSQL Row Level Security (`supabase/migrations/20261105000006_rls.sql`).
- **Joint-Venture Safety**: Shared policyholders like **Terminal Portuário Sul S.A.** (`85.551.345/0001-10`) are linked to organizations through `public.policies`, ensuring `Grupo Atlântica` sees only its 35 installments and `Grupo Serra Verde` sees only its 14 installments.
- **Zero Leakage of Internal Fields**: `Internal Notes`, `Checked By`, and `Sent to Client On` live in dedicated staff-only tables (`public.internal_notes` and `public.installment_internal_tracking`) with zero customer RLS policies and are excluded from `public.customer_installments`.
- **Three Distinct Due Dates**: Every screen displays `Original Due Date`, `Extended Due Date`, and `Official Current Due Date` separately so original policy schedules are never lost.

### B. End-to-End Workflows (Receipts, Partial Payments, Extensions & Disputes)
- **Payment Receipts & Partial Payments**: Customers upload `PDF`/`JPG`/`PNG` vouchers with payment date and amount. Uploads enter `verification_status = 'submitted'` (*Awaiting Insurer Confirmation*) and **never** reduce the balance until Meridian staff confirm receipt with the insurer. Partial confirmations automatically transition the installment to `partially_paid` and compute the exact remaining balance (`app.recalculate_installment_financials`).
- **Multi-Attempt Extensions**: Customers request due-date extensions without overwriting the current due date. Meridian tracks 1st, 2nd, and 3rd+ attempts in `public.extensions` with insurer protocol numbers and handles partial approvals (e.g., when Aurora Seguros approves `15/11/2026` instead of the requested `30/11/2026`).
- **Amount Disputes & Endorsement Breakdowns**: Customers flag amount discrepancies (e.g., PO vs. billed installment), and Meridian tracks insurer calculation memories (`Endosso`) and attaches breakdown PDFs for customer review.

### C. Idempotent Excel Synchronization & Data-Quality Quarantine
- Every workbook import is logged in `public.import_batches` and `public.import_rows`.
- Re-importing the same file is idempotent (`0` duplicate installments or timeline events) and preserves all portal workflows.
- Problematic rows (`2` missing-policyholder rows, `6` standalone swapped-date rows, and `6` conflicting duplicate pairs = `14` held rows) are automatically quarantined (`is_customer_visible = false`, `data_quality_status = 'held'`) in `/internal/data-quality` until staff review and approve them.
- Previously overdue installments that disappear from a newer spreadsheet without confirmed payment are automatically flagged as `missing_from_latest_report` for investigation rather than silently disappearing.

### D. Week-over-Week Historical Analytics & Cancellation-Risk Triage
- **Stored Weekly Snapshots (`public.installment_snapshots`)**: Tracks week-over-week net overdue change, newly overdue receivables, confirmed paid collections, extension-driven improvements, and standardized aging buckets (`1–30`, `31–60`, `61–89`, `90+` days) overall and by corporate group.
- **Cancellation-Risk Triage (`/internal/cancellation-risk`)**: Prioritizes **Judicial Guarantee** bonds first, **Other Surety** lines second, and **Standard Lines** third, paired with an explicit internal heuristic disclaimer and a separate section for the `12` cancelled installments.
