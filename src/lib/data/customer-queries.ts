import "server-only";
import { withRlsSession } from "../db/engine";
import { DEFAULT_REFERENCE_DATE, diffDaysFromReference } from "../format";
import { SessionUser } from "../auth/session";

export interface CustomerInstallmentRow {
  id: string;
  policyId: string;
  organizationId: string;
  organizationName: string;
  policyholderId: string;
  policyholderName: string;
  policyholderTaxId: string | null;
  insurer: string;
  policyNumber: string;
  endorsement: string;
  insuranceType: string;
  branch: string | null;
  accountManager: string | null;
  installmentNumber: number;
  sourceInstallmentNumber: number;
  totalInstallments: number;
  amountBrl: number;
  outstandingBalanceBrl: number;
  confirmedPaidBrl: number;
  isCredit: boolean;
  originalDueDate: string | null;
  extendedDueDate: string | null;
  currentDueDate: string | null;
  paymentStatus: string;
  daysFromToday: number | null; // negative = overdue, 0..30 = due soon
  isOverdue: boolean;
  isDueInNext30Days: boolean;
  extensionAttempts: number;
  approvedExtensions: number;
  hasPendingExtension: boolean;
  hasOpenDispute: boolean;
}

export interface CustomerDashboardData {
  referenceDate: string;
  organizationName: string;
  kpis: {
    overdueCount: number;
    overdueAmountBrl: number;
    dueNext30Count: number;
    dueNext30AmountBrl: number;
    totalOutstandingBrl: number;
    creditsCount: number;
    creditsAmountBrl: number;
    paymentsUnderReviewCount: number;
    paymentsUnderReviewBrl: number;
    pendingExtensionsCount: number;
    pendingDisputesCount: number;
  };
  overdueInstallments: CustomerInstallmentRow[];
  dueSoonInstallments: CustomerInstallmentRow[];
  creditInstallments: CustomerInstallmentRow[];
  paymentsAwaitingConfirmation: {
    id: string;
    installmentId: string;
    policyNumber: string;
    policyholderName: string;
    insurer: string;
    installmentNumber: number;
    totalInstallments: number;
    amountBrl: number;
    paymentDate: string;
    verificationStatus: string;
    createdAt: string;
  }[];
  upcomingReminders: {
    installmentId: string;
    policyNumber: string;
    policyholderName: string;
    insurer: string;
    installmentNumber: number;
    totalInstallments: number;
    currentDueDate: string;
    daysUntilDue: number;
    outstandingBalanceBrl: number;
    reminderScheduledDate: string;
  }[];
  recentActivity: {
    id: string;
    installmentId: string | null;
    action: string;
    description: string;
    createdAt: string;
  }[];
}

/**
 * Fetches all customer-visible installments for the authenticated customer's organization.
 * Strictly uses `public.customer_installments` under PostgreSQL RLS (`withRlsSession`).
 */
export async function getCustomerInstallments(
  user: SessionUser,
  referenceDate: string = DEFAULT_REFERENCE_DATE
): Promise<CustomerInstallmentRow[]> {
  return withRlsSession(user.id, async (tx) => {
    const res = await tx.query<{
      id: string;
      policy_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_id: string;
      policyholder_name: string;
      policyholder_tax_id: string | null;
      insurer: string;
      policy_number: string;
      endorsement: string;
      insurance_type: string;
      branch: string | null;
      account_manager: string | null;
      installment_number: number;
      source_installment_number: number;
      total_installments: number;
      amount_brl: string;
      outstanding_balance_brl: string;
      confirmed_paid_brl: string;
      is_credit: boolean;
      original_due_date: string | null;
      extended_due_date: string | null;
      current_due_date: string | null;
      payment_status: string;
      extension_attempts: string;
      approved_extensions: string;
      pending_extensions: string;
      open_disputes: string;
    }>(`
      select
        ci.id,
        ci.policy_id,
        ci.organization_id,
        ci.organization_name,
        ci.policyholder_id,
        ci.policyholder_name,
        ci.policyholder_tax_id,
        ci.insurer,
        ci.policy_number,
        ci.endorsement,
        ci.insurance_type,
        ci.branch,
        ci.account_manager,
        ci.installment_number,
        ci.source_installment_number,
        ci.total_installments,
        ci.amount_brl::text,
        ci.outstanding_balance_brl::text,
        ci.confirmed_paid_brl::text,
        ci.is_credit,
        ci.original_due_date::text,
        ci.extended_due_date::text,
        ci.current_due_date::text,
        ci.payment_status::text,
        coalesce(ext.total_attempts, 0)::text as extension_attempts,
        coalesce(ext.approved_count, 0)::text as approved_extensions,
        coalesce(ext.pending_count, 0)::text as pending_extensions,
        coalesce(disp.open_count, 0)::text as open_disputes
      from public.customer_installments ci
      left join lateral (
        select
          count(*) as total_attempts,
          count(*) filter (where e.status = 'approved') as approved_count,
          count(*) filter (where e.status in ('requested', 'submitted_to_insurer', 'awaiting_response')) as pending_count
        from public.extensions e
        where e.installment_id = ci.id
      ) ext on true
      left join lateral (
        select count(*) as open_count
        from public.exceptions ex
        where ex.installment_id = ci.id
          and ex.type = 'amount_dispute'
          and ex.status not in ('resolved', 'rejected')
      ) disp on true
      order by ci.current_due_date asc nulls last, ci.policy_number asc, ci.installment_number asc
    `);

    return res.rows.map((r) => {
      const amountBrl = Number(r.amount_brl);
      const outstandingBalanceBrl = Number(r.outstanding_balance_brl);
      const confirmedPaidBrl = Number(r.confirmed_paid_brl);
      const daysFromToday = diffDaysFromReference(r.current_due_date, referenceDate);
      const isSettledOrCancelled =
        r.payment_status === "paid" || r.payment_status === "cancelled";

      const isOverdue =
        !r.is_credit &&
        !isSettledOrCancelled &&
        outstandingBalanceBrl > 0 &&
        daysFromToday !== null &&
        daysFromToday < 0;

      const isDueInNext30Days =
        !r.is_credit &&
        !isSettledOrCancelled &&
        outstandingBalanceBrl > 0 &&
        daysFromToday !== null &&
        daysFromToday >= 0 &&
        daysFromToday <= 30;

      return {
        id: r.id,
        policyId: r.policy_id,
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        policyholderId: r.policyholder_id,
        policyholderName: r.policyholder_name,
        policyholderTaxId: r.policyholder_tax_id,
        insurer: r.insurer,
        policyNumber: r.policy_number,
        endorsement: r.endorsement,
        insuranceType: r.insurance_type,
        branch: r.branch,
        accountManager: r.account_manager,
        installmentNumber: r.installment_number,
        sourceInstallmentNumber: r.source_installment_number,
        totalInstallments: r.total_installments,
        amountBrl,
        outstandingBalanceBrl,
        confirmedPaidBrl,
        isCredit: r.is_credit,
        originalDueDate: r.original_due_date,
        extendedDueDate: r.extended_due_date,
        currentDueDate: r.current_due_date,
        paymentStatus: r.payment_status,
        daysFromToday,
        isOverdue,
        isDueInNext30Days,
        extensionAttempts: Number(r.extension_attempts),
        approvedExtensions: Number(r.approved_extensions),
        hasPendingExtension: Number(r.pending_extensions) > 0,
        hasOpenDispute: Number(r.open_disputes) > 0,
      };
    });
  });
}

/**
 * Builds the complete Customer Dashboard payload (Section 8A).
 */
export async function getCustomerDashboardData(
  user: SessionUser,
  referenceDate: string = DEFAULT_REFERENCE_DATE
): Promise<CustomerDashboardData> {
  const installments = await getCustomerInstallments(user, referenceDate);

  const overdueInstallments = installments
    .filter((i) => i.isOverdue)
    .sort((a, b) => (a.daysFromToday ?? 0) - (b.daysFromToday ?? 0));

  const dueSoonInstallments = installments
    .filter((i) => i.isDueInNext30Days)
    .sort((a, b) => (a.daysFromToday ?? 0) - (b.daysFromToday ?? 0));

  const creditInstallments = installments.filter((i) => i.isCredit);

  const overdueAmountBrl = overdueInstallments.reduce(
    (sum, i) => sum + i.outstandingBalanceBrl,
    0
  );
  const dueNext30AmountBrl = dueSoonInstallments.reduce(
    (sum, i) => sum + i.outstandingBalanceBrl,
    0
  );
  const totalOutstandingBrl = installments
    .filter((i) => !i.isCredit && i.paymentStatus !== "paid" && i.paymentStatus !== "cancelled")
    .reduce((sum, i) => sum + i.outstandingBalanceBrl, 0);

  const creditsAmountBrl = creditInstallments.reduce(
    (sum, i) => sum + Math.abs(i.amountBrl),
    0
  );

  // Upcoming reminders preview (due within next 14 days, positive balance)
  const upcomingReminders = dueSoonInstallments
    .filter((i) => (i.daysFromToday ?? 99) <= 14)
    .slice(0, 8)
    .map((i) => {
      const dueMs = Date.parse(`${i.currentDueDate}T00:00:00Z`);
      const schedDate = new Date(dueMs - 3 * 86400 * 1000).toISOString().slice(0, 10);
      return {
        installmentId: i.id,
        policyNumber: i.policyNumber,
        policyholderName: i.policyholderName,
        insurer: i.insurer,
        installmentNumber: i.installmentNumber,
        totalInstallments: i.totalInstallments,
        currentDueDate: i.currentDueDate ?? "",
        daysUntilDue: i.daysFromToday ?? 0,
        outstandingBalanceBrl: i.outstandingBalanceBrl,
        reminderScheduledDate: schedDate,
      };
    });

  const extra = await withRlsSession(user.id, async (tx) => {
    const paymentsRes = await tx.query<{
      id: string;
      installment_id: string;
      policy_number: string;
      policyholder_name: string;
      insurer: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      payment_date: string;
      verification_status: string;
      created_at: string;
    }>(`
      select
        cp.id,
        cp.installment_id,
        ci.policy_number,
        ci.policyholder_name,
        ci.insurer,
        ci.installment_number,
        ci.total_installments,
        cp.amount_brl::text,
        cp.payment_date::text,
        cp.verification_status::text,
        cp.created_at::text
      from public.customer_payments cp
      join public.customer_installments ci on ci.id = cp.installment_id
      where cp.verification_status in ('submitted', 'under_review')
      order by cp.created_at desc
    `);

    const countsRes = await tx.query<{
      pending_extensions: string;
      pending_disputes: string;
    }>(`
      select
        (select count(*)::text from public.extensions e where e.status in ('requested', 'submitted_to_insurer', 'awaiting_response')) as pending_extensions,
        (select count(*)::text from public.exceptions ex where ex.type = 'amount_dispute' and ex.status not in ('resolved', 'rejected')) as pending_disputes
    `);

    const activityRes = await tx.query<{
      id: string;
      installment_id: string | null;
      action: string;
      description: string;
      created_at: string;
    }>(`
      select
        id,
        installment_id,
        action,
        description,
        created_at::text
      from public.activity_logs
      where visibility = 'customer'
      order by created_at desc
      limit 12
    `);

    return {
      payments: paymentsRes.rows,
      counts: countsRes.rows[0],
      activity: activityRes.rows,
    };
  });

  const paymentsAwaitingConfirmation = extra.payments.map((p) => ({
    id: p.id,
    installmentId: p.installment_id,
    policyNumber: p.policy_number,
    policyholderName: p.policyholder_name,
    insurer: p.insurer,
    installmentNumber: p.installment_number,
    totalInstallments: p.total_installments,
    amountBrl: Number(p.amount_brl),
    paymentDate: p.payment_date,
    verificationStatus: p.verification_status,
    createdAt: p.created_at,
  }));

  const paymentsUnderReviewBrl = paymentsAwaitingConfirmation.reduce(
    (s, p) => s + p.amountBrl,
    0
  );

  return {
    referenceDate,
    organizationName: user.organizationName ?? "Customer Group",
    kpis: {
      overdueCount: overdueInstallments.length,
      overdueAmountBrl,
      dueNext30Count: dueSoonInstallments.length,
      dueNext30AmountBrl,
      totalOutstandingBrl,
      creditsCount: creditInstallments.length,
      creditsAmountBrl,
      paymentsUnderReviewCount: paymentsAwaitingConfirmation.length,
      paymentsUnderReviewBrl,
      pendingExtensionsCount: Number(extra.counts?.pending_extensions ?? "0"),
      pendingDisputesCount: Number(extra.counts?.pending_disputes ?? "0"),
    },
    overdueInstallments,
    dueSoonInstallments,
    creditInstallments,
    paymentsAwaitingConfirmation,
    upcomingReminders,
    recentActivity: extra.activity.map((a) => ({
      id: a.id,
      installmentId: a.installment_id,
      action: a.action,
      description: a.description,
      createdAt: a.created_at,
    })),
  };
}

/**
 * Fetches complete customer-safe detail for a single installment (Section 8C).
 * Never exposes internal_notes, checked_by, sent_to_client_on, or internal verification columns.
 */
export async function getCustomerInstallmentDetail(
  user: SessionUser,
  installmentId: string,
  referenceDate: string = DEFAULT_REFERENCE_DATE
) {
  return withRlsSession(user.id, async (tx) => {
    const instRes = await tx.query<{
      id: string;
      policy_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_id: string;
      policyholder_name: string;
      policyholder_tax_id: string | null;
      insurer: string;
      policy_number: string;
      endorsement: string;
      insurance_type: string;
      branch: string | null;
      account_manager: string | null;
      installment_number: number;
      source_installment_number: number;
      total_installments: number;
      amount_brl: string;
      outstanding_balance_brl: string;
      confirmed_paid_brl: string;
      is_credit: boolean;
      original_due_date: string | null;
      extended_due_date: string | null;
      current_due_date: string | null;
      payment_status: string;
    }>(
      `select * from public.customer_installments where id = $1 limit 1`,
      [installmentId]
    );

    const row = instRes.rows[0];
    if (!row) return null;

    const paymentsRes = await tx.query<{
      id: string;
      amount_brl: string;
      payment_date: string;
      receipt_document_id: string | null;
      verification_status: string;
      confirmed_amount_brl: string | null;
      insurer_confirmation_date: string | null;
      customer_comment: string | null;
      created_at: string;
    }>(
      `select
         id, amount_brl::text, payment_date::text, receipt_document_id,
         verification_status::text, confirmed_amount_brl::text,
         insurer_confirmation_date::text, customer_comment, created_at::text
       from public.customer_payments
      where installment_id = $1
      order by created_at desc`,
      [installmentId]
    );

    const extensionsRes = await tx.query<{
      id: string;
      attempt_number: number;
      requested_due_date: string;
      approved_due_date: string | null;
      previous_due_date: string | null;
      request_reason: string | null;
      insurer: string;
      protocol_number: string | null;
      status: string;
      requested_at: string;
      submitted_to_insurer_at: string | null;
      insurer_response_at: string | null;
      response_notes: string | null;
    }>(
      `select
         id, attempt_number, requested_due_date::text, approved_due_date::text,
         previous_due_date::text, request_reason, insurer, protocol_number,
         status::text, requested_at::text, submitted_to_insurer_at::text,
         insurer_response_at::text, response_notes
       from public.extensions
      where installment_id = $1
      order by attempt_number asc`,
      [installmentId]
    );

    const exceptionsRes = await tx.query<{
      id: string;
      type: string;
      status: string;
      description: string | null;
      requested_amount: string | null;
      endorsement_reference: string | null;
      insurer_breakdown_received_on: string | null;
      customer_response: string | null;
      resolution: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select
         id, type::text, status::text, description, requested_amount::text,
         endorsement_reference, insurer_breakdown_received_on::text,
         customer_response, resolution, created_at::text, updated_at::text
       from public.exceptions
      where installment_id = $1
      order by created_at desc`,
      [installmentId]
    );

    const documentsRes = await tx.query<{
      id: string;
      exception_id: string | null;
      file_name: string;
      mime_type: string;
      size_bytes: string | null;
      document_type: string;
      created_at: string;
    }>(
      `select
         id, exception_id, file_name, mime_type, size_bytes::text,
         document_type, created_at::text
       from public.documents
      where installment_id = $1 and visibility = 'customer'
      order by created_at desc`,
      [installmentId]
    );

    const activityRes = await tx.query<{
      id: string;
      action: string;
      actor_label: string | null;
      description: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
      created_at: string;
    }>(
      `select
         id, action, actor_label, description, old_values, new_values, created_at::text
       from public.activity_logs
      where installment_id = $1 and visibility = 'customer'
      order by created_at desc`,
      [installmentId]
    );

    const daysFromToday = diffDaysFromReference(row.current_due_date, referenceDate);

    return {
      installment: {
        id: row.id,
        policyId: row.policy_id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        policyholderName: row.policyholder_name,
        policyholderTaxId: row.policyholder_tax_id,
        insurer: row.insurer,
        policyNumber: row.policy_number,
        endorsement: row.endorsement,
        insuranceType: row.insurance_type,
        branch: row.branch,
        accountManager: row.account_manager,
        installmentNumber: row.installment_number,
        sourceInstallmentNumber: row.source_installment_number,
        totalInstallments: row.total_installments,
        amountBrl: Number(row.amount_brl),
        outstandingBalanceBrl: Number(row.outstanding_balance_brl),
        confirmedPaidBrl: Number(row.confirmed_paid_brl),
        isCredit: row.is_credit,
        originalDueDate: row.original_due_date,
        extendedDueDate: row.extended_due_date,
        currentDueDate: row.current_due_date,
        paymentStatus: row.payment_status,
        daysFromToday,
      },
      payments: paymentsRes.rows.map((p) => ({
        id: p.id,
        amountBrl: Number(p.amount_brl),
        paymentDate: p.payment_date,
        receiptDocumentId: p.receipt_document_id,
        verificationStatus: p.verification_status,
        confirmedAmountBrl: p.confirmed_amount_brl ? Number(p.confirmed_amount_brl) : null,
        insurerConfirmationDate: p.insurer_confirmation_date,
        customerComment: p.customer_comment,
        createdAt: p.created_at,
      })),
      extensions: extensionsRes.rows.map((e) => ({
        id: e.id,
        attemptNumber: e.attempt_number,
        requestedDueDate: e.requested_due_date,
        approvedDueDate: e.approved_due_date,
        previousDueDate: e.previous_due_date,
        requestReason: e.request_reason,
        insurer: e.insurer,
        protocolNumber: e.protocol_number,
        status: e.status,
        requestedAt: e.requested_at,
        submittedToInsurerAt: e.submitted_to_insurer_at,
        insurerResponseAt: e.insurer_response_at,
        responseNotes: e.response_notes,
      })),
      exceptions: exceptionsRes.rows.map((ex) => ({
        id: ex.id,
        type: ex.type,
        status: ex.status,
        description: ex.description,
        requestedAmount: ex.requested_amount ? Number(ex.requested_amount) : null,
        endorsementReference: ex.endorsement_reference,
        insurerBreakdownReceivedOn: ex.insurer_breakdown_received_on,
        customerResponse: ex.customer_response,
        resolution: ex.resolution,
        createdAt: ex.created_at,
        updatedAt: ex.updated_at,
      })),
      documents: documentsRes.rows.map((d) => ({
        id: d.id,
        exceptionId: d.exception_id,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes ? Number(d.size_bytes) : null,
        documentType: d.document_type,
        createdAt: d.created_at,
      })),
      timeline: activityRes.rows.map((a) => ({
        id: a.id,
        action: a.action,
        actorLabel: a.actor_label,
        description: a.description,
        oldValues: a.old_values,
        newValues: a.new_values,
        createdAt: a.created_at,
      })),
    };
  });
}

/**
 * Fetches all customer requests (receipts, extension requests, amount disputes)
 * and customer-visible documents for `/requests` and `/documents`.
 */
export async function getCustomerRequestsAndDocuments(user: SessionUser) {
  return withRlsSession(user.id, async (tx) => {
    const reqRes = await tx.query<{
      id: string;
      installment_id: string;
      type: string;
      status: string;
      description: string | null;
      requested_amount: string | null;
      endorsement_reference: string | null;
      insurer_breakdown_received_on: string | null;
      customer_response: string | null;
      resolution: string | null;
      created_at: string;
      updated_at: string;
      policy_number: string;
      policyholder_name: string;
      insurer: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      current_due_date: string | null;
    }>(`
      select
        ex.id,
        ex.installment_id,
        ex.type::text,
        ex.status::text,
        ex.description,
        ex.requested_amount::text,
        ex.endorsement_reference,
        ex.insurer_breakdown_received_on::text,
        ex.customer_response,
        ex.resolution,
        ex.created_at::text,
        ex.updated_at::text,
        ci.policy_number,
        ci.policyholder_name,
        ci.insurer,
        ci.installment_number,
        ci.total_installments,
        ci.amount_brl::text,
        ci.current_due_date::text
      from public.exceptions ex
      join public.customer_installments ci on ci.id = ex.installment_id
      order by ex.created_at desc
    `);

    const extRes = await tx.query<{
      id: string;
      installment_id: string;
      attempt_number: number;
      requested_due_date: string;
      approved_due_date: string | null;
      previous_due_date: string | null;
      request_reason: string | null;
      insurer: string;
      protocol_number: string | null;
      status: string;
      requested_at: string;
      response_notes: string | null;
      policy_number: string;
      policyholder_name: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      current_due_date: string | null;
    }>(`
      select
        e.id,
        e.installment_id,
        e.attempt_number,
        e.requested_due_date::text,
        e.approved_due_date::text,
        e.previous_due_date::text,
        e.request_reason,
        e.insurer,
        e.protocol_number,
        e.status::text,
        e.requested_at::text,
        e.response_notes,
        ci.policy_number,
        ci.policyholder_name,
        ci.installment_number,
        ci.total_installments,
        ci.amount_brl::text,
        ci.current_due_date::text
      from public.extensions e
      join public.customer_installments ci on ci.id = e.installment_id
      order by e.requested_at desc
    `);

    const docRes = await tx.query<{
      id: string;
      installment_id: string | null;
      exception_id: string | null;
      file_name: string;
      mime_type: string;
      size_bytes: string | null;
      document_type: string;
      created_at: string;
      policy_number: string | null;
      policyholder_name: string | null;
      insurer: string | null;
      installment_number: number | null;
      total_installments: number | null;
    }>(`
      select
        d.id,
        d.installment_id,
        d.exception_id,
        d.file_name,
        d.mime_type,
        d.size_bytes::text,
        d.document_type,
        d.created_at::text,
        ci.policy_number,
        ci.policyholder_name,
        ci.insurer,
        ci.installment_number,
        ci.total_installments
      from public.documents d
      left join public.customer_installments ci on ci.id = d.installment_id
      where d.visibility = 'customer'
      order by d.created_at desc
    `);

    return {
      exceptions: reqRes.rows.map((r) => ({
        id: r.id,
        installmentId: r.installment_id,
        type: r.type,
        status: r.status,
        description: r.description,
        requestedAmount: r.requested_amount ? Number(r.requested_amount) : null,
        endorsementReference: r.endorsement_reference,
        insurerBreakdownReceivedOn: r.insurer_breakdown_received_on,
        customerResponse: r.customer_response,
        resolution: r.resolution,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        policyNumber: r.policy_number,
        policyholderName: r.policyholder_name,
        insurer: r.insurer,
        installmentNumber: r.installment_number,
        totalInstallments: r.total_installments,
        amountBrl: Number(r.amount_brl),
        currentDueDate: r.current_due_date,
      })),
      extensions: extRes.rows.map((e) => ({
        id: e.id,
        installmentId: e.installment_id,
        attemptNumber: e.attempt_number,
        requestedDueDate: e.requested_due_date,
        approvedDueDate: e.approved_due_date,
        previousDueDate: e.previous_due_date,
        requestReason: e.request_reason,
        insurer: e.insurer,
        protocolNumber: e.protocol_number,
        status: e.status,
        requestedAt: e.requested_at,
        responseNotes: e.response_notes,
        policyNumber: e.policy_number,
        policyholderName: e.policyholder_name,
        installmentNumber: e.installment_number,
        totalInstallments: e.total_installments,
        amountBrl: Number(e.amount_brl),
        currentDueDate: e.current_due_date,
      })),
      documents: docRes.rows.map((d) => ({
        id: d.id,
        installmentId: d.installment_id,
        exceptionId: d.exception_id,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes ? Number(d.size_bytes) : null,
        documentType: d.document_type,
        createdAt: d.created_at,
        policyNumber: d.policy_number,
        policyholderName: d.policyholder_name,
        insurer: d.insurer,
        installmentNumber: d.installment_number,
        totalInstallments: d.total_installments,
      })),
    };
  });
}
