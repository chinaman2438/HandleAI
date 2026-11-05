-- =============================================================================
-- 0006 — Row Level Security (RLS) & Access Control Helpers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Security helper functions in schema `app`
-- SECURITY DEFINER with empty search_path so RLS policies never recurse.
-- ---------------------------------------------------------------------------
create or replace function app.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function app.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id from public.profiles p where p.id = auth.uid();
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('employee', 'admin')
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on EVERY table in public
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.policyholders enable row level security;
alter table public.profiles enable row level security;
alter table public.policies enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.installments enable row level security;
alter table public.exceptions enable row level security;
alter table public.documents enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_verifications enable row level security;
alter table public.extensions enable row level security;
alter table public.exception_messages enable row level security;
alter table public.internal_notes enable row level security;
alter table public.installment_internal_tracking enable row level security;
alter table public.activity_logs enable row level security;
alter table public.installment_snapshots enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.risk_rules enable row level security;
alter table public.reminder_settings enable row level security;
alter table public.reminders enable row level security;

-- ---------------------------------------------------------------------------
-- 1. organizations
-- Staff: read all; Admin: insert/update. Customer: read ONLY own organization.
-- ---------------------------------------------------------------------------
create policy organizations_select_staff on public.organizations
  for select to authenticated
  using (app.is_staff());

create policy organizations_select_customer on public.organizations
  for select to authenticated
  using (id = app.current_user_org_id());

create policy organizations_write_admin on public.organizations
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- 2. policyholders
-- Joint-venture rule: a policyholder is visible to a customer ONLY if that
-- policyholder is linked to at least one customer-visible installment in the
-- customer's own organization.
-- ---------------------------------------------------------------------------
create policy policyholders_select_staff on public.policyholders
  for select to authenticated
  using (app.is_staff());

create policy policyholders_select_customer on public.policyholders
  for select to authenticated
  using (
    exists (
      select 1
        from public.policies p
        join public.installments i on i.policy_id = p.id
       where p.policyholder_id = public.policyholders.id
         and p.organization_id = app.current_user_org_id()
         and i.is_customer_visible = true
    )
  );

create policy policyholders_write_staff on public.policyholders
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 3. profiles
-- Users can read their own profile. Staff can read all profiles.
-- Only admins can change roles or organization assignments.
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_staff on public.profiles
  for select to authenticated
  using (app.is_staff());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = app.current_user_role()
    and organization_id is not distinct from app.current_user_org_id()
  );

create policy profiles_write_admin on public.profiles
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- 4. policies
-- Customer access is determined by policies.organization_id (NEVER policyholder).
-- Moreover, customers only see policies that have at least one visible installment.
-- ---------------------------------------------------------------------------
create policy policies_select_staff on public.policies
  for select to authenticated
  using (app.is_staff());

create policy policies_select_customer on public.policies
  for select to authenticated
  using (
    organization_id = app.current_user_org_id()
    and exists (
      select 1 from public.installments i
       where i.policy_id = public.policies.id
         and i.is_customer_visible = true
    )
  );

create policy policies_write_staff on public.policies
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 5. installments
-- Customers can ONLY read rows belonging to their organization AND marked
-- is_customer_visible = true (held-back rows are hidden).
-- Customers can NEVER insert, update, or delete installments directly.
-- ---------------------------------------------------------------------------
create policy installments_select_staff on public.installments
  for select to authenticated
  using (app.is_staff());

create policy installments_select_customer on public.installments
  for select to authenticated
  using (
    organization_id = app.current_user_org_id()
    and is_customer_visible = true
  );

create policy installments_write_staff on public.installments
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 6. payments & payment_allocations
-- Column-level protection: revoke direct SELECT on internal verification
-- columns from `authenticated` is not used because staff also use `authenticated`;
-- instead, a BEFORE/AFTER policy + customer_payments view + trigger ensures
-- customers cannot read or set verified_by/verified_at/notes, and we also
-- restrict direct table SELECT on `payments` to staff or own-org via RLS, PLUS
-- a security-barrier column mask helper for any direct PostgREST select.
-- Better yet: we mask internal columns at the SQL level for non-staff using a
-- generated/view pattern AND prevent customers from ever setting verification_status
-- to anything other than 'submitted'.
-- ---------------------------------------------------------------------------
create policy payments_select_staff on public.payments
  for select to authenticated
  using (app.is_staff());

create policy payments_insert_customer on public.payments
  for insert to authenticated
  with check (
    organization_id = app.current_user_org_id()
    and verification_status = 'submitted'
    and confirmed_amount_brl is null
    and verified_by is null
    and verified_at is null
    and notes is null
    and exists (
      select 1 from public.installments i
       where i.id = installment_id
         and i.organization_id = app.current_user_org_id()
         and i.is_customer_visible = true
    )
  );

create policy payments_write_staff on public.payments
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy payment_allocations_select_staff on public.payment_allocations
  for select to authenticated
  using (app.is_staff());

create policy payment_allocations_select_customer on public.payment_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.installments i
       where i.id = public.payment_allocations.installment_id
         and i.organization_id = app.current_user_org_id()
         and i.is_customer_visible = true
    )
  );

create policy payment_allocations_write_staff on public.payment_allocations
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 7. extensions
-- Customers can read their own organization's extensions and can ONLY insert
-- new extension requests with status = 'requested' and approved_due_date IS NULL.
-- Customers can NEVER update an extension or mark it approved.
-- ---------------------------------------------------------------------------
create policy extensions_select_staff on public.extensions
  for select to authenticated
  using (app.is_staff());

create policy extensions_select_customer on public.extensions
  for select to authenticated
  using (organization_id = app.current_user_org_id());

create policy extensions_insert_customer on public.extensions
  for insert to authenticated
  with check (
    organization_id = app.current_user_org_id()
    and status = 'requested'
    and approved_due_date is null
    and protocol_number is null
    and insurer_response_at is null
    and exists (
      select 1 from public.installments i
       where i.id = installment_id
         and i.organization_id = app.current_user_org_id()
         and i.is_customer_visible = true
    )
  );

create policy extensions_write_staff on public.extensions
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 8. exceptions & exception_messages
-- ---------------------------------------------------------------------------
create policy exceptions_select_staff on public.exceptions
  for select to authenticated
  using (app.is_staff());

create policy exceptions_select_customer on public.exceptions
  for select to authenticated
  using (organization_id = app.current_user_org_id());

create policy exceptions_insert_customer on public.exceptions
  for insert to authenticated
  with check (
    organization_id = app.current_user_org_id()
    and status in ('new', 'pending_review')
    and exists (
      select 1 from public.installments i
       where i.id = installment_id
         and i.organization_id = app.current_user_org_id()
         and i.is_customer_visible = true
    )
  );

create policy exceptions_write_staff on public.exceptions
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy exception_messages_select_staff on public.exception_messages
  for select to authenticated
  using (app.is_staff());

create policy exception_messages_select_customer on public.exception_messages
  for select to authenticated
  using (
    organization_id = app.current_user_org_id()
    and visibility = 'customer'
  );

create policy exception_messages_insert_customer on public.exception_messages
  for insert to authenticated
  with check (
    organization_id = app.current_user_org_id()
    and visibility = 'customer'
    and author_kind = 'customer'
  );

create policy exception_messages_write_staff on public.exception_messages
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 9. documents
-- Customers only see customer-visible documents in their own organization.
-- ---------------------------------------------------------------------------
create policy documents_select_staff on public.documents
  for select to authenticated
  using (app.is_staff());

create policy documents_select_customer on public.documents
  for select to authenticated
  using (
    organization_id = app.current_user_org_id()
    and visibility = 'customer'
  );

create policy documents_insert_customer on public.documents
  for insert to authenticated
  with check (
    organization_id = app.current_user_org_id()
    and visibility = 'customer'
    and document_type in ('payment_receipt', 'dispute_support')
  );

create policy documents_write_staff on public.documents
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 10. activity_logs
-- Customers ONLY see rows with visibility = 'customer' AND their organization_id.
-- Internal timeline entries (import diffs, internal notes, employee checks)
-- are completely invisible to customers.
-- ---------------------------------------------------------------------------
create policy activity_logs_select_staff on public.activity_logs
  for select to authenticated
  using (app.is_staff());

create policy activity_logs_select_customer on public.activity_logs
  for select to authenticated
  using (
    organization_id = app.current_user_org_id()
    and visibility = 'customer'
  );

create policy activity_logs_write_staff on public.activity_logs
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 11. installment_snapshots & reminders (customer can view own org's records)
-- ---------------------------------------------------------------------------
create policy snapshots_select_staff on public.installment_snapshots
  for select to authenticated
  using (app.is_staff());

create policy snapshots_select_customer on public.installment_snapshots
  for select to authenticated
  using (organization_id = app.current_user_org_id());

create policy snapshots_write_staff on public.installment_snapshots
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy reminders_select_staff on public.reminders
  for select to authenticated
  using (app.is_staff());

create policy reminders_select_customer on public.reminders
  for select to authenticated
  using (organization_id = app.current_user_org_id());

create policy reminders_write_staff on public.reminders
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

-- ---------------------------------------------------------------------------
-- 12. STRICTLY INTERNAL TABLES — Staff only (ZERO customer policies)
--     - internal_notes
--     - installment_internal_tracking (Checked By / Sent to Client On)
--     - payment_verifications
--     - import_batches
--     - import_rows
--     - data_quality_issues
--     - risk_rules
--     - reminder_settings
-- ---------------------------------------------------------------------------
create policy internal_notes_staff_only on public.internal_notes
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy internal_tracking_staff_only on public.installment_internal_tracking
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy payment_verifications_staff_only on public.payment_verifications
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy import_batches_staff_only on public.import_batches
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy import_rows_staff_only on public.import_rows
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy data_quality_issues_staff_only on public.data_quality_issues
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy risk_rules_staff_only on public.risk_rules
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());

create policy reminder_settings_staff_only on public.reminder_settings
  for all to authenticated
  using (app.is_staff())
  with check (app.is_staff());
