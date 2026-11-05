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
