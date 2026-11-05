import path from "path";
import fs from "fs";
import { SqlExecutor, syncWorkbookToDatabase } from "./sync";
import { parseReceivablesWorkbook } from "./parser";
import { DEMO_USERS } from "../auth/demo-users";

export { DEMO_USERS };

/**
 * Seeds the real workbook (`meridian-receivables-2026-11-02.xlsx`), demo users,
 * required demo workflows (Extension 01.18.0004471, Dispute 01.18.4183925,
 * Partial Payment, Missing Overdue Investigation), and historical weekly snapshots
 * so week-over-week analytics work out of the box.
 */
export async function ensureSeededDatabase(
  db: SqlExecutor,
  options: { workbookPath?: string } = {}
): Promise<void> {
  // Check if already seeded
  const existingOrgs = await db.query<{ count: string }>(
    `select count(*)::text as count from public.organizations`
  );
  if (Number(existingOrgs.rows[0]?.count ?? "0") > 0) {
    return;
  }

  const wbPath =
    options.workbookPath ??
    path.resolve(process.cwd(), "meridian-receivables-2026-11-02.xlsx");

  if (!fs.existsSync(wbPath)) {
    throw new Error(`Workbook not found at ${wbPath}`);
  }

  // 1. Parse and synchronize the real workbook (Snapshot: 2026-11-02)
  const parsed = await parseReceivablesWorkbook(wbPath, {
    fileName: "meridian-receivables-2026-11-02.xlsx",
  });
  await syncWorkbookToDatabase(db, parsed, {
    actorLabel: "Alex Moraes (Initial Workbook Import)",
    detectMissingRows: false,
  });

  // 2. Seed auth.users (when auth.users is writable, e.g. PGlite or direct DB) and public.profiles
  const orgRows = await db.query<{ id: string; normalized_name: string }>(
    `select id, normalized_name from public.organizations`
  );
  const orgByNorm = new Map(orgRows.rows.map((o) => [o.normalized_name, o.id]));

  for (const u of Object.values(DEMO_USERS)) {
    const orgId = u.organizationNormalized ? orgByNorm.get(u.organizationNormalized) ?? null : null;
    try {
      await db.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, $2, $3::jsonb)
         on conflict (id) do update set email = excluded.email`,
        [u.id, u.email, JSON.stringify({ full_name: u.fullName, role: u.role })]
      );
    } catch {
      // Ignore if auth.users is managed externally by Supabase GoTrue
    }

    const userExists = await db.query<{ id: string }>(
      `select id from auth.users where id = $1`,
      [u.id]
    );
    if (userExists.rows.length > 0) {
      await db.query(
        `insert into public.profiles (id, organization_id, full_name, email, role)
         values ($1, $2, $3, $4, $5::public.app_role)
         on conflict (id) do update
           set organization_id = excluded.organization_id,
               full_name = excluded.full_name,
               email = excluded.email,
               role = excluded.role`,
        [u.id, orgId, u.fullName, u.email, u.role]
      );
    }
  }

  // 3. Required Demo Scenario #1 — Section 11: Extension Management
  //    Customer: Grupo Atlântica | Policyholder: Atlântica Ferrovias S.A.
  //    Insurer: Aurora Seguros | Policy: 01.18.0004471 | Installment: 5/10 | R$ 41,870.55
  //    Attempt 1: Requested 2026-11-30 -> Insurer approved 2026-11-15 (Protocol AUR-2026-118843)
  //    Attempt 2: Customer rejected 2026-11-15 -> Meridian requested another extension on 2026-11-05
  //               Status: awaiting_response (Current due date stays 2026-11-15)
  const extDemoRes = await db.query<{
    id: string;
    organization_id: string;
  }>(
    `select i.id, i.organization_id
       from public.installments i
       join public.policies p on p.id = i.policy_id
      where p.policy_number = '01.18.0004471'
        and i.installment_number = 5
      limit 1`
  );

  if (extDemoRes.rows[0]) {
    const { id: instId, organization_id: orgId } = extDemoRes.rows[0];

    await db.query(`delete from public.extensions where installment_id = $1`, [instId]);

    const ext1 = await db.query<{ id: string }>(
      `insert into public.extensions (
        installment_id, organization_id, attempt_number,
        requested_due_date, approved_due_date, previous_due_date,
        request_reason, insurer, protocol_number, status,
        requested_by, requested_via, requested_at,
        submitted_to_insurer_at, insurer_response_at, response_notes
      ) values (
        $1, $2, 1,
        '2026-11-30', '2026-11-15', '2026-10-10',
        'Customer cash-flow alignment with Q4 rail freight receivables cycle; requested November 30, 2026.',
        'Aurora Seguros', 'AUR-2026-118843', 'approved',
        $3, 'customer_portal', '2026-10-18T14:20:00Z',
        '2026-10-19T10:00:00Z', '2026-10-20T16:45:00Z',
        'Aurora Seguros approved a partial extension to November 15, 2026 (Protocol AUR-2026-118843) instead of the requested November 30, 2026.'
      ) returning id`,
      [instId, orgId, DEMO_USERS.atlantica.id]
    );

    const ext2 = await db.query<{ id: string }>(
      `insert into public.extensions (
        installment_id, organization_id, attempt_number,
        requested_due_date, approved_due_date, previous_due_date,
        request_reason, insurer, protocol_number, status,
        requested_by, requested_via, requested_at,
        submitted_to_insurer_at, response_notes
      ) values (
        $1, $2, 2,
        '2026-11-30', null, '2026-11-15',
        'November 15, 2026 does not align with treasury disbursement run. Customer requested re-submission for November 30, 2026.',
        'Aurora Seguros', 'AUR-2026-124910', 'awaiting_response',
        $3, 'customer_portal', '2026-11-04T17:10:00Z',
        '2026-11-05T09:30:00Z',
        'Submitted 2nd extension request to Aurora Seguros underwriting desk on 05/11/2026. Awaiting insurer decision; current approved due date remains 15/11/2026.'
      ) returning id`,
      [instId, orgId, DEMO_USERS.atlantica.id]
    );

    const excExt = await db.query<{ id: string }>(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, extension_id, customer_response, assigned_to, created_by, created_at
      ) values (
        $1, $2, 'extension_request', 'awaiting_insurer', 'high',
        '2nd extension attempt: Customer requested 30/11/2026 after insurer only approved 15/11/2026 on attempt #1 (AUR-2026-118843). Submitted to Aurora Seguros on 05/11/2026.',
        $3,
        'Your first extension was approved by Aurora Seguros until 15/11/2026 (Protocol AUR-2026-118843). Following your feedback, Meridian submitted a second extension request for 30/11/2026 on 05/11/2026. Your current official due date remains 15/11/2026 while we await the insurer''s response.',
        $4, $5, '2026-11-05T09:30:00Z'
      ) returning id`,
      [instId, orgId, ext2.rows[0].id, DEMO_USERS.employee.id, DEMO_USERS.atlantica.id]
    );

    // Log customer-visible timeline events for the extension scenario
    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, old_values, new_values, description, created_at
      ) values
      ($1, 'Mariana Costa (Grupo Atlântica)', $3, $4, 'extension', $5, 'extension_requested', 'customer',
       '{"currentDueDate":"2026-10-10"}'::jsonb, '{"requestedDueDate":"2026-11-30","attempt":1}'::jsonb,
       'Extension #1 requested by customer for 30/11/2026.', '2026-10-18T14:20:00Z'),
      ($2, 'Bruno Tavares (Meridian)', $3, $4, 'extension', $5, 'extension_approved', 'customer',
       '{"requestedDueDate":"2026-11-30","previousDueDate":"2026-10-10"}'::jsonb,
       '{"approvedDueDate":"2026-11-15","protocolNumber":"AUR-2026-118843","attempt":1}'::jsonb,
       'Aurora Seguros approved due date 15/11/2026 (requested 30/11/2026) under protocol AUR-2026-118843.', '2026-10-20T16:45:00Z'),
      ($1, 'Mariana Costa (Grupo Atlântica)', $3, $4, 'extension', $6, 'extension_requested', 'customer',
       '{"currentApprovedDueDate":"2026-11-15"}'::jsonb, '{"requestedDueDate":"2026-11-30","attempt":2}'::jsonb,
       'Customer indicated 15/11/2026 does not work and requested a 2nd extension to 30/11/2026.', '2026-11-04T17:10:00Z'),
      ($2, 'Bruno Tavares (Meridian)', $3, $4, 'extension', $6, 'extension_submitted_to_insurer', 'customer',
       '{"status":"requested"}'::jsonb, '{"status":"awaiting_response","submittedOn":"2026-11-05","protocolNumber":"AUR-2026-124910"}'::jsonb,
       '2nd extension request submitted to Aurora Seguros on 05/11/2026 (Protocol AUR-2026-124910). Awaiting insurer response; current due date remains 15/11/2026.', '2026-11-05T09:30:00Z')`,
      [
        DEMO_USERS.atlantica.id,
        DEMO_USERS.employee.id,
        orgId,
        instId,
        ext1.rows[0].id,
        ext2.rows[0].id,
      ]
    );
    void excExt;
  }

  // 4. Required Demo Scenario #2 — Section 15: Amount Dispute Management
  //    Customer: Grupo Atlântica | Policyholder: Atlântica Portos Ltda.
  //    Insurer: Aurora Seguros | Policy: 01.18.4183925 | Installment: 4/6 | Amount: R$ 5,649.25
  //    Customer disputed amount (PO was R$ 4,820.00). Insurer provided breakdown on Nov 6, 2026
  //    showing Endorsement #1 added R$ 829.25 in coverage.
  const dispDemoRes = await db.query<{
    id: string;
    organization_id: string;
  }>(
    `select i.id, i.organization_id
       from public.installments i
       join public.policies p on p.id = i.policy_id
      where p.policy_number = '01.18.4183925'
        and i.installment_number = 4
      limit 1`
  );

  if (dispDemoRes.rows[0]) {
    const { id: instId, organization_id: orgId } = dispDemoRes.rows[0];

    const dispExc = await db.query<{ id: string }>(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, requested_amount, endorsement_reference,
        insurer_breakdown_received_on, customer_response, resolution,
        assigned_to, created_by, created_at, updated_at
      ) values (
        $1, $2, 'amount_dispute', 'awaiting_customer', 'high',
        'Disputed installment 4/6 amount (R$ 5,649.25): does not match our original purchase order PO-2026-8841 (expected R$ 4,820.00 per installment).',
        4820.00,
        'Endorsement #1 (Container Crane & Berth Coverage Addition — +R$ 829.25/installment)',
        '2026-11-06',
        'Aurora Seguros provided the official premium breakdown on 06/11/2026. The base policy installment is R$ 4,820.00 (matching your PO-2026-8841), and Endorsement #1 added R$ 829.25 per installment for expanded berth cargo coverage (+IOF), totaling R$ 5,649.25. Breakdown document is attached for your review.',
        'Insurer breakdown received on 06/11/2026 confirming R$ 5,649.25 is accurate due to Endorsement #1 coverage addition.',
        $3, $4, '2026-10-28T11:15:00Z', '2026-11-06T15:00:00Z'
      ) returning id`,
      [instId, orgId, DEMO_USERS.employee.id, DEMO_USERS.atlantica.id]
    );

    const dispExcId = dispExc.rows[0].id;

    // Attach the insurer breakdown document metadata
    await db.query(
      `insert into public.documents (
        installment_id, exception_id, organization_id, uploaded_by,
        storage_path, file_name, mime_type, size_bytes, document_type, visibility, created_at
      ) values (
        $1, $2, $3, $4,
        $5, 'Aurora-Breakdown-01.18.4183925-Inst4-2026-11-06.pdf',
        'application/pdf', 184320, 'insurer_breakdown', 'customer', '2026-11-06T14:50:00Z'
      ) on conflict (storage_path) do nothing`,
      [
        instId,
        dispExcId,
        orgId,
        DEMO_USERS.employee.id,
        `org/${orgId}/disputes/${dispExcId}/Aurora-Breakdown-01.18.4183925-Inst4-2026-11-06.pdf`,
      ]
    );

    // Conversation messages on the dispute
    await db.query(
      `insert into public.exception_messages (
        exception_id, organization_id, author_id, author_kind, visibility, body, created_at
      ) values
      ($1, $2, $3, 'customer', 'customer',
       'Installment 4/6 is billed at R$ 5,649.25, whereas our Purchase Order PO-2026-8841 specifies R$ 4,820.00. Please verify with Aurora Seguros.',
       '2026-10-28T11:15:00Z'),
      ($1, $2, $4, 'meridian', 'internal',
       'Requested detailed endorsement & IOF installment calculation sheet from Aurora Seguros cargo billing desk (Ref: RS 28/10).',
       '2026-10-28T16:00:00Z'),
      ($1, $2, $4, 'meridian', 'customer',
       'Aurora Seguros provided the installment breakdown on 06/11/2026: Base premium R$ 4,820.00 + Endorsement #1 (added coverage) R$ 829.25 = R$ 5,649.25. We have attached the insurer breakdown PDF to this request.',
       '2026-11-06T15:00:00Z')`,
      [dispExcId, orgId, DEMO_USERS.atlantica.id, DEMO_USERS.employee.id]
    );

    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, old_values, new_values, description, created_at
      ) values
      ($1, 'Mariana Costa (Grupo Atlântica)', $3, $4, 'exception', $5, 'dispute_opened', 'customer',
       '{"billedAmountBrl":5649.25}'::jsonb, '{"expectedAmountBrl":4820.00}'::jsonb,
       'Amount dispute opened: customer PO shows R$ 4,820.00 vs billed R$ 5,649.25.', '2026-10-28T11:15:00Z'),
      ($2, 'Bruno Tavares (Meridian)', $3, $4, 'exception', $5, 'dispute_breakdown_provided', 'customer',
       null, '{"insurerBreakdownDate":"2026-11-06","endorsement":"Endorsement #1","confirmedAmountBrl":5649.25}'::jsonb,
       'Insurer breakdown received on 06/11/2026 confirming R$ 5,649.25 is correct because Endorsement #1 added coverage (+R$ 829.25).', '2026-11-06T15:00:00Z')`,
      [DEMO_USERS.atlantica.id, DEMO_USERS.employee.id, orgId, instId, dispExcId]
    );
  }

  // 5. Required Demo Scenario #3 — Section 12: Partial Payment & Receipt Under Review
  //    Pick an open Grupo Atlântica installment (Policy 01.18.0004471 Installment 6/10, R$ 41,870.55)
  //    - Payment #1: R$ 20,000.00 confirmed by Aurora Seguros -> status becomes 'partially_paid', remaining R$ 21,870.55
  //    - Payment #2: R$ 21,870.55 receipt submitted by customer -> under_review (does not reduce confirmed balance until verified!)
  const partialDemoRes = await db.query<{
    id: string;
    organization_id: string;
    amount_brl: string;
  }>(
    `select i.id, i.organization_id, i.amount_brl::text
       from public.installments i
       join public.policies p on p.id = i.policy_id
      where p.policy_number = '01.18.0004471'
        and i.installment_number = 6
      limit 1`
  );

  if (partialDemoRes.rows[0]) {
    const { id: instId, organization_id: orgId } = partialDemoRes.rows[0];

    const doc1 = await db.query<{ id: string }>(
      `insert into public.documents (
        installment_id, organization_id, uploaded_by,
        storage_path, file_name, mime_type, size_bytes, document_type, visibility, created_at
      ) values (
        $1, $2, $3,
        $4, 'Comprovante-PIX-Atlantica-Ferrovias-Parcial-1.pdf',
        'application/pdf', 94210, 'payment_receipt', 'customer', '2026-11-01T10:15:00Z'
      ) returning id`,
      [
        instId,
        orgId,
        DEMO_USERS.atlantica.id,
        `org/${orgId}/receipts/${instId}/Comprovante-PIX-Atlantica-Ferrovias-Parcial-1.pdf`,
      ]
    );

    const pay1 = await db.query<{ id: string }>(
      `insert into public.payments (
        installment_id, organization_id, amount_brl, payment_date,
        receipt_document_id, verification_status, confirmed_amount_brl,
        insurer_confirmation_date, customer_comment, submitted_by, submitted_via,
        verified_by, verified_at, notes, created_at
      ) values (
        $1, $2, 20000.00, '2026-11-01',
        $3, 'confirmed', 20000.00,
        '2026-11-02', 'First partial transfer (Tranche 1 of 2) via Itaú TED.',
        $4, 'customer_portal',
        $5, '2026-11-02T16:30:00Z',
        'Confirmed R$ 20,000.00 received in Aurora Seguros portal (clearing ref #88412). Remaining balance R$ 21,870.55.',
        '2026-11-01T10:15:00Z'
      ) returning id`,
      [instId, orgId, doc1.rows[0].id, DEMO_USERS.atlantica.id, DEMO_USERS.employee.id]
    );

    await db.query(
      `insert into public.payment_verifications (
        payment_id, installment_id, checked_by, checked_at,
        insurer_confirmed, confirmed_amount_brl, remaining_balance_brl,
        insurer_confirmation_date, notes
      ) values (
        $1, $2, $3, '2026-11-02T16:30:00Z',
        true, 20000.00, 21870.55, '2026-11-02',
        'Verified with Aurora Seguros portal — partial payment of R$ 20,000.00 settled.'
      )`,
      [pay1.rows[0].id, instId, DEMO_USERS.employee.id]
    );

    // Second receipt submitted by customer and awaiting insurer verification
    const doc2 = await db.query<{ id: string }>(
      `insert into public.documents (
        installment_id, organization_id, uploaded_by,
        storage_path, file_name, mime_type, size_bytes, document_type, visibility, created_at
      ) values (
        $1, $2, $3,
        $4, 'Comprovante-TED-Atlantica-Ferrovias-Saldo-2.pdf',
        'application/pdf', 98112, 'payment_receipt', 'customer', '2026-11-04T11:00:00Z'
      ) returning id`,
      [
        instId,
        orgId,
        DEMO_USERS.atlantica.id,
        `org/${orgId}/receipts/${instId}/Comprovante-TED-Atlantica-Ferrovias-Saldo-2.pdf`,
      ]
    );

    const pay2 = await db.query<{ id: string }>(
      `insert into public.payments (
        installment_id, organization_id, amount_brl, payment_date,
        receipt_document_id, verification_status, customer_comment,
        submitted_by, submitted_via, created_at
      ) values (
        $1, $2, 21870.55, '2026-11-04',
        $3, 'under_review', 'Second transfer covering the remaining balance of R$ 21,870.55.',
        $4, 'customer_portal', '2026-11-04T11:00:00Z'
      ) returning id`,
      [instId, orgId, doc2.rows[0].id, DEMO_USERS.atlantica.id]
    );

    await db.query(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, requested_amount, payment_id, assigned_to, created_by, created_at
      ) values (
        $1, $2, 'payment_receipt', 'pending_review', 'normal',
        'Customer uploaded receipt for remaining balance R$ 21,870.55 (2nd partial payment on installment 6/10). Verify clearing with Aurora Seguros.',
        21870.55, $3, $4, $5, '2026-11-04T11:00:00Z'
      )`,
      [instId, orgId, pay2.rows[0].id, DEMO_USERS.employee.id, DEMO_USERS.atlantica.id]
    );

    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, new_values, description, created_at
      ) values
      ($1, 'Mariana Costa (Grupo Atlântica)', $3, $4, 'payment', $5, 'payment_receipt_submitted', 'customer',
       '{"amountBrl":20000.00,"paymentDate":"2026-11-01"}'::jsonb,
       'Partial payment receipt #1 submitted for R$ 20,000.00.', '2026-11-01T10:15:00Z'),
      ($2, 'Bruno Tavares (Meridian)', $3, $4, 'payment', $5, 'payment_confirmed', 'customer',
       '{"confirmedAmountBrl":20000.00,"remainingBalanceBrl":21870.55,"status":"partially_paid"}'::jsonb,
       'Aurora Seguros confirmed partial payment of R$ 20,000.00. Remaining balance: R$ 21,870.55 (Status: Partially Paid).', '2026-11-02T16:30:00Z'),
      ($1, 'Mariana Costa (Grupo Atlântica)', $3, $4, 'payment', $6, 'payment_receipt_submitted', 'customer',
       '{"amountBrl":21870.55,"paymentDate":"2026-11-04","status":"under_review"}'::jsonb,
       'Receipt #2 submitted for remaining R$ 21,870.55. Awaiting insurer confirmation (confirmed balance remains R$ 21,870.55 until verified).', '2026-11-04T11:00:00Z')`,
      [
        DEMO_USERS.atlantica.id,
        DEMO_USERS.employee.id,
        orgId,
        instId,
        pay1.rows[0].id,
        pay2.rows[0].id,
      ]
    );
  }

  // 6. Seed 3 prior weekly snapshots (2026-10-12, 2026-10-19, 2026-10-26)
  //    so Section 10 ("Week-over-Week Receivables Analytics") shows real weekly movement:
  //    - Installments that were overdue on 2026-10-26 and became Paid by 2026-11-02 ("Resolved overdue")
  //    - Installments whose due dates fell between 2026-10-27 and 2026-11-01 ("Newly overdue")
  //    - Installments that had an extension approved moving their due date into the future ("Improved via extension")
  //    - Installments that were overdue and remained overdue ("Still outstanding")
  await seedHistoricalWeeklySnapshots(db);
}

async function seedHistoricalWeeklySnapshots(db: SqlExecutor): Promise<void> {
  const priorDates = ["2026-10-12", "2026-10-19", "2026-10-26"];
  const countRes = await db.query<{ count: string }>(
    `select count(*)::text as count from public.installments`
  );
  const totalCount = Number(countRes.rows[0]?.count ?? "0");

  for (const snapDate of priorDates) {
    const batchRes = await db.query<{ id: string }>(
      `insert into public.import_batches (
        file_name, file_hash, snapshot_date, total_rows, imported_rows,
        updated_rows, unchanged_rows, status, completed_at
      ) values (
        $1, $2, $3::date, $4, $4, 0, 0, 'completed', ($3 || 'T12:00:00Z')::timestamptz
      ) returning id`,
      [
        `meridian-receivables-${snapDate}.xlsx`,
        `historical-seed-${snapDate}`,
        snapDate,
        totalCount,
      ]
    );
    const batchId = batchRes.rows[0].id;

    await db.query(
      `insert into public.installment_snapshots (
         installment_id, snapshot_date, organization_id, amount_brl,
         outstanding_balance_brl, payment_status, original_due_date,
         extended_due_date, current_due_date, days_overdue, aging_bucket,
         had_approved_extension, is_missing_from_report, import_batch_id
       )
       select
         i.id,
         $1::date as snapshot_date,
         i.organization_id,
         i.amount_brl,
         case
           when i.payment_status = 'paid' and i.original_due_date is not null and i.original_due_date <= $1::date and i.amount_brl > 0
             then i.amount_brl
           when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date and i.amount_brl > 0
             then i.amount_brl
           else i.outstanding_balance_brl
         end as outstanding_balance_brl,
         case
           when i.payment_status = 'paid' and i.original_due_date is not null and i.original_due_date <= $1::date
             then 'open'::public.payment_status
           when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date
             then 'open'::public.payment_status
           else i.payment_status
         end as payment_status,
         i.original_due_date,
         i.extended_due_date,
         case
           when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date
             then i.original_due_date
           else i.current_due_date
         end as current_due_date,
         greatest(
           0,
           case
             when (
               case
                 when i.payment_status = 'paid' and i.original_due_date is not null and i.original_due_date <= $1::date then 'open'
                 when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date then 'open'
                 else i.payment_status::text
               end
             ) in ('paid', 'cancelled') or i.amount_brl <= 0 then 0
             else ($1::date - coalesce(
               case
                 when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date
                   then i.original_due_date
                 else i.current_due_date
               end,
               $1::date
             ))
           end
         ) as days_overdue,
         app.aging_bucket(
           greatest(
             0,
             case
               when (
                 case
                   when i.payment_status = 'paid' and i.original_due_date is not null and i.original_due_date <= $1::date then 'open'
                   when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date then 'open'
                   else i.payment_status::text
                 end
               ) in ('paid', 'cancelled') or i.amount_brl <= 0 then 0
               else ($1::date - coalesce(
                 case
                   when i.extended_due_date is not null and i.original_due_date is not null and i.extended_due_date > '2026-11-02'::date and i.original_due_date < '2026-10-26'::date and $1::date = '2026-10-26'::date
                     then i.original_due_date
                   else i.current_due_date
                 end,
                 $1::date
               ))
             end
           )
         ) as aging_bucket,
         coalesce(i.extended_due_date > i.original_due_date, false) as had_approved_extension,
         false,
         $2::uuid
       from public.installments i
       on conflict (import_batch_id, installment_id) do nothing`,
      [snapDate, batchId]
    );
  }
}
