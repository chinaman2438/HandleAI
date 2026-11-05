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
