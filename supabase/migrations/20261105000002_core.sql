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
