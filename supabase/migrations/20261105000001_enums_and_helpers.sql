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
