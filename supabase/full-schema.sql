-- >>> 20261105000001_enums_and_helpers.sql
-- =============================================================================
-- 0001 — Schemas, enums and shared helpers
-- Meridian Receivables Portal
-- =============================================================================

-- Private schema for helper functions used by RLS policies and RPCs.
-- It is NOT exposed through the Supabase Data API.
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'employee', 'admin');

create type public.payment_status as enum (
  'open',
  'under_review',
  'partially_paid',
  'paid',
  'cancelled',
  'missing_from_latest_report'
);

create type public.verification_status as enum ('submitted', 'under_review', 'confirmed', 'rejected');

create type public.extension_status as enum (
  'requested',
  'submitted_to_insurer',
  'approved',
  'rejected',
  'awaiting_response',
  'superseded'
);

create type public.exception_type as enum ('payment_receipt', 'extension_request', 'amount_dispute', 'other');

create type public.exception_status as enum (
  'new',
  'pending_review',
  'awaiting_insurer',
  'awaiting_customer',
  'approved',
  'rejected',
  'resolved'
);

create type public.visibility_level as enum ('customer', 'internal');

create type public.dq_severity as enum ('info', 'warning', 'high');

create type public.dq_status as enum ('open', 'resolved', 'dismissed');

create type public.import_row_outcome as enum (
  'new',
  'updated',
  'unchanged',
  'held',
  'rejected',
  'duplicate_skipped',
  'ignored'
);

create type public.reminder_status as enum ('generated', 'queued', 'sent', 'failed', 'demo_logged', 'cancelled');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

-- "Today" in Brazil (business dates are evaluated in America/Sao_Paulo).
create or replace function app.today_br()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Keep updated_at current.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Aging bucket convention (non-overlapping): 1–30, 31–60, 61–89, 90+.
create or replace function app.aging_bucket(p_days_overdue integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_days_overdue is null or p_days_overdue <= 0 then 'current'
    when p_days_overdue <= 30 then '1-30'
    when p_days_overdue <= 60 then '31-60'
    when p_days_overdue <= 89 then '61-89'
    else '90+'
  end;
$$;

-- Normalise free text the same way the importer does (case/space-insensitive).
-- Accent folding is performed by the importer (TypeScript) before data reaches SQL,
-- this is a defensive fallback for manually-entered names.
create or replace function app.normalize_name(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(
          translate(
            coalesce(p_text, ''),
            'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
            'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
          )
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;


-- >>> 20261105000002_core.sql
-- =============================================================================
-- 0002 — Core domain: organizations, policyholders, policies, installments, profiles
-- =============================================================================

-- ---------------------------------------------------------------------------
-- organizations — customer GROUPS (e.g. Grupo Atlântica), not subsidiaries
-- ---------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  normalized_name  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint organizations_normalized_name_key unique (normalized_name),
  constraint organizations_name_not_blank check (btrim(name) <> '')
);
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- policyholders — legal entities that own policies.
-- A policyholder can appear under SEVERAL organizations (joint ventures such as
-- Terminal Portuário Sul). Access is NEVER derived from the policyholder.
-- ---------------------------------------------------------------------------
create table public.policyholders (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  tax_id           text,                       -- formatted CNPJ/CPF as received (e.g. 85.551.345/0001-10)
  tax_id_digits    text,                       -- digits only, used for matching
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint policyholders_tax_id_digits_format check (tax_id_digits is null or tax_id_digits ~ '^[0-9]{11}$|^[0-9]{14}$')
);
create unique index policyholders_tax_id_digits_key on public.policyholders (tax_id_digits) where tax_id_digits is not null;
create index policyholders_name_idx on public.policyholders (lower(name));
create trigger policyholders_touch before update on public.policyholders
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete restrict,
  full_name        text,
  email            text,
  role             public.app_role not null default 'customer',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Staff are never attached to a customer group. A customer without an
  -- organization simply has no data access until an admin assigns one.
  constraint profiles_staff_without_org check (role = 'customer' or organization_id is null)
);
create index profiles_organization_idx on public.profiles (organization_id);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- policies — one row per (organization, policy number, endorsement).
-- The ORGANIZATION belongs to the policy / receivables context.
-- ---------------------------------------------------------------------------
create table public.policies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  policyholder_id  uuid not null references public.policyholders (id) on delete restrict,
  insurer          text not null,
  policy_number    text not null,
  endorsement      text not null default '0',
  insurance_type   text not null,
  branch           text,
  account_manager  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint policies_org_policy_endorsement_key unique (organization_id, policy_number, endorsement)
);
create index policies_policyholder_idx on public.policies (policyholder_id);
create index policies_policy_number_idx on public.policies (policy_number);
create index policies_insurer_idx on public.policies (insurer);
create trigger policies_touch before update on public.policies
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- import_batches — one row per uploaded spreadsheet
-- (created here because installments reference it)
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id                    uuid primary key default gen_random_uuid(),
  file_name             text not null,
  file_hash             text,
  snapshot_date         date not null,
  total_rows            integer not null default 0,
  imported_rows         integer not null default 0,   -- new installments
  updated_rows          integer not null default 0,
  unchanged_rows        integer not null default 0,
  held_rows             integer not null default 0,   -- stored but held back from customers
  rejected_rows         integer not null default 0,   -- could not be stored at all
  duplicate_rows        integer not null default 0,
  ignored_rows          integer not null default 0,   -- blank / total lines
  missing_rows          integer not null default 0,   -- rows that disappeared vs. previous upload
  missing_overdue_rows  integer not null default 0,
  warning_count         integer not null default 0,
  status                text not null default 'processing' check (status in ('processing', 'completed', 'failed', 'duplicate')),
  duplicate_of          uuid references public.import_batches (id),
  error_message         text,
  summary               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  completed_at          timestamptz
);
create index import_batches_snapshot_idx on public.import_batches (snapshot_date desc);
create index import_batches_hash_idx on public.import_batches (file_hash);

-- ---------------------------------------------------------------------------
-- import_rows — every source row of every upload (original values preserved)
-- INTERNAL ONLY (raw rows contain Internal Notes / Checked By / Sent to Client On)
-- ---------------------------------------------------------------------------
create table public.import_rows (
  id               uuid primary key default gen_random_uuid(),
  import_batch_id  uuid not null references public.import_batches (id) on delete cascade,
  row_number       integer not null,
  record_key       text,
  outcome          public.import_row_outcome not null,
  issues           jsonb not null default '[]'::jsonb,
  raw              jsonb not null default '{}'::jsonb,
  normalized       jsonb not null default '{}'::jsonb,
  installment_id   uuid,
  created_at       timestamptz not null default now(),
  constraint import_rows_batch_row_key unique (import_batch_id, row_number)
);
create index import_rows_installment_idx on public.import_rows (installment_id);
create index import_rows_outcome_idx on public.import_rows (import_batch_id, outcome);

-- ---------------------------------------------------------------------------
-- installments
-- Identity = organization + policy no. + endorsement + installment (source value)
-- ---------------------------------------------------------------------------
create table public.installments (
  id                        uuid primary key default gen_random_uuid(),
  policy_id                 uuid not null references public.policies (id) on delete restrict,
  organization_id           uuid not null references public.organizations (id) on delete restrict, -- denormalised from policy (kept in sync by trigger)
  installment_number        integer not null,          -- business number (0 → 1, single upfront payment)
  source_installment_number integer not null,          -- value exactly as received (0 preserved)
  total_installments        integer not null,
  amount_brl                numeric(14, 2) not null,   -- negative = refund / credit
  original_due_date         date,                      -- NEVER overwritten by imports
  extended_due_date         date,
  current_due_date          date,
  payment_status            public.payment_status not null default 'open',
  source_status             text not null default 'open' check (source_status in ('open', 'paid', 'cancelled')),
  outstanding_balance_brl   numeric(14, 2) not null default 0,
  confirmed_paid_brl        numeric(14, 2) not null default 0,
  is_credit                 boolean generated always as (amount_brl < 0) stored,
  is_customer_visible       boolean not null default false,
  data_quality_status       text not null default 'ok' check (data_quality_status in ('ok', 'held', 'approved')),
  is_missing_from_latest    boolean not null default false,
  missing_since             date,
  paid_source               text,                      -- 'spreadsheet' | 'investigation' | null
  cancellation_source       text,
  cancellation_reason       text,
  cancelled_at              timestamptz,
  source_row_id             text,                      -- e.g. "meridian-receivables-2026-11-02.xlsx#R347"
  import_row_id             uuid references public.import_rows (id) on delete set null,
  import_batch_id           uuid references public.import_batches (id) on delete set null,
  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint installments_policy_installment_key unique (policy_id, source_installment_number),
  constraint installments_numbers_valid check (installment_number >= 1 and source_installment_number >= 0 and total_installments >= 1),
  constraint installments_cancel_has_source check (
    payment_status <> 'cancelled' or source_status = 'cancelled' or cancellation_source is not null
  )
);
create index installments_org_idx on public.installments (organization_id);
create index installments_status_idx on public.installments (payment_status);
create index installments_current_due_idx on public.installments (current_due_date);
create index installments_visible_idx on public.installments (organization_id, is_customer_visible);
create trigger installments_touch before update on public.installments
  for each row execute function app.touch_updated_at();

alter table public.import_rows
  add constraint import_rows_installment_fk foreign key (installment_id) references public.installments (id) on delete set null;

-- Keep installments.organization_id identical to the policy's organization.
create or replace function app.installments_sync_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id from public.policies p where p.id = new.policy_id;
  if new.organization_id is null then
    raise exception 'Policy % not found for installment', new.policy_id;
  end if;
  return new;
end;
$$;
create trigger installments_sync_org before insert or update of policy_id, organization_id on public.installments
  for each row execute function app.installments_sync_org();


-- >>> 20261105000003_workflows.sql
-- =============================================================================
-- 0003 — Workflows: documents, payments, allocations, extensions, exceptions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- exceptions — customer requests and their handling (receipts, extensions,
-- disputes, other). Customer-safe columns only; internal discussion lives in
-- exception_messages (visibility = 'internal') and internal_notes.
-- ---------------------------------------------------------------------------
create table public.exceptions (
  id                       uuid primary key default gen_random_uuid(),
  installment_id           uuid not null references public.installments (id) on delete restrict,
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  type                     public.exception_type not null,
  status                   public.exception_status not null default 'new',
  description              text,
  requested_amount         numeric(14, 2),       -- amount the customer believes is correct (disputes)
  priority                 text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  payment_id               uuid,                 -- linked payment (payment_receipt)
  extension_id             uuid,                 -- linked extension (extension_request)
  endorsement_reference    text,                 -- disputes: endorsement responsible for the amount
  insurer_breakdown_received_on date,            -- disputes: date the insurer breakdown was received
  customer_response        text,                 -- latest customer-facing explanation from Meridian
  resolution               text,                 -- customer-safe outcome summary
  assigned_to              uuid references auth.users (id) on delete set null,
  created_by               uuid references auth.users (id) on delete set null,
  resolved_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index exceptions_installment_idx on public.exceptions (installment_id);
create index exceptions_org_status_idx on public.exceptions (organization_id, status);
create index exceptions_type_status_idx on public.exceptions (type, status);
create trigger exceptions_touch before update on public.exceptions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- documents — metadata for files in the PRIVATE "documents" storage bucket
-- ---------------------------------------------------------------------------
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  installment_id   uuid references public.installments (id) on delete restrict,
  exception_id     uuid references public.exceptions (id) on delete set null,
  organization_id  uuid references public.organizations (id) on delete restrict,
  uploaded_by      uuid references auth.users (id) on delete set null,
  storage_path     text not null,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       bigint,
  document_type    text not null check (document_type in ('payment_receipt', 'dispute_support', 'insurer_breakdown', 'spreadsheet', 'other')),
  visibility       public.visibility_level not null default 'customer',
  created_at       timestamptz not null default now(),
  constraint documents_storage_path_key unique (storage_path)
);
create index documents_installment_idx on public.documents (installment_id);
create index documents_org_idx on public.documents (organization_id);
create index documents_exception_idx on public.documents (exception_id);

-- ---------------------------------------------------------------------------
-- payments — receipts submitted by customers or recorded by employees.
-- verified_by / verified_at / notes are INTERNAL and only reachable by staff
-- (customers read payments through the customer_payments view).
-- ---------------------------------------------------------------------------
create table public.payments (
  id                         uuid primary key default gen_random_uuid(),
  installment_id             uuid not null references public.installments (id) on delete restrict, -- primary installment (MVP: one receipt → one installment)
  organization_id            uuid not null references public.organizations (id) on delete restrict,
  amount_brl                 numeric(14, 2) not null check (amount_brl > 0),  -- amount the payer claims
  payment_date               date not null,
  receipt_document_id        uuid references public.documents (id) on delete set null,
  verification_status        public.verification_status not null default 'submitted',
  confirmed_amount_brl       numeric(14, 2) check (confirmed_amount_brl is null or confirmed_amount_brl >= 0),
  insurer_confirmation_date  date,
  customer_comment           text,
  submitted_by               uuid references auth.users (id) on delete set null,
  submitted_via              text not null default 'customer_portal' check (submitted_via in ('customer_portal', 'employee')),
  verified_by                uuid references auth.users (id) on delete set null,   -- INTERNAL
  verified_at                timestamptz,                                          -- INTERNAL
  notes                      text,                                                 -- INTERNAL (insurer confirmation notes)
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index payments_installment_idx on public.payments (installment_id);
create index payments_org_idx on public.payments (organization_id);
create index payments_status_idx on public.payments (verification_status);
create trigger payments_touch before update on public.payments
  for each row execute function app.touch_updated_at();

alter table public.exceptions
  add constraint exceptions_payment_fk foreign key (payment_id) references public.payments (id) on delete set null;

-- ---------------------------------------------------------------------------
-- payment_allocations — supports one payment covering several installments
-- (database-level only in the MVP; the UI allocates one receipt → one installment)
-- ---------------------------------------------------------------------------
create table public.payment_allocations (
  id                    uuid primary key default gen_random_uuid(),
  payment_id            uuid not null references public.payments (id) on delete cascade,
  installment_id        uuid not null references public.installments (id) on delete restrict,
  allocated_amount_brl  numeric(14, 2) not null check (allocated_amount_brl > 0),
  confirmed_amount_brl  numeric(14, 2) check (confirmed_amount_brl is null or confirmed_amount_brl >= 0),
  created_at            timestamptz not null default now(),
  constraint payment_allocations_payment_installment_key unique (payment_id, installment_id)
);
create index payment_allocations_installment_idx on public.payment_allocations (installment_id);

-- ---------------------------------------------------------------------------
-- payment_verifications — INTERNAL audit of every check made with the insurer
-- ---------------------------------------------------------------------------
create table public.payment_verifications (
  id                         uuid primary key default gen_random_uuid(),
  payment_id                 uuid not null references public.payments (id) on delete cascade,
  installment_id             uuid not null references public.installments (id) on delete restrict,
  checked_by                 uuid references auth.users (id) on delete set null,
  checked_at                 timestamptz not null default now(),
  insurer_confirmed          boolean not null,
  confirmed_amount_brl       numeric(14, 2),
  remaining_balance_brl      numeric(14, 2),
  insurer_confirmation_date  date,
  notes                      text,
  created_at                 timestamptz not null default now()
);
create index payment_verifications_payment_idx on public.payment_verifications (payment_id);

-- ---------------------------------------------------------------------------
-- extensions — every attempt is a NEW row; previous attempts are never overwritten
-- ---------------------------------------------------------------------------
create table public.extensions (
  id                       uuid primary key default gen_random_uuid(),
  installment_id           uuid not null references public.installments (id) on delete restrict,
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  attempt_number           integer not null,
  requested_due_date       date not null,
  approved_due_date        date,
  previous_due_date        date,                -- current due date when the attempt was created
  request_reason           text,
  insurer                  text not null,
  protocol_number          text,
  status                   public.extension_status not null default 'requested',
  requested_by             uuid references auth.users (id) on delete set null,
  requested_via            text not null default 'customer_portal' check (requested_via in ('customer_portal', 'employee')),
  requested_at             timestamptz not null default now(),
  submitted_to_insurer_at  timestamptz,
  insurer_response_at      timestamptz,
  response_notes           text,                -- customer-facing insurer response
  superseded_by            uuid references public.extensions (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint extensions_installment_attempt_key unique (installment_id, attempt_number),
  constraint extensions_approved_has_date check (status <> 'approved' or approved_due_date is not null)
);
create index extensions_status_idx on public.extensions (status);
create index extensions_org_idx on public.extensions (organization_id);
create trigger extensions_touch before update on public.extensions
  for each row execute function app.touch_updated_at();

alter table public.exceptions
  add constraint exceptions_extension_fk foreign key (extension_id) references public.extensions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- exception_messages — conversation on a request.
-- visibility = 'customer'  → customer-facing response / customer reply
-- visibility = 'internal'  → staff-only follow-ups (never shown to customers)
-- ---------------------------------------------------------------------------
create table public.exception_messages (
  id               uuid primary key default gen_random_uuid(),
  exception_id     uuid not null references public.exceptions (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  author_id        uuid references auth.users (id) on delete set null,
  author_kind      text not null check (author_kind in ('customer', 'meridian', 'system')),
  visibility       public.visibility_level not null,
  body             text not null check (btrim(body) <> ''),
  created_at       timestamptz not null default now()
);
create index exception_messages_exception_idx on public.exception_messages (exception_id, created_at);


-- >>> 20261105000004_internal_history_and_snapshots.sql
-- =============================================================================
-- 0004 — Internal confidentiality tables, audit logs, snapshots, DQ & reminders
-- =============================================================================

-- ---------------------------------------------------------------------------
-- internal_notes — STRICTLY INTERNAL. Never accessible to customer roles.
-- ---------------------------------------------------------------------------
create table public.internal_notes (
  id              uuid primary key default gen_random_uuid(),
  installment_id  uuid references public.installments (id) on delete cascade,
  policy_id       uuid references public.policies (id) on delete cascade,
  author_id       uuid references auth.users (id) on delete set null,
  source          text not null default 'manual' check (source in ('manual', 'spreadsheet_import')),
  import_batch_id uuid references public.import_batches (id) on delete set null,
  content         text not null check (btrim(content) <> ''),
  created_at      timestamptz not null default now()
);
create index internal_notes_installment_idx on public.internal_notes (installment_id, created_at desc);
create index internal_notes_policy_idx on public.internal_notes (policy_id, created_at desc);

-- ---------------------------------------------------------------------------
-- installment_internal_tracking — STRICTLY INTERNAL.
-- Stores "Checked By" and "Sent to Client On" values across imports & manual updates.
-- ---------------------------------------------------------------------------
create table public.installment_internal_tracking (
  id                 uuid primary key default gen_random_uuid(),
  installment_id     uuid not null references public.installments (id) on delete cascade,
  import_batch_id    uuid references public.import_batches (id) on delete set null,
  checked_by_raw     text,
  sent_to_client_on  date,
  recorded_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index installment_internal_tracking_inst_idx on public.installment_internal_tracking (installment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- activity_logs — permanent audit trail for every installment & entity.
-- Never erased by subsequent spreadsheet imports.
-- visibility = 'customer' | 'internal' controls what customers can see.
-- ---------------------------------------------------------------------------
create table public.activity_logs (
  id               uuid primary key default gen_random_uuid(),
  actor_id         uuid references auth.users (id) on delete set null,
  actor_label      text,
  organization_id  uuid references public.organizations (id) on delete restrict,
  installment_id   uuid references public.installments (id) on delete cascade,
  entity_type      text not null,
  entity_id        uuid not null,
  action           text not null,
  visibility       public.visibility_level not null default 'internal',
  old_values       jsonb,
  new_values       jsonb,
  description      text not null,
  import_batch_id  uuid references public.import_batches (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index activity_logs_installment_idx on public.activity_logs (installment_id, created_at desc);
create index activity_logs_org_vis_idx on public.activity_logs (organization_id, visibility, created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- installment_snapshots — periodic historical receivables data per import batch
-- Required for week-over-week analytics and movement tracking.
-- ---------------------------------------------------------------------------
create table public.installment_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  installment_id           uuid not null references public.installments (id) on delete cascade,
  snapshot_date            date not null,
  organization_id          uuid not null references public.organizations (id) on delete restrict,
  amount_brl               numeric(14, 2) not null,
  outstanding_balance_brl  numeric(14, 2) not null,
  payment_status           public.payment_status not null,
  original_due_date        date,
  extended_due_date        date,
  current_due_date         date,
  days_overdue             integer not null default 0,
  aging_bucket             text not null default 'current',
  had_approved_extension   boolean not null default false,
  is_missing_from_report   boolean not null default false,
  import_batch_id          uuid references public.import_batches (id) on delete set null,
  created_at               timestamptz not null default now(),
  constraint installment_snapshots_batch_inst_key unique (import_batch_id, installment_id)
);
create index installment_snapshots_date_org_idx on public.installment_snapshots (snapshot_date desc, organization_id);
create index installment_snapshots_inst_date_idx on public.installment_snapshots (installment_id, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- data_quality_issues — review queue for held-back rows, swapped dates,
-- conflicting duplicates, #REF! formula errors, and missing overdue rows.
-- STRICTLY INTERNAL.
-- ---------------------------------------------------------------------------
create table public.data_quality_issues (
  id               uuid primary key default gen_random_uuid(),
  installment_id   uuid references public.installments (id) on delete cascade,
  import_batch_id  uuid references public.import_batches (id) on delete cascade,
  import_row_id    uuid references public.import_rows (id) on delete set null,
  organization_id  uuid references public.organizations (id) on delete set null,
  row_number       integer,
  issue_code       text not null, -- e.g. 'missing_policyholder', 'swapped_dates', 'conflicting_duplicate', 'formula_ref_error', 'missing_overdue_from_report'
  severity         public.dq_severity not null default 'warning',
  status           public.dq_status not null default 'open',
  holds_visibility boolean not null default false,
  title            text not null,
  description      text not null,
  original_values  jsonb not null default '{}'::jsonb,
  resolution_notes text,
  resolved_by      uuid references auth.users (id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index data_quality_issues_status_idx on public.data_quality_issues (status, severity);
create index data_quality_issues_inst_idx on public.data_quality_issues (installment_id);
create index data_quality_issues_batch_idx on public.data_quality_issues (import_batch_id);
create trigger data_quality_issues_touch before update on public.data_quality_issues
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- risk_rules — configurable cancellation-risk heuristic parameters
-- ---------------------------------------------------------------------------
create table public.risk_rules (
  id                         text primary key default 'default',
  judicial_critical_days     integer not null default 30,
  surety_high_days           integer not null default 1,
  general_critical_days      integer not null default 60,
  general_high_days          integer not null default 45,
  general_medium_days        integer not null default 15,
  general_low_days           integer not null default 1,
  updated_by                 uuid references auth.users (id) on delete set null,
  updated_at                 timestamptz not null default now()
);

insert into public.risk_rules (id) values ('default') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- reminder_settings & reminders — upcoming payment notifications
-- Tracks generation and delivery separately; never claims "sent" in demo mode.
-- ---------------------------------------------------------------------------
create table public.reminder_settings (
  id                   text primary key default 'default',
  days_before_due      integer not null default 3 check (days_before_due between 1 and 30),
  enabled              boolean not null default true,
  provider_mode        text not null default 'demo' check (provider_mode in ('demo', 'resend', 'smtp')),
  sender_email         text not null default 'receivables@meridian.demo',
  updated_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now()
);

insert into public.reminder_settings (id) values ('default') on conflict (id) do nothing;

create table public.reminders (
  id               uuid primary key default gen_random_uuid(),
  installment_id   uuid not null references public.installments (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete restrict,
  due_date         date not null,
  days_before_due  integer not null,
  recipient_label  text not null,
  recipient_email  text,
  subject          text not null,
  body_preview     text not null,
  amount_brl       numeric(14, 2) not null,
  status           public.reminder_status not null default 'generated',
  provider         text not null default 'demo',
  provider_msg_id  text,
  error_message    text,
  generated_at     timestamptz not null default now(),
  sent_at          timestamptz,
  triggered_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint reminders_unique_per_due unique (installment_id, due_date, days_before_due)
);
create index reminders_org_status_idx on public.reminders (organization_id, status, generated_at desc);
create index reminders_inst_idx on public.reminders (installment_id);


-- >>> 20261105000005_functions_and_views.sql
-- =============================================================================
-- 0005 — Business logic functions, balance triggers, and customer-safe views
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Recalculate an installment's confirmed_paid_brl, outstanding_balance_brl,
-- and payment_status whenever payments or payment_allocations change.
--
-- Core rules:
-- 1. Only insurer-confirmed payment amounts reduce the confirmed balance.
-- 2. Unconfirmed receipts keep the installment in 'under_review' (or 'partially_paid'
--    if a previous payment was already confirmed).
-- 3. Negative amounts (credits/refunds) never have positive debt balance.
-- 4. Cancelled installments remain 'cancelled'.
-- ---------------------------------------------------------------------------
create or replace function app.recalculate_installment_financials(p_installment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.installments%rowtype;
  v_confirmed numeric(14, 2) := 0;
  v_pending_count integer := 0;
  v_outstanding numeric(14, 2) := 0;
  v_new_status public.payment_status;
begin
  select * into v_inst from public.installments where id = p_installment_id for update;
  if not found then
    return;
  end if;

  -- Sum confirmed amounts from payment_allocations (joined to confirmed payments)
  select coalesce(sum(coalesce(pa.confirmed_amount_brl, p.confirmed_amount_brl, 0)), 0)
    into v_confirmed
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
   where pa.installment_id = p_installment_id
     and p.verification_status = 'confirmed';

  -- Also check direct payments that might not have an allocation row yet
  if v_confirmed = 0 then
    select coalesce(sum(coalesce(p.confirmed_amount_brl, p.amount_brl)), 0)
      into v_confirmed
      from public.payments p
     where p.installment_id = p_installment_id
       and p.verification_status = 'confirmed'
       and not exists (
         select 1 from public.payment_allocations pa where pa.payment_id = p.id
       );
  end if;

  -- Count unconfirmed receipts (submitted or under_review)
  select count(*)
    into v_pending_count
    from public.payments p
   where p.installment_id = p_installment_id
     and p.verification_status in ('submitted', 'under_review');

  -- Determine balance & status
  if v_inst.payment_status = 'cancelled' or v_inst.source_status = 'cancelled' then
    v_new_status := 'cancelled';
    v_outstanding := case when v_inst.amount_brl > 0 then greatest(0, v_inst.amount_brl - v_confirmed) else 0 end;
  elsif v_inst.amount_brl < 0 then
    -- Credit / refund endorsement
    v_outstanding := 0;
    v_new_status := v_inst.payment_status;
  elsif v_inst.source_status = 'paid' and v_confirmed = 0 then
    -- Marked paid directly in the insurer spreadsheet
    v_confirmed := v_inst.amount_brl;
    v_outstanding := 0;
    v_new_status := 'paid';
  elsif v_confirmed >= v_inst.amount_brl and v_inst.amount_brl > 0 then
    v_outstanding := 0;
    v_new_status := 'paid';
  elsif v_confirmed > 0 and v_confirmed < v_inst.amount_brl then
    v_outstanding := v_inst.amount_brl - v_confirmed;
    v_new_status := 'partially_paid';
  elsif v_pending_count > 0 then
    v_outstanding := greatest(0, v_inst.amount_brl - v_confirmed);
    v_new_status := 'under_review';
  elsif v_inst.is_missing_from_latest then
    v_outstanding := greatest(0, v_inst.amount_brl - v_confirmed);
    v_new_status := 'missing_from_latest_report';
  else
    v_outstanding := greatest(0, v_inst.amount_brl - v_confirmed);
    v_new_status := 'open';
  end if;

  update public.installments
     set confirmed_paid_brl = v_confirmed,
         outstanding_balance_brl = v_outstanding,
         payment_status = v_new_status,
         updated_at = now()
   where id = p_installment_id;
end;
$$;

-- Trigger on payments to auto-create default 1-to-1 allocation and recalculate
create or replace function app.on_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.payment_allocations (payment_id, installment_id, allocated_amount_brl, confirmed_amount_brl)
    values (
      new.id,
      new.installment_id,
      new.amount_brl,
      case when new.verification_status = 'confirmed' then coalesce(new.confirmed_amount_brl, new.amount_brl) else null end
    )
    on conflict (payment_id, installment_id) do update
      set allocated_amount_brl = excluded.allocated_amount_brl,
          confirmed_amount_brl = excluded.confirmed_amount_brl;
    perform app.recalculate_installment_financials(new.installment_id);
    return new;
  elsif tg_op = 'UPDATE' then
    update public.payment_allocations
       set allocated_amount_brl = new.amount_brl,
           confirmed_amount_brl = case
             when new.verification_status = 'confirmed' then coalesce(new.confirmed_amount_brl, new.amount_brl)
             else null
           end
     where payment_id = new.id
       and installment_id = new.installment_id;
    perform app.recalculate_installment_financials(new.installment_id);
    if old.installment_id <> new.installment_id then
      perform app.recalculate_installment_financials(old.installment_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform app.recalculate_installment_financials(old.installment_id);
    return old;
  end if;
  return null;
end;
$$;

create trigger payments_recalc_after_change
  after insert or update or delete on public.payments
  for each row execute function app.on_payment_change();

-- ---------------------------------------------------------------------------
-- Cancellation Risk Heuristic Function
-- Priority:
--   1. Surety - Judicial Guarantee (Critical at 30+ days overdue, High at 1-29)
--   2. Other Surety lines (Critical at 45+ days, High at 1-44)
--   3. Other lines (Critical at 60+ days, High at 45-59, Medium at 15-44, Low at 1-14)
-- Never invents exact cancellation dates; returns heuristic level + reason.
-- ---------------------------------------------------------------------------
create or replace function app.compute_cancellation_risk(
  p_insurance_type text,
  p_payment_status public.payment_status,
  p_amount_brl numeric,
  p_outstanding_brl numeric,
  p_days_overdue integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_payment_status in ('paid', 'cancelled') then 'none'
    when p_amount_brl <= 0 or p_outstanding_brl <= 0 then 'none'
    when p_days_overdue is null or p_days_overdue <= 0 then 'none'
    when lower(coalesce(p_insurance_type, '')) like '%judicial%' then
      case when p_days_overdue >= 30 then 'critical' else 'high' end
    when lower(coalesce(p_insurance_type, '')) like '%surety%' then
      case when p_days_overdue >= 45 then 'critical' else 'high' end
    when p_days_overdue >= 60 then 'critical'
    when p_days_overdue >= 45 then 'high'
    when p_days_overdue >= 15 then 'medium'
    else 'low'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Customer-Safe Views
-- Strictly excludes internal_notes, checked_by, sent_to_client_on,
-- verified_by, verified_at, and internal payment notes.
-- Backed by a security-definer row filter so direct SELECT on `public.payments`
-- can be restricted to staff while customers read `public.customer_payments`.
-- ---------------------------------------------------------------------------
create or replace function app.visible_customer_payments()
returns table (
  id uuid,
  installment_id uuid,
  organization_id uuid,
  amount_brl numeric(14, 2),
  payment_date date,
  receipt_document_id uuid,
  verification_status public.verification_status,
  confirmed_amount_brl numeric(14, 2),
  insurer_confirmation_date date,
  customer_comment text,
  submitted_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.installment_id,
    p.organization_id,
    p.amount_brl,
    p.payment_date,
    p.receipt_document_id,
    p.verification_status,
    p.confirmed_amount_brl,
    p.insurer_confirmation_date,
    p.customer_comment,
    p.submitted_by,
    p.created_at,
    p.updated_at
  from public.payments p
  where (
    exists (
      select 1 from public.profiles pr
       where pr.id = auth.uid()
         and pr.role in ('employee', 'admin')
    )
    or p.organization_id = (
      select pr.organization_id from public.profiles pr where pr.id = auth.uid()
    )
  );
$$;

create or replace view public.customer_payments as
select * from app.visible_customer_payments();

create or replace view public.customer_installments
with (security_invoker = true)
as
select
  i.id,
  i.policy_id,
  i.organization_id,
  o.name as organization_name,
  p.policyholder_id,
  ph.name as policyholder_name,
  ph.tax_id as policyholder_tax_id,
  p.insurer,
  p.policy_number,
  p.endorsement,
  p.insurance_type,
  p.branch,
  p.account_manager,
  i.installment_number,
  i.source_installment_number,
  i.total_installments,
  i.amount_brl,
  i.outstanding_balance_brl,
  i.confirmed_paid_brl,
  i.is_credit,
  i.original_due_date,
  i.extended_due_date,
  i.current_due_date,
  i.payment_status,
  i.created_at,
  i.updated_at
from public.installments i
join public.policies p on p.id = i.policy_id
join public.organizations o on o.id = i.organization_id
join public.policyholders ph on ph.id = p.policyholder_id
where i.is_customer_visible = true;


-- >>> 20261105000006_rls.sql
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


-- >>> 20261105000007_storage.sql
-- =============================================================================
-- 0007 — Private Supabase Storage bucket & object-level RLS policies
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
     where table_schema = 'storage' and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documents',
      'documents',
      false,
      15728640, -- 15 MB
      array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ]
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;

    -- Drop existing policies if re-running
    drop policy if exists documents_storage_staff_all on storage.objects;
    drop policy if exists documents_storage_customer_select on storage.objects;
    drop policy if exists documents_storage_customer_insert on storage.objects;

    -- Staff can read and upload any object in the private `documents` bucket
    execute $pol$
      create policy documents_storage_staff_all on storage.objects
        for all to authenticated
        using (bucket_id = 'documents' and app.is_staff())
        with check (bucket_id = 'documents' and app.is_staff())
    $pol$;

    -- Customers can only read/upload objects under `org/<their_org_id>/...`
    execute $pol$
      create policy documents_storage_customer_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'documents'
          and (storage.foldername(name))[1] = 'org'
          and (storage.foldername(name))[2] = app.current_user_org_id()::text
        )
    $pol$;

    execute $pol$
      create policy documents_storage_customer_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'documents'
          and (storage.foldername(name))[1] = 'org'
          and (storage.foldername(name))[2] = app.current_user_org_id()::text
        )
    $pol$;
  end if;
end;
$$;


-- >>> 20261105000008_rpc_bridge.sql
-- =============================================================================
-- Migration 08: Service-Role RPC SQL Bridge for Serverless / HTTPS Execution
-- Allows the Next.js server (when authenticated with SUPABASE_SERVICE_ROLE_KEY)
-- to execute parameterized SQL and RLS-scoped transactions over HTTPS REST
-- even when a direct TCP Postgres connection string (SUPABASE_DB_URL) is not set.
-- =============================================================================

create or replace function public.meridian_exec_sql(
  query_text text,
  query_params jsonb default '[]'::jsonb,
  rls_user_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  final_sql text := query_text;
  n int := coalesce(jsonb_array_length(query_params), 0);
  i int;
  elem jsonb;
  rep text;
  rec record;
  rows_json jsonb := '[]'::jsonb;
  is_returning boolean;
begin
  if n > 0 then
    for i in reverse n..1 loop
      elem := query_params -> (i - 1);
      if elem is null or jsonb_typeof(elem) = 'null' then
        rep := 'NULL';
      elsif jsonb_typeof(elem) = 'boolean' then
        rep := elem::text;
      elsif jsonb_typeof(elem) = 'number' then
        rep := elem::text;
      else
        rep := quote_literal(elem #>> '{}');
      end if;
      final_sql := regexp_replace(final_sql, '\$' || i::text || '(?![0-9])', rep, 'g');
    end loop;
  end if;

  if rls_user_id is not null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', rls_user_id::text, true);
  end if;

  is_returning := (final_sql ~* '^\s*(select|with)\M') or (final_sql ~* '\mreturning\M');
  if is_returning then
    for rec in execute final_sql loop
      rows_json := rows_json || jsonb_build_array(to_jsonb(rec));
    end loop;
  else
    execute final_sql;
  end if;

  if rls_user_id is not null then
    perform set_config('role', 'service_role', true);
  end if;

  return rows_json;
exception
  when others then
    if rls_user_id is not null then
      perform set_config('role', 'service_role', true);
    end if;
    raise;
end;
$$;

revoke all on function public.meridian_exec_sql(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.meridian_exec_sql(text, jsonb, uuid) to service_role;
