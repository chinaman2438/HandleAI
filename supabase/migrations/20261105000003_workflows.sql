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
