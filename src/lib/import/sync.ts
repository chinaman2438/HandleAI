import { createHash } from "crypto";
import {
  NormalizedImportRow,
  ParsedWorkbookResult,
  parseReceivablesWorkbook,
} from "./parser";

function deterministicUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

export interface SyncBatchResult {
  batchId: string;
  fileName: string;
  snapshotDate: string;
  totalRows: number;
  importedRows: number;
  updatedRows: number;
  unchangedRows: number;
  heldRows: number;
  rejectedRows: number;
  duplicateRows: number;
  ignoredRows: number;
  missingRows: number;
  missingOverdueRows: number;
  warningCount: number;
  isIdempotentReimport: boolean;
}

export function computeDaysOverdue(
  currentDueDate: string | null,
  asOfDate: string,
  paymentStatus: string,
  outstandingBrl: number
): number {
  if (!currentDueDate) return 0;
  if (paymentStatus === "paid" || paymentStatus === "cancelled") return 0;
  if (outstandingBrl <= 0) return 0;
  const dueMs = Date.parse(`${currentDueDate}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
  const diffDays = Math.floor((asOfMs - dueMs) / (86400 * 1000));
  return diffDays > 0 ? diffDays : 0;
}

export function computeAgingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "1-30";
  if (daysOverdue <= 60) return "31-60";
  if (daysOverdue <= 89) return "61-89";
  return "90+";
}

/**
 * Synchronizes a parsed Excel workbook into PostgreSQL idempotently.
 */
export async function syncWorkbookToDatabase(
  db: SqlExecutor,
  parsed: ParsedWorkbookResult,
  options: {
    actorId?: string | null;
    actorLabel?: string;
    detectMissingRows?: boolean;
  } = {}
): Promise<SyncBatchResult> {
  const actorId = options.actorId ?? null;
  const actorLabel = options.actorLabel ?? "Spreadsheet Import Pipeline";
  const detectMissing = options.detectMissingRows ?? true;

  // Check if an identical fileHash + snapshotDate batch was already completed
  const prevBatchRes = await db.query<{ id: string }>(
    `select id from public.import_batches
      where file_hash = $1 and snapshot_date = $2 and status = 'completed'
      order by created_at desc limit 1`,
    [parsed.fileHash, parsed.snapshotDate]
  );
  const existingIdenticalBatchId = prevBatchRes.rows[0]?.id ?? null;

  // Create the import_batches record
  const batchInsert = await db.query<{ id: string }>(
    `insert into public.import_batches (
      file_name, file_hash, snapshot_date, total_rows, status, duplicate_of, created_by
    ) values ($1, $2, $3, $4, 'processing', $5, $6)
    returning id`,
    [
      parsed.fileName,
      parsed.fileHash,
      parsed.snapshotDate,
      parsed.dataRowCount,
      existingIdenticalBatchId,
      actorId,
    ]
  );
  const batchId = batchInsert.rows[0].id;

  // Pre-build a map of taxIdDigits -> known policyholder name from the workbook itself
  // so rows with missing policyholder name (e.g. row 7 & row 263) still attach to a valid entity while held back
  const knownNameByTaxDigits = new Map<string, { name: string; formattedTaxId: string }>();
  for (const r of parsed.rows) {
    if (r.policyholderName && r.policyholderTaxIdDigits && r.outcome !== "ignored") {
      if (!knownNameByTaxDigits.has(r.policyholderTaxIdDigits)) {
        knownNameByTaxDigits.set(r.policyholderTaxIdDigits, {
          name: r.policyholderName,
          formattedTaxId: r.policyholderTaxId ?? r.policyholderTaxIdDigits,
        });
      }
    }
  }

  const orgCache = new Map<string, string>(); // normalized_name -> id
  const policyholderCache = new Map<string, string>(); // taxIdDigits or lower(name) -> id
  const policyCache = new Map<string, string>(); // orgId|policyNo|endorsement -> id

  let importedRows = 0;
  let updatedRows = 0;
  let unchangedRows = 0;
  let heldRows = 0;
  let rejectedRows = 0;
  let duplicateRows = 0;
  let ignoredRows = 0;
  let warningCount = 0;

  const seenInstallmentIds = new Set<string>();

  for (const row of parsed.rows) {
    warningCount += row.issues.length;

    if (row.outcome === "ignored") {
      ignoredRows++;
      await db.query(
        `insert into public.import_rows (import_batch_id, row_number, record_key, outcome, issues, raw, normalized)
         values ($1, $2, $3, 'ignored', $4::jsonb, $5::jsonb, '{}'::jsonb)`,
        [batchId, row.rowNumber, null, JSON.stringify(row.issues), JSON.stringify(row.raw)]
      );
      continue;
    }

    if (row.outcome === "rejected") {
      rejectedRows++;
      const ir = await db.query<{ id: string }>(
        `insert into public.import_rows (import_batch_id, row_number, record_key, outcome, issues, raw, normalized)
         values ($1, $2, $3, 'rejected', $4::jsonb, $5::jsonb, '{}'::jsonb)
         returning id`,
        [batchId, row.rowNumber, row.recordKey, JSON.stringify(row.issues), JSON.stringify(row.raw)]
      );
      for (const issue of row.issues) {
        await insertDqIssueIfNew(db, {
          installmentId: null,
          batchId,
          importRowId: ir.rows[0].id,
          organizationId: null,
          rowNumber: row.rowNumber,
          issue,
          raw: row.raw,
        });
      }
      continue;
    }

    if (row.outcome === "duplicate_skipped") {
      duplicateRows++;
      await db.query(
        `insert into public.import_rows (import_batch_id, row_number, record_key, outcome, issues, raw, normalized)
         values ($1, $2, $3, 'duplicate_skipped', $4::jsonb, $5::jsonb, '{}'::jsonb)`,
        [batchId, row.rowNumber, row.recordKey, JSON.stringify(row.issues), JSON.stringify(row.raw)]
      );
      continue;
    }

    // 1. Upsert Organization (Customer Group)
    let orgId = orgCache.get(row.groupNameNormalized);
    if (!orgId) {
      const candidateOrgId = deterministicUuid(`org:${row.groupNameNormalized}`);
      const orgRes = await db.query<{ id: string }>(
        `insert into public.organizations (id, name, normalized_name)
         values ($1, $2, $3)
         on conflict (normalized_name) do update
           set updated_at = public.organizations.updated_at
         returning id`,
        [candidateOrgId, row.groupNameDisplay, row.groupNameNormalized]
      );
      orgId = orgRes.rows[0].id;
      orgCache.set(row.groupNameNormalized, orgId);
    }

    // 2. Upsert Policyholder (Joint-venture safe: policyholder has no organization_id)
    const phLookupKey =
      row.policyholderTaxIdDigits ?? `name:${(row.policyholderName ?? "unknown").toLowerCase()}`;
    let policyholderId = policyholderCache.get(phLookupKey);
    if (!policyholderId) {
      const fallbackName =
        row.policyholderName ??
        (row.policyholderTaxIdDigits
          ? knownNameByTaxDigits.get(row.policyholderTaxIdDigits)?.name
          : null) ??
        `Unverified Policyholder (${row.policyholderTaxId ?? row.policyNumber})`;

      const candidatePhId = deterministicUuid(`ph:${phLookupKey}`);
      if (row.policyholderTaxIdDigits) {
        const phRes = await db.query<{ id: string }>(
          `insert into public.policyholders (id, name, tax_id, tax_id_digits)
           values ($1, $2, $3, $4)
           on conflict (tax_id_digits) where tax_id_digits is not null do update
             set updated_at = public.policyholders.updated_at
           returning id`,
          [candidatePhId, fallbackName, row.policyholderTaxId, row.policyholderTaxIdDigits]
        );
        policyholderId = phRes.rows[0].id;
      } else {
        const existingPh = await db.query<{ id: string }>(
          `select id from public.policyholders where lower(name) = lower($1) limit 1`,
          [fallbackName]
        );
        if (existingPh.rows[0]) {
          policyholderId = existingPh.rows[0].id;
        } else {
          const phRes = await db.query<{ id: string }>(
            `insert into public.policyholders (id, name) values ($1, $2) on conflict (id) do update set updated_at = public.policyholders.updated_at returning id`,
            [candidatePhId, fallbackName]
          );
          policyholderId = phRes.rows[0].id;
        }
      }
      policyholderCache.set(phLookupKey, policyholderId);
    }

    // 3. Upsert Policy (scoped to organization_id + policy_number + endorsement)
    const policyKey = `${orgId}|${row.policyNumber}|${row.endorsement}`;
    let policyId = policyCache.get(policyKey);
    if (!policyId) {
      const candidatePolId = deterministicUuid(`pol:${policyKey}`);
      const polRes = await db.query<{ id: string }>(
        `insert into public.policies (
          id, organization_id, policyholder_id, insurer, policy_number, endorsement,
          insurance_type, branch, account_manager
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (organization_id, policy_number, endorsement) do update
          set insurer = excluded.insurer,
              insurance_type = excluded.insurance_type,
              branch = coalesce(excluded.branch, public.policies.branch),
              account_manager = coalesce(excluded.account_manager, public.policies.account_manager),
              updated_at = now()
        returning id`,
        [
          candidatePolId,
          orgId,
          policyholderId,
          row.insurer,
          row.policyNumber,
          row.endorsement,
          row.insuranceType,
          row.branch,
          row.accountManager,
        ]
      );
      policyId = polRes.rows[0].id;
      policyCache.set(policyKey, policyId);
    }

    // 4. Check if installment already exists for (policy_id, source_installment_number)
    const existingInstRes = await db.query<{
      id: string;
      amount_brl: string;
      original_due_date: string | null;
      extended_due_date: string | null;
      current_due_date: string | null;
      payment_status: string;
      source_status: string;
      confirmed_paid_brl: string;
      outstanding_balance_brl: string;
      is_customer_visible: boolean;
      data_quality_status: string;
      is_missing_from_latest: boolean;
    }>(
      `select
         id,
         amount_brl::text,
         original_due_date::text,
         extended_due_date::text,
         current_due_date::text,
         payment_status::text,
         source_status,
         confirmed_paid_brl::text,
         outstanding_balance_brl::text,
         is_customer_visible,
         data_quality_status,
         is_missing_from_latest
       from public.installments
      where policy_id = $1 and source_installment_number = $2
      limit 1`,
      [policyId, row.sourceInstallmentNumber]
    );

    const existing = existingInstRes.rows[0];
    const isHeld = row.outcome === "held";
    if (isHeld) heldRows++;

    let installmentId: string;
    let rowDbOutcome: "new" | "updated" | "unchanged" | "held";

    if (!existing) {
      // Compute initial status and balance
      const initialPaymentStatus =
        row.sourceStatus === "cancelled"
          ? "cancelled"
          : row.sourceStatus === "paid"
            ? "paid"
            : "open";
      const initialConfirmedPaid =
        row.sourceStatus === "paid" && row.amountBrl > 0 ? row.amountBrl : 0;
      const initialOutstanding =
        row.amountBrl <= 0
          ? 0
          : row.sourceStatus === "paid"
            ? 0
            : row.amountBrl;

      const isVisible = !isHeld;
      const dqStatus = isHeld ? "held" : "ok";
      const candidateInstId = deterministicUuid(
        `inst:${policyId}:${row.sourceInstallmentNumber}`
      );

      const insRes = await db.query<{ id: string }>(
        `insert into public.installments (
          id, policy_id, organization_id, installment_number, source_installment_number,
          total_installments, amount_brl, original_due_date, extended_due_date,
          current_due_date, payment_status, source_status, outstanding_balance_brl,
          confirmed_paid_brl, is_customer_visible, data_quality_status,
          paid_source, cancellation_source, cancellation_reason, cancelled_at,
          source_row_id, import_batch_id
        ) values (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11::public.payment_status, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22
        ) returning id`,
        [
          candidateInstId,
          policyId,
          orgId,
          row.installmentNumber,
          row.sourceInstallmentNumber,
          row.totalInstallments,
          row.amountBrl,
          row.originalDueDate,
          row.extendedDueDate,
          row.currentDueDate,
          initialPaymentStatus,
          row.sourceStatus,
          initialOutstanding,
          initialConfirmedPaid,
          isVisible,
          dqStatus,
          row.sourceStatus === "paid" ? "spreadsheet" : null,
          row.sourceStatus === "cancelled" ? "Insurer spreadsheet report" : null,
          row.sourceStatus === "cancelled"
            ? "Marked as Cancelled in insurer receivables report"
            : null,
          row.sourceStatus === "cancelled" ? new Date().toISOString() : null,
          row.sourceRowId,
          batchId,
        ]
      );
      installmentId = insRes.rows[0].id;
      importedRows++;
      rowDbOutcome = isHeld ? "held" : "new";

      // Activity log: Installment imported
      await db.query(
        `insert into public.activity_logs (
          actor_id, actor_label, organization_id, installment_id,
          entity_type, entity_id, action, visibility, new_values, description, import_batch_id
        ) values ($1, $2, $3, $4, 'installment', $4, 'installment_imported', 'internal', $5::jsonb, $6, $7)`,
        [
          actorId,
          actorLabel,
          orgId,
          installmentId,
          JSON.stringify({
            policyNumber: row.policyNumber,
            endorsement: row.endorsement,
            installmentNumber: row.installmentNumber,
            sourceInstallmentNumber: row.sourceInstallmentNumber,
            amountBrl: row.amountBrl,
            originalDueDate: row.originalDueDate,
            extendedDueDate: row.extendedDueDate,
            currentDueDate: row.currentDueDate,
            status: initialPaymentStatus,
          }),
          `Installment ${row.installmentNumber}/${row.totalInstallments} imported from ${parsed.fileName} (Row ${row.rowNumber}).`,
          batchId,
        ]
      );

      if (row.sourceStatus === "cancelled") {
        await db.query(
          `insert into public.activity_logs (
            actor_id, actor_label, organization_id, installment_id,
            entity_type, entity_id, action, visibility, new_values, description, import_batch_id
          ) values ($1, $2, $3, $4, 'installment', $4, 'installment_cancelled', 'customer', $5::jsonb, $6, $7)`,
          [
            actorId,
            actorLabel,
            orgId,
            installmentId,
            JSON.stringify({ status: "cancelled", snapshotDate: parsed.snapshotDate }),
            "Coverage marked as Cancelled according to the insurer's receivables report. Please contact your Meridian account manager for insurer details.",
            batchId,
          ]
        );
      }
    } else {
      installmentId = existing.id;
      const oldAmount = Number(existing.amount_brl);
      const oldOrigDue = existing.original_due_date;
      const oldExtDue = existing.extended_due_date;
      const oldCurDue = existing.current_due_date;
      const oldSourceStatus = existing.source_status;
      const oldMissing = existing.is_missing_from_latest;

      // Preserve original_due_date once set!
      const preservedOrigDue = oldOrigDue ?? row.originalDueDate;

      // Preserve extended/current due dates if an employee already approved a later date in the portal
      const nextExtDue = row.extendedDueDate ?? oldExtDue;
      const nextCurDue =
        oldExtDue && !row.extendedDueDate ? oldCurDue : row.currentDueDate ?? oldCurDue;

      const amountChanged = Math.abs(oldAmount - row.amountBrl) > 0.005;
      const extDueChanged = (oldExtDue ?? null) !== (nextExtDue ?? null);
      const curDueChanged = (oldCurDue ?? null) !== (nextCurDue ?? null);
      const statusChanged = oldSourceStatus !== row.sourceStatus;
      const reappeared = oldMissing === true;

      const hasMaterialChange =
        amountChanged || extDueChanged || curDueChanged || statusChanged || reappeared;

      // Visibility preservation: if an employee already approved a held row, don't re-hide it unless a new hold issue appeared
      const nextDqStatus =
        existing.data_quality_status === "approved"
          ? "approved"
          : isHeld
            ? "held"
            : "ok";
      const nextVisible = nextDqStatus !== "held";

      await db.query(
        `update public.installments
            set amount_brl = $2,
                original_due_date = $3,
                extended_due_date = $4,
                current_due_date = $5,
                source_status = $6,
                is_missing_from_latest = false,
                is_customer_visible = $7,
                data_quality_status = $8,
                paid_source = case when $6 = 'paid' then coalesce(paid_source, 'spreadsheet') else paid_source end,
                cancellation_source = case when $6 = 'cancelled' then coalesce(cancellation_source, 'Insurer spreadsheet report') else cancellation_source end,
                cancellation_reason = case when $6 = 'cancelled' then coalesce(cancellation_reason, 'Marked as Cancelled in insurer receivables report') else cancellation_reason end,
                cancelled_at = case when $6 = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
                source_row_id = $9,
                import_batch_id = $10,
                last_seen_at = now(),
                updated_at = now()
          where id = $1`,
        [
          installmentId,
          row.amountBrl,
          preservedOrigDue,
          nextExtDue,
          nextCurDue,
          row.sourceStatus,
          nextVisible,
          nextDqStatus,
          row.sourceRowId,
          batchId,
        ]
      );

      // Recalculate balance & payment_status taking existing confirmed payments into account
      await db.query(`select app.recalculate_installment_financials($1::uuid)`, [installmentId]);

      if (hasMaterialChange) {
        updatedRows++;
        rowDbOutcome = isHeld ? "held" : "updated";

        if (amountChanged) {
          await db.query(
            `insert into public.activity_logs (
              actor_id, actor_label, organization_id, installment_id,
              entity_type, entity_id, action, visibility, old_values, new_values, description, import_batch_id
            ) values ($1, $2, $3, $4, 'installment', $4, 'amount_changed', 'customer', $5::jsonb, $6::jsonb, $7, $8)`,
            [
              actorId,
              actorLabel,
              orgId,
              installmentId,
              JSON.stringify({ amountBrl: oldAmount }),
              JSON.stringify({ amountBrl: row.amountBrl }),
              `Installment amount updated from R$ ${oldAmount.toFixed(2)} to R$ ${row.amountBrl.toFixed(2)} in report ${parsed.snapshotDate}.`,
              batchId,
            ]
          );
        }

        if (extDueChanged || curDueChanged) {
          await db.query(
            `insert into public.activity_logs (
              actor_id, actor_label, organization_id, installment_id,
              entity_type, entity_id, action, visibility, old_values, new_values, description, import_batch_id
            ) values ($1, $2, $3, $4, 'installment', $4, 'due_date_changed', 'customer', $5::jsonb, $6::jsonb, $7, $8)`,
            [
              actorId,
              actorLabel,
              orgId,
              installmentId,
              JSON.stringify({ extendedDueDate: oldExtDue, currentDueDate: oldCurDue }),
              JSON.stringify({ extendedDueDate: nextExtDue, currentDueDate: nextCurDue }),
              `Due date updated from ${oldCurDue ?? "—"} to ${nextCurDue ?? "—"} in report ${parsed.snapshotDate}.`,
              batchId,
            ]
          );
        }

        if (statusChanged && row.sourceStatus === "paid") {
          await db.query(
            `insert into public.activity_logs (
              actor_id, actor_label, organization_id, installment_id,
              entity_type, entity_id, action, visibility, old_values, new_values, description, import_batch_id
            ) values ($1, $2, $3, $4, 'installment', $4, 'installment_marked_paid', 'customer', $5::jsonb, $6::jsonb, $7, $8)`,
            [
              actorId,
              actorLabel,
              orgId,
              installmentId,
              JSON.stringify({ status: oldSourceStatus }),
              JSON.stringify({ status: "paid" }),
              `Installment confirmed as Paid in insurer report (${parsed.snapshotDate}).`,
              batchId,
            ]
          );
        }

        if (statusChanged && row.sourceStatus === "cancelled") {
          await db.query(
            `insert into public.activity_logs (
              actor_id, actor_label, organization_id, installment_id,
              entity_type, entity_id, action, visibility, old_values, new_values, description, import_batch_id
            ) values ($1, $2, $3, $4, 'installment', $4, 'installment_cancelled', 'customer', $5::jsonb, $6::jsonb, $7, $8)`,
            [
              actorId,
              actorLabel,
              orgId,
              installmentId,
              JSON.stringify({ status: oldSourceStatus }),
              JSON.stringify({ status: "cancelled" }),
              `Coverage marked as Cancelled in insurer report (${parsed.snapshotDate}).`,
              batchId,
            ]
          );
        }
      } else {
        unchangedRows++;
        rowDbOutcome = isHeld ? "held" : "unchanged";
      }
    }

    seenInstallmentIds.add(installmentId);

    // Record import_rows entry
    const irRes = await db.query<{ id: string }>(
      `insert into public.import_rows (
        import_batch_id, row_number, record_key, outcome, issues, raw, normalized, installment_id
      ) values ($1, $2, $3, $4::public.import_row_outcome, $5::jsonb, $6::jsonb, $7::jsonb, $8)
      returning id`,
      [
        batchId,
        row.rowNumber,
        row.recordKey,
        rowDbOutcome,
        JSON.stringify(row.issues),
        JSON.stringify(row.raw),
        JSON.stringify({
          groupNameDisplay: row.groupNameDisplay,
          policyNumber: row.policyNumber,
          endorsement: row.endorsement,
          installmentNumber: row.installmentNumber,
          sourceInstallmentNumber: row.sourceInstallmentNumber,
          amountBrl: row.amountBrl,
          originalDueDate: row.originalDueDate,
          extendedDueDate: row.extendedDueDate,
          currentDueDate: row.currentDueDate,
          sourceStatus: row.sourceStatus,
        }),
        installmentId,
      ]
    );
    const importRowId = irRes.rows[0].id;

    // 5. Store Internal Notes (strictly internal, deduplicated per installment + content)
    if (row.internalNotes) {
      const existingNote = await db.query<{ id: string }>(
        `select id from public.internal_notes where installment_id = $1 and content = $2 limit 1`,
        [installmentId, row.internalNotes]
      );
      if (existingNote.rows.length === 0) {
        await db.query(
          `insert into public.internal_notes (installment_id, policy_id, source, import_batch_id, content)
           values ($1, $2, 'spreadsheet_import', $3, $4)`,
          [installmentId, policyId, batchId, row.internalNotes]
        );
      }
    }

    // 6. Store Checked By & Sent to Client On (strictly internal, deduplicated)
    if (row.checkedBy || row.sentToClientOn) {
      const existingTrack = await db.query<{ id: string }>(
        `select id from public.installment_internal_tracking
          where installment_id = $1
            and coalesce(checked_by_raw, '') = coalesce($2, '')
            and coalesce(sent_to_client_on::text, '') = coalesce($3, '')
          limit 1`,
        [installmentId, row.checkedBy, row.sentToClientOn]
      );
      if (existingTrack.rows.length === 0) {
        await db.query(
          `insert into public.installment_internal_tracking (
            installment_id, import_batch_id, checked_by_raw, sent_to_client_on
          ) values ($1, $2, $3, $4)`,
          [installmentId, batchId, row.checkedBy, row.sentToClientOn]
        );
      }
    }

    // 7. Seed historical approved extensions from spreadsheet when extended_due_date or protocol note exists
    if (row.extendedDueDate || row.extractedExtensionMeta) {
      const existingExts = await db.query<{ count: string }>(
        `select count(*)::text as count from public.extensions where installment_id = $1`,
        [installmentId]
      );
      if (Number(existingExts.rows[0]?.count ?? "0") === 0 && row.extendedDueDate) {
        const totalAttempts = row.extractedExtensionMeta?.attemptCount ?? 1;
        const protocolNo = row.extractedExtensionMeta?.protocolNumber ?? null;

        for (let attempt = 1; attempt <= totalAttempts; attempt++) {
          const isFinalApproved = attempt === totalAttempts;
          // Interpolate intermediate approved dates when 2nd or 3rd extension is noted
          const approvedDate = isFinalApproved
            ? row.extendedDueDate
            : row.originalDueDate ?? row.extendedDueDate;

          await db.query(
            `insert into public.extensions (
              installment_id, organization_id, attempt_number,
              requested_due_date, approved_due_date, previous_due_date,
              request_reason, insurer, protocol_number, status,
              requested_via, response_notes
            ) values (
              $1, $2, $3,
              $4, $5, $6,
              $7, $8, $9, 'approved',
              'employee', $10
            ) on conflict (installment_id, attempt_number) do nothing`,
            [
              installmentId,
              orgId,
              attempt,
              approvedDate,
              approvedDate,
              row.originalDueDate,
              `Historical extension #${attempt} recorded in insurer receivables report`,
              row.insurer,
              isFinalApproved ? protocolNo : `${protocolNo ?? "EXT"}-P${attempt}`,
              isFinalApproved
                ? `Approved by ${row.insurer}${protocolNo ? ` (Protocol ${protocolNo})` : ""}.`
                : `Prior extension attempt #${attempt} approved by ${row.insurer}.`,
            ]
          );
        }
      }
    }

    // 8. Record Data Quality Issues (deduplicated per installment + issue.code)
    for (const issue of row.issues) {
      if (issue.code === "installment_zero_normalized" || issue.code === "negative_credit_amount") {
        continue; // Informational normalizations, no action needed in DQ queue
      }
      await insertDqIssueIfNew(db, {
        installmentId,
        batchId,
        importRowId,
        organizationId: orgId,
        rowNumber: row.rowNumber,
        issue,
        raw: row.raw,
      });
    }
  }

  // 9. Detect installments that DISAPPEARED from this new upload
  //    Only run if this snapshot date is >= the latest existing snapshot date
  let missingRows = 0;
  let missingOverdueRows = 0;

  if (detectMissing && seenInstallmentIds.size > 0) {
    const allExistingRes = await db.query<{
      id: string;
      organization_id: string;
      policy_id: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      outstanding_balance_brl: string;
      current_due_date: string | null;
      payment_status: string;
      is_missing_from_latest: boolean;
    }>(
      `select
         id, organization_id, policy_id, installment_number, total_installments,
         amount_brl::text, outstanding_balance_brl::text, current_due_date::text,
         payment_status::text, is_missing_from_latest
       from public.installments`
    );

    for (const inst of allExistingRes.rows) {
      if (seenInstallmentIds.has(inst.id)) continue;
      if (inst.payment_status === "paid" || inst.payment_status === "cancelled") continue;

      missingRows++;
      const outBrl = Number(inst.outstanding_balance_brl);
      const daysOverdue = computeDaysOverdue(
        inst.current_due_date,
        parsed.snapshotDate,
        inst.payment_status,
        outBrl
      );
      const isOverdue = daysOverdue > 0 && outBrl > 0;

      if (isOverdue) {
        missingOverdueRows++;
      }

      if (!inst.is_missing_from_latest) {
        await db.query(
          `update public.installments
              set is_missing_from_latest = true,
                  is_customer_visible = false,
                  missing_since = coalesce(missing_since, $2::date),
                  payment_status = case
                    when payment_status = 'open' then 'missing_from_latest_report'::public.payment_status
                    else payment_status
                  end,
                  updated_at = now()
            where id = $1`,
          [inst.id, parsed.snapshotDate]
        );

        await db.query(
          `insert into public.activity_logs (
            actor_id, actor_label, organization_id, installment_id,
            entity_type, entity_id, action, visibility, old_values, new_values, description, import_batch_id
          ) values ($1, $2, $3, $4, 'installment', $4, 'installment_missing_from_report', 'internal', $5::jsonb, $6::jsonb, $7, $8)`,
          [
            actorId,
            actorLabel,
            inst.organization_id,
            inst.id,
            JSON.stringify({ paymentStatus: inst.payment_status }),
            JSON.stringify({
              paymentStatus: "missing_from_latest_report",
              snapshotDate: parsed.snapshotDate,
              wasOverdue: isOverdue,
              daysOverdue,
            }),
            isOverdue
              ? `HIGH PRIORITY: Overdue installment (${daysOverdue}d overdue, R$ ${outBrl.toFixed(2)}) disappeared from ${parsed.fileName} without Paid or Cancelled status.`
              : `Upcoming installment disappeared from ${parsed.fileName}.`,
            batchId,
          ]
        );

        await insertDqIssueIfNew(db, {
          installmentId: inst.id,
          batchId,
          importRowId: null,
          organizationId: inst.organization_id,
          rowNumber: null,
          issue: {
            code: "missing_overdue_from_report" as never,
            severity: isOverdue ? "high" : "info",
            holdsVisibility: false,
            title: isOverdue
              ? `Overdue installment missing from latest report (${daysOverdue} days overdue)`
              : "Upcoming installment missing from latest report",
            description: isOverdue
              ? `Installment ${inst.installment_number}/${inst.total_installments} (R$ ${outBrl.toFixed(2)}, due ${inst.current_due_date}) was overdue and disappeared from ${parsed.fileName}. Do not assume Paid or Cancelled — investigate with insurer.`
              : `Upcoming installment ${inst.installment_number}/${inst.total_installments} (due ${inst.current_due_date}) was not present in ${parsed.fileName}.`,
          },
          raw: { snapshotDate: parsed.snapshotDate, previousStatus: inst.payment_status },
        });
      }
    }
  }

  // 10. Create / update installment_snapshots for all installments as of parsed.snapshotDate
  //     Executed as set-based SQL for instant performance on 1,450+ rows.
  await db.query(
    `delete from public.installment_snapshots
      where snapshot_date = $1::date and import_batch_id <> $2`,
    [parsed.snapshotDate, batchId]
  );

  await db.query(
    `insert into public.installment_snapshots (
       installment_id, snapshot_date, organization_id, amount_brl,
       outstanding_balance_brl, payment_status, original_due_date,
       extended_due_date, current_due_date, days_overdue, aging_bucket,
       had_approved_extension, is_missing_from_report, import_batch_id
     )
     select
       i.id,
       $1::date,
       i.organization_id,
       i.amount_brl,
       i.outstanding_balance_brl,
       i.payment_status,
       i.original_due_date,
       i.extended_due_date,
       i.current_due_date,
       case
         when i.payment_status in ('paid', 'cancelled') or i.outstanding_balance_brl <= 0 or i.current_due_date is null then 0
         else greatest(0, ($1::date - i.current_due_date))
       end as days_overdue,
       app.aging_bucket(
         case
           when i.payment_status in ('paid', 'cancelled') or i.outstanding_balance_brl <= 0 or i.current_due_date is null then 0
           else greatest(0, ($1::date - i.current_due_date))
         end
       ) as aging_bucket,
       coalesce(i.extended_due_date > i.original_due_date, false) as had_approved_extension,
       i.is_missing_from_latest,
       $2::uuid
     from public.installments i
     on conflict (import_batch_id, installment_id) do update
       set amount_brl = excluded.amount_brl,
           outstanding_balance_brl = excluded.outstanding_balance_brl,
           payment_status = excluded.payment_status,
           current_due_date = excluded.current_due_date,
           days_overdue = excluded.days_overdue,
           aging_bucket = excluded.aging_bucket,
           had_approved_extension = excluded.had_approved_extension,
           is_missing_from_report = excluded.is_missing_from_report`,
    [parsed.snapshotDate, batchId]
  );

  // 11. Finalize import_batches row
  await db.query(
    `update public.import_batches
        set imported_rows = $2,
            updated_rows = $3,
            unchanged_rows = $4,
            held_rows = $5,
            rejected_rows = $6,
            duplicate_rows = $7,
            ignored_rows = $8,
            missing_rows = $9,
            missing_overdue_rows = $10,
            warning_count = $11,
            status = 'completed',
            summary = $12::jsonb,
            completed_at = now()
      where id = $1`,
    [
      batchId,
      importedRows,
      updatedRows,
      unchangedRows,
      heldRows,
      rejectedRows,
      duplicateRows,
      ignoredRows,
      missingRows,
      missingOverdueRows,
      warningCount,
      JSON.stringify(parsed.summary),
    ]
  );

  return {
    batchId,
    fileName: parsed.fileName,
    snapshotDate: parsed.snapshotDate,
    totalRows: parsed.dataRowCount,
    importedRows,
    updatedRows,
    unchangedRows,
    heldRows,
    rejectedRows,
    duplicateRows,
    ignoredRows,
    missingRows,
    missingOverdueRows,
    warningCount,
    isIdempotentReimport: Boolean(existingIdenticalBatchId && importedRows === 0),
  };
}

async function insertDqIssueIfNew(
  db: SqlExecutor,
  params: {
    installmentId: string | null;
    batchId: string;
    importRowId: string | null;
    organizationId: string | null;
    rowNumber: number | null;
    issue: {
      code: string;
      severity: "info" | "warning" | "high";
      holdsVisibility: boolean;
      title: string;
      description: string;
      details?: Record<string, unknown>;
    };
    raw: Record<string, unknown>;
  }
) {
  if (params.installmentId) {
    // Row-level spreadsheet issues (swapped dates, missing policyholder, conflicting
    // duplicates, etc.) re-appear in every weekly report. Once staff resolved or
    // dismissed one, do NOT re-open it on the next import. "Missing from report"
    // issues can legitimately recur, so those only dedupe against open issues.
    const recurringCode = params.issue.code === "missing_overdue_from_report";
    const existing = await db.query<{ id: string }>(
      recurringCode
        ? `select id from public.data_quality_issues
            where installment_id = $1 and issue_code = $2 and status = 'open'
            limit 1`
        : `select id from public.data_quality_issues
            where installment_id = $1 and issue_code = $2
            limit 1`,
      [params.installmentId, params.issue.code]
    );
    if (existing.rows.length > 0) return;
  }

  await db.query(
    `insert into public.data_quality_issues (
      installment_id, import_batch_id, import_row_id, organization_id,
      row_number, issue_code, severity, status, holds_visibility,
      title, description, original_values
    ) values (
      $1, $2, $3, $4,
      $5, $6, $7::public.dq_severity, 'open', $8,
      $9, $10, $11::jsonb
    )`,
    [
      params.installmentId,
      params.batchId,
      params.importRowId,
      params.organizationId,
      params.rowNumber,
      params.issue.code,
      params.issue.severity,
      params.issue.holdsVisibility,
      params.issue.title,
      params.issue.description,
      JSON.stringify({
        raw: params.raw,
        details: params.issue.details ?? null,
      }),
    ]
  );
}

export { parseReceivablesWorkbook };
