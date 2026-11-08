import "server-only";
import { getServiceDb, withRlsSession } from "../db/engine";
import { DEFAULT_REFERENCE_DATE, diffDaysFromReference } from "../format";
import { SessionUser } from "../auth/session";

export type RiskLevel = "critical" | "high" | "medium" | "low" | "none";
export type LinePriorityCategory = "judicial_guarantee" | "other_surety" | "other_lines";

export interface InternalReceivableRow {
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
  sourceStatus: string;
  isCustomerVisible: boolean;
  dataQualityStatus: string;
  isMissingFromLatest: boolean;
  daysOverdue: number;
  daysFromToday: number | null;
  agingBucket: "current" | "1-30" | "31-60" | "61-89" | "90+";
  extensionAttempts: number;
  approvedExtensions: number;
  hasPendingReceipt: boolean;
  hasPendingExtension: boolean;
  hasOpenDispute: boolean;
  riskLevel: RiskLevel;
  linePriority: LinePriorityCategory;
  recommendedFollowUp: string;
  latestInternalNote: string | null;
  latestCheckedBy: string | null;
  latestSentToClientOn: string | null;
}

export function classifyLinePriority(insuranceType: string): LinePriorityCategory {
  const lower = insuranceType.toLowerCase();
  if (lower.includes("judicial")) return "judicial_guarantee";
  if (lower.includes("surety")) return "other_surety";
  return "other_lines";
}

export function computeHeuristicRisk(params: {
  insuranceType: string;
  paymentStatus: string;
  amountBrl: number;
  outstandingBrl: number;
  daysOverdue: number;
  hasPendingReceipt: boolean;
  isMissingFromLatest: boolean;
}): {
  level: RiskLevel;
  linePriority: LinePriorityCategory;
  recommendedFollowUp: string;
} {
  const linePriority = classifyLinePriority(params.insuranceType);

  if (
    params.paymentStatus === "paid" ||
    params.paymentStatus === "cancelled" ||
    params.amountBrl <= 0 ||
    params.outstandingBrl <= 0 ||
    params.daysOverdue <= 0
  ) {
    return {
      level: "none",
      linePriority,
      recommendedFollowUp:
        params.paymentStatus === "cancelled"
          ? "Policy coverage marked Cancelled by insurer — verify legal/commercial impact with client."
          : "Current / no overdue cancellation exposure.",
    };
  }

  let level: RiskLevel;
  if (linePriority === "judicial_guarantee") {
    level = params.daysOverdue >= 30 ? "critical" : "high";
  } else if (linePriority === "other_surety") {
    level = params.daysOverdue >= 45 ? "critical" : "high";
  } else if (params.daysOverdue >= 60) {
    level = "critical";
  } else if (params.daysOverdue >= 45) {
    level = "high";
  } else if (params.daysOverdue >= 15) {
    level = "medium";
  } else {
    level = "low";
  }

  if (params.isMissingFromLatest && level !== "critical") {
    level = "high";
  }

  let recommendedFollowUp: string;
  if (linePriority === "judicial_guarantee" && level === "critical") {
    recommendedFollowUp =
      "URGENT: Judicial guarantee 30+ days overdue — cancellation can compromise an active court proceeding. Escalate to insurer & legal counsel immediately.";
  } else if (linePriority === "judicial_guarantee") {
    recommendedFollowUp =
      "High Priority: Judicial guarantee overdue — contact client treasury and verify insurer grace window before court notification.";
  } else if (linePriority === "other_surety") {
    recommendedFollowUp =
      "Surety bond overdue — confirm obligee exposure, verify payment slip validity, and request insurer hold if payment is in transit.";
  } else if (params.hasPendingReceipt) {
    recommendedFollowUp =
      "Receipt under review — expedite payment clearing check with insurer billing portal to prevent automated cancellation notice.";
  } else if (level === "critical" || level === "high") {
    recommendedFollowUp =
      "45+ days overdue — verify whether insurer has issued a late-payment or cancellation warning and contact Account Manager.";
  } else if (level === "medium") {
    recommendedFollowUp =
      "15–44 days overdue — follow up with client AP and reissue payment slip / propose formal extension if needed.";
  } else {
    recommendedFollowUp =
      "1–14 days overdue — send early overdue reminder before insurer sends a direct collection letter.";
  }

  return { level, linePriority, recommendedFollowUp };
}

export async function getLatestReportSnapshotDate(): Promise<string> {
  try {
    const db = await getServiceDb();
    const res = await db.query<{ snapshot_date: string }>(
      `select snapshot_date::text from public.import_batches where status = 'completed' order by snapshot_date desc limit 1`
    );
    return res.rows[0]?.snapshot_date ?? DEFAULT_REFERENCE_DATE;
  } catch {
    return DEFAULT_REFERENCE_DATE;
  }
}

export async function getInternalReceivablesList(
  staffUser: SessionUser,
  referenceDate?: string
): Promise<InternalReceivableRow[]> {
  return withRlsSession(staffUser.id, async (tx) => {
    let effectiveDate = referenceDate;
    if (!effectiveDate) {
      const maxSnapRes = await tx.query<{ max_date: string | null }>(
        `select max(snapshot_date)::text as max_date from public.import_batches where status = 'completed'`
      );
      effectiveDate = maxSnapRes.rows[0]?.max_date ?? DEFAULT_REFERENCE_DATE;
    }

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
      source_status: string;
      is_customer_visible: boolean;
      data_quality_status: string;
      is_missing_from_latest: boolean;
      extension_attempts: string;
      approved_extensions: string;
      pending_extensions: string;
      pending_receipts: string;
      open_disputes: string;
      latest_note: string | null;
      latest_checked_by: string | null;
      latest_sent_on: string | null;
    }>(`
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
        i.amount_brl::text,
        i.outstanding_balance_brl::text,
        i.confirmed_paid_brl::text,
        i.is_credit,
        i.original_due_date::text,
        i.extended_due_date::text,
        i.current_due_date::text,
        i.payment_status::text,
        i.source_status,
        i.is_customer_visible,
        i.data_quality_status,
        i.is_missing_from_latest,
        coalesce(ext.total_attempts, 0)::text as extension_attempts,
        coalesce(ext.approved_count, 0)::text as approved_extensions,
        coalesce(ext.pending_count, 0)::text as pending_extensions,
        coalesce(pay.pending_count, 0)::text as pending_receipts,
        coalesce(disp.open_count, 0)::text as open_disputes,
        nt.content as latest_note,
        tr.checked_by_raw as latest_checked_by,
        tr.sent_to_client_on::text as latest_sent_on
      from public.installments i
      join public.policies p on p.id = i.policy_id
      join public.organizations o on o.id = i.organization_id
      join public.policyholders ph on ph.id = p.policyholder_id
      left join lateral (
        select
          count(*) as total_attempts,
          count(*) filter (where e.status = 'approved') as approved_count,
          count(*) filter (where e.status in ('requested', 'submitted_to_insurer', 'awaiting_response')) as pending_count
        from public.extensions e
        where e.installment_id = i.id
      ) ext on true
      left join lateral (
        select count(*) as pending_count
        from public.payments pm
        where pm.installment_id = i.id
          and pm.verification_status in ('submitted', 'under_review')
      ) pay on true
      left join lateral (
        select count(*) as open_count
        from public.exceptions ex
        where ex.installment_id = i.id
          and ex.type = 'amount_dispute'
          and ex.status not in ('resolved', 'rejected')
      ) disp on true
      left join lateral (
        select content
        from public.internal_notes n
        where n.installment_id = i.id
        order by n.created_at desc
        limit 1
      ) nt on true
      left join lateral (
        select checked_by_raw, sent_to_client_on
        from public.installment_internal_tracking t
        where t.installment_id = i.id
        order by t.created_at desc
        limit 1
      ) tr on true
      order by i.current_due_date asc nulls last, o.name asc, p.policy_number asc, i.installment_number asc
    `);

    return res.rows.map((r) => {
      const amountBrl = Number(r.amount_brl);
      const outstandingBalanceBrl = Number(r.outstanding_balance_brl);
      const confirmedPaidBrl = Number(r.confirmed_paid_brl);
      const daysFromToday = diffDaysFromReference(r.current_due_date, effectiveDate);

      const isActiveDebt =
        !r.is_credit &&
        r.payment_status !== "paid" &&
        r.payment_status !== "cancelled" &&
        outstandingBalanceBrl > 0;

      const daysOverdue =
        isActiveDebt && daysFromToday !== null && daysFromToday < 0
          ? Math.abs(daysFromToday)
          : 0;

      const agingBucket: InternalReceivableRow["agingBucket"] =
        daysOverdue <= 0
          ? "current"
          : daysOverdue <= 30
            ? "1-30"
            : daysOverdue <= 60
              ? "31-60"
              : daysOverdue <= 89
                ? "61-89"
                : "90+";

      const hasPendingReceipt = Number(r.pending_receipts) > 0;
      const risk = computeHeuristicRisk({
        insuranceType: r.insurance_type,
        paymentStatus: r.payment_status,
        amountBrl,
        outstandingBrl: outstandingBalanceBrl,
        daysOverdue,
        hasPendingReceipt,
        isMissingFromLatest: r.is_missing_from_latest,
      });

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
        sourceStatus: r.source_status,
        isCustomerVisible: r.is_customer_visible,
        dataQualityStatus: r.data_quality_status,
        isMissingFromLatest: r.is_missing_from_latest,
        daysOverdue,
        daysFromToday,
        agingBucket,
        extensionAttempts: Number(r.extension_attempts),
        approvedExtensions: Number(r.approved_extensions),
        hasPendingReceipt,
        hasPendingExtension: Number(r.pending_extensions) > 0,
        hasOpenDispute: Number(r.open_disputes) > 0,
        riskLevel: risk.level,
        linePriority: risk.linePriority,
        recommendedFollowUp: risk.recommendedFollowUp,
        latestInternalNote: r.latest_note,
        latestCheckedBy: r.latest_checked_by,
        latestSentToClientOn: r.latest_sent_on,
      };
    }).filter((r) => {
      if (
        (r.isMissingFromLatest || r.paymentStatus === "missing_from_latest_report") &&
        r.daysOverdue <= 0
      ) {
        return false;
      }
      return true;
    });
  });
}

export interface WeekOverWeekAnalytics {
  latestSnapshotDate: string;
  previousSnapshotDate: string;
  comparison: {
    latestOverdueCount: number;
    latestOverdueBrl: number;
    previousOverdueCount: number;
    previousOverdueBrl: number;
    netChangeCount: number;
    netChangeBrl: number;
    newlyOverdue: { count: number; amountBrl: number };
    resolvedPaid: { count: number; amountBrl: number };
    improvedByExtension: { count: number; amountBrl: number };
    stillOutstanding: { count: number; amountBrl: number };
    increasedBalance: { count: number; amountBrl: number };
    missingOverdue: { count: number; amountBrl: number };
    cancelledOutcome: { count: number; amountBrl: number };
  };
  agingOverall: {
    bucket: "1-30" | "31-60" | "61-89" | "90+";
    label: string;
    count: number;
    amountBrl: number;
    percentageOfOverdueBrl: number;
  }[];
  agingByGroup: {
    organizationId: string;
    organizationName: string;
    totalOverdueCount: number;
    totalOverdueBrl: number;
    b1_30Count: number;
    b1_30Brl: number;
    b31_60Count: number;
    b31_60Brl: number;
    b61_89Count: number;
    b61_89Brl: number;
    b90PlusCount: number;
    b90PlusBrl: number;
  }[];
  weeklyTrend: {
    snapshotDate: string;
    label: string;
    overdueCount: number;
    overdueBrl: number;
    newlyOverdueBrl: number;
    resolvedPaidBrl: number;
    improvedByExtBrl: number;
    b1_30Brl: number;
    b31_60Brl: number;
    b61_89Brl: number;
    b90PlusBrl: number;
  }[];
}

/**
 * Section 10: Week-over-Week Receivables Analytics calculated strictly from stored
 * `public.installment_snapshots`.
 * Positive debt only (negative credits excluded); cancelled installments tracked separately
 * rather than counted as collections; extension-driven due-date improvements tracked separately.
 */
export async function getWeekOverWeekAnalytics(
  staffUser: SessionUser,
  organizationFilterId?: string | null
): Promise<WeekOverWeekAnalytics> {
  return withRlsSession(staffUser.id, async (tx) => {
    const datesRes = await tx.query<{ snapshot_date: string }>(`
      select distinct snapshot_date::text as snapshot_date
      from public.installment_snapshots
      order by snapshot_date asc
    `);
    const snapshotDates = datesRes.rows.map((r) => r.snapshot_date);
    const latestDate = snapshotDates[snapshotDates.length - 1] ?? DEFAULT_REFERENCE_DATE;
    const prevDate =
      snapshotDates.length >= 2
        ? snapshotDates[snapshotDates.length - 2]
        : latestDate;

    const orgWhere = organizationFilterId ? `and s.organization_id = $1::uuid` : "";
    const params = organizationFilterId ? [organizationFilterId] : [];

    const snapRowsRes = await tx.query<{
      installment_id: string;
      snapshot_date: string;
      organization_id: string;
      organization_name: string;
      amount_brl: string;
      outstanding_balance_brl: string;
      payment_status: string;
      days_overdue: number;
      aging_bucket: string;
      had_approved_extension: boolean;
      is_missing_from_report: boolean;
    }>(
      `select
         s.installment_id,
         s.snapshot_date::text as snapshot_date,
         s.organization_id,
         o.name as organization_name,
         s.amount_brl::text,
         s.outstanding_balance_brl::text,
         s.payment_status::text,
         s.days_overdue,
         s.aging_bucket,
         s.had_approved_extension,
         s.is_missing_from_report
       from public.installment_snapshots s
       join public.organizations o on o.id = s.organization_id
      where 1=1 ${orgWhere}
      order by s.snapshot_date asc`,
      params
    );

    type SnapItem = {
      installmentId: string;
      snapshotDate: string;
      organizationId: string;
      organizationName: string;
      amountBrl: number;
      outstandingBrl: number;
      paymentStatus: string;
      daysOverdue: number;
      agingBucket: string;
      hadApprovedExtension: boolean;
      isMissingFromReport: boolean;
      isPositiveOverdue: boolean;
    };

    const byDate = new Map<string, Map<string, SnapItem>>();
    for (const d of snapshotDates) byDate.set(d, new Map());

    for (const r of snapRowsRes.rows) {
      const amountBrl = Number(r.amount_brl);
      const outstandingBrl = Number(r.outstanding_balance_brl);
      const isPositiveOverdue =
        amountBrl > 0 &&
        outstandingBrl > 0 &&
        r.days_overdue > 0 &&
        r.payment_status !== "paid" &&
        r.payment_status !== "cancelled";

      const item: SnapItem = {
        installmentId: r.installment_id,
        snapshotDate: r.snapshot_date,
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        amountBrl,
        outstandingBrl,
        paymentStatus: r.payment_status,
        daysOverdue: r.days_overdue,
        agingBucket: r.aging_bucket,
        hadApprovedExtension: r.had_approved_extension,
        isMissingFromReport: r.is_missing_from_report,
        isPositiveOverdue,
      };
      byDate.get(r.snapshot_date)?.set(r.installment_id, item);
    }

    function comparePair(currMap: Map<string, SnapItem>, prevMap: Map<string, SnapItem>) {
      let latestOverdueCount = 0;
      let latestOverdueBrl = 0;
      let previousOverdueCount = 0;
      let previousOverdueBrl = 0;

      const newlyOverdue = { count: 0, amountBrl: 0 };
      const resolvedPaid = { count: 0, amountBrl: 0 };
      const improvedByExtension = { count: 0, amountBrl: 0 };
      const stillOutstanding = { count: 0, amountBrl: 0 };
      const increasedBalance = { count: 0, amountBrl: 0 };
      const missingOverdue = { count: 0, amountBrl: 0 };
      const cancelledOutcome = { count: 0, amountBrl: 0 };

      for (const p of prevMap.values()) {
        if (p.isPositiveOverdue) {
          previousOverdueCount++;
          previousOverdueBrl += p.outstandingBrl;
        }
      }

      for (const c of currMap.values()) {
        if (c.isPositiveOverdue) {
          latestOverdueCount++;
          latestOverdueBrl += c.outstandingBrl;
        }
        if (c.paymentStatus === "cancelled" && c.amountBrl > 0) {
          cancelledOutcome.count++;
          cancelledOutcome.amountBrl += c.amountBrl;
        }

        const p = prevMap.get(c.installmentId);
        const wasOverdue = p?.isPositiveOverdue ?? false;

        if (!wasOverdue && c.isPositiveOverdue) {
          newlyOverdue.count++;
          newlyOverdue.amountBrl += c.outstandingBrl;
        } else if (wasOverdue && c.isPositiveOverdue) {
          if (c.isMissingFromReport || c.paymentStatus === "missing_from_latest_report") {
            missingOverdue.count++;
            missingOverdue.amountBrl += c.outstandingBrl;
          } else {
            stillOutstanding.count++;
            stillOutstanding.amountBrl += c.outstandingBrl;
            if (p && c.outstandingBrl > p.outstandingBrl + 0.01) {
              increasedBalance.count++;
              increasedBalance.amountBrl += c.outstandingBrl - p.outstandingBrl;
            }
          }
        } else if (wasOverdue && !c.isPositiveOverdue && p) {
          if (c.paymentStatus === "paid" || c.outstandingBrl === 0) {
            resolvedPaid.count++;
            resolvedPaid.amountBrl += p.outstandingBrl;
          } else if (c.paymentStatus === "cancelled") {
            // Tracked in cancelledOutcome, not treated as a healthy collection
          } else if (c.hadApprovedExtension && c.daysOverdue === 0) {
            improvedByExtension.count++;
            improvedByExtension.amountBrl += p.outstandingBrl;
          }
        }
      }

      return {
        latestOverdueCount,
        latestOverdueBrl,
        previousOverdueCount,
        previousOverdueBrl,
        netChangeCount: latestOverdueCount - previousOverdueCount,
        netChangeBrl: latestOverdueBrl - previousOverdueBrl,
        newlyOverdue,
        resolvedPaid,
        improvedByExtension,
        stillOutstanding,
        increasedBalance,
        missingOverdue,
        cancelledOutcome,
      };
    }

    const latestMap = byDate.get(latestDate) ?? new Map<string, SnapItem>();
    const prevMap = byDate.get(prevDate) ?? new Map<string, SnapItem>();
    const comparison = comparePair(latestMap, prevMap);

    // Aging buckets on latest snapshot
    const bucketDefs: { key: "1-30" | "31-60" | "61-89" | "90+"; label: string }[] = [
      { key: "1-30", label: "1–30 days" },
      { key: "31-60", label: "31–60 days" },
      { key: "61-89", label: "61–89 days" },
      { key: "90+", label: "90+ days" },
    ];
    const bucketTotals = new Map<string, { count: number; amountBrl: number }>();
    for (const b of bucketDefs) bucketTotals.set(b.key, { count: 0, amountBrl: 0 });

    const groupMap = new Map<
      string,
      WeekOverWeekAnalytics["agingByGroup"][number]
    >();

    for (const item of latestMap.values()) {
      if (!item.isPositiveOverdue) continue;
      const b = bucketTotals.get(item.agingBucket);
      if (b) {
        b.count++;
        b.amountBrl += item.outstandingBrl;
      }

      let g = groupMap.get(item.organizationId);
      if (!g) {
        g = {
          organizationId: item.organizationId,
          organizationName: item.organizationName,
          totalOverdueCount: 0,
          totalOverdueBrl: 0,
          b1_30Count: 0,
          b1_30Brl: 0,
          b31_60Count: 0,
          b31_60Brl: 0,
          b61_89Count: 0,
          b61_89Brl: 0,
          b90PlusCount: 0,
          b90PlusBrl: 0,
        };
        groupMap.set(item.organizationId, g);
      }

      g.totalOverdueCount++;
      g.totalOverdueBrl += item.outstandingBrl;
      if (item.agingBucket === "1-30") {
        g.b1_30Count++;
        g.b1_30Brl += item.outstandingBrl;
      } else if (item.agingBucket === "31-60") {
        g.b31_60Count++;
        g.b31_60Brl += item.outstandingBrl;
      } else if (item.agingBucket === "61-89") {
        g.b61_89Count++;
        g.b61_89Brl += item.outstandingBrl;
      } else if (item.agingBucket === "90+") {
        g.b90PlusCount++;
        g.b90PlusBrl += item.outstandingBrl;
      }
    }

    const totalOverdueDenom = comparison.latestOverdueBrl || 1;
    const agingOverall = bucketDefs.map((b) => {
      const stat = bucketTotals.get(b.key) ?? { count: 0, amountBrl: 0 };
      return {
        bucket: b.key,
        label: b.label,
        count: stat.count,
        amountBrl: stat.amountBrl,
        percentageOfOverdueBrl:
          comparison.latestOverdueBrl > 0
            ? Math.round((stat.amountBrl / totalOverdueDenom) * 1000) / 10
            : 0,
      };
    });

    const agingByGroup = [...groupMap.values()].sort(
      (a, b) => b.totalOverdueBrl - a.totalOverdueBrl
    );

    const weeklyTrend: WeekOverWeekAnalytics["weeklyTrend"] = snapshotDates.map(
      (dateStr, idx) => {
        const curr = byDate.get(dateStr) ?? new Map<string, SnapItem>();
        const prev =
          idx > 0
            ? byDate.get(snapshotDates[idx - 1]) ?? new Map<string, SnapItem>()
            : curr;
        const cmp = idx > 0 ? comparePair(curr, prev) : null;

        let b1_30Brl = 0;
        let b31_60Brl = 0;
        let b61_89Brl = 0;
        let b90PlusBrl = 0;
        let overdueCount = 0;
        let overdueBrl = 0;

        for (const it of curr.values()) {
          if (!it.isPositiveOverdue) continue;
          overdueCount++;
          overdueBrl += it.outstandingBrl;
          if (it.agingBucket === "1-30") b1_30Brl += it.outstandingBrl;
          else if (it.agingBucket === "31-60") b31_60Brl += it.outstandingBrl;
          else if (it.agingBucket === "61-89") b61_89Brl += it.outstandingBrl;
          else if (it.agingBucket === "90+") b90PlusBrl += it.outstandingBrl;
        }

        const parts = dateStr.split("-");
        const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : dateStr;

        return {
          snapshotDate: dateStr,
          label,
          overdueCount,
          overdueBrl: Math.round(overdueBrl * 100) / 100,
          newlyOverdueBrl: Math.round((cmp?.newlyOverdue.amountBrl ?? 0) * 100) / 100,
          resolvedPaidBrl: Math.round((cmp?.resolvedPaid.amountBrl ?? 0) * 100) / 100,
          improvedByExtBrl:
            Math.round((cmp?.improvedByExtension.amountBrl ?? 0) * 100) / 100,
          b1_30Brl: Math.round(b1_30Brl * 100) / 100,
          b31_60Brl: Math.round(b31_60Brl * 100) / 100,
          b61_89Brl: Math.round(b61_89Brl * 100) / 100,
          b90PlusBrl: Math.round(b90PlusBrl * 100) / 100,
        };
      }
    );

    return {
      latestSnapshotDate: latestDate,
      previousSnapshotDate: prevDate,
      comparison,
      agingOverall,
      agingByGroup,
      weeklyTrend,
    };
  });
}

/**
 * Complete Internal Installment Detail (Section 9C).
 * Includes confidential Internal Notes, Checked By history, Sent to Client On history,
 * Payment verification records, Extension attempts & protocols, Disputes, Import history,
 * Data-Quality warnings, and the full Activity Timeline.
 */
export async function getInternalInstallmentDetail(
  staffUser: SessionUser,
  installmentId: string,
  referenceDate: string = DEFAULT_REFERENCE_DATE
) {
  return withRlsSession(staffUser.id, async (tx) => {
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
      source_status: string;
      is_customer_visible: boolean;
      data_quality_status: string;
      is_missing_from_latest: boolean;
      missing_since: string | null;
      paid_source: string | null;
      cancellation_source: string | null;
      cancellation_reason: string | null;
      cancelled_at: string | null;
      source_row_id: string | null;
      first_seen_at: string;
      last_seen_at: string;
    }>(
      `select
         i.id, i.policy_id, i.organization_id, o.name as organization_name,
         p.policyholder_id, ph.name as policyholder_name, ph.tax_id as policyholder_tax_id,
         p.insurer, p.policy_number, p.endorsement, p.insurance_type,
         p.branch, p.account_manager,
         i.installment_number, i.source_installment_number, i.total_installments,
         i.amount_brl::text, i.outstanding_balance_brl::text, i.confirmed_paid_brl::text,
         i.is_credit, i.original_due_date::text, i.extended_due_date::text,
         i.current_due_date::text, i.payment_status::text, i.source_status,
         i.is_customer_visible, i.data_quality_status, i.is_missing_from_latest,
         i.missing_since::text, i.paid_source, i.cancellation_source,
         i.cancellation_reason, i.cancelled_at::text, i.source_row_id,
         i.first_seen_at::text, i.last_seen_at::text
       from public.installments i
       join public.policies p on p.id = i.policy_id
       join public.organizations o on o.id = i.organization_id
       join public.policyholders ph on ph.id = p.policyholder_id
      where i.id = $1
      limit 1`,
      [installmentId]
    );

    const row = instRes.rows[0];
    if (!row) return null;

    const notesRes = await tx.query<{
      id: string;
      source: string;
      content: string;
      author_name: string | null;
      created_at: string;
    }>(
      `select
         n.id, n.source, n.content, pr.full_name as author_name, n.created_at::text
       from public.internal_notes n
       left join public.profiles pr on pr.id = n.author_id
      where n.installment_id = $1
      order by n.created_at desc`,
      [installmentId]
    );

    const trackingRes = await tx.query<{
      id: string;
      checked_by_raw: string | null;
      sent_to_client_on: string | null;
      file_name: string | null;
      created_at: string;
    }>(
      `select
         t.id, t.checked_by_raw, t.sent_to_client_on::text,
         b.file_name, t.created_at::text
       from public.installment_internal_tracking t
       left join public.import_batches b on b.id = t.import_batch_id
      where t.installment_id = $1
      order by t.created_at desc`,
      [installmentId]
    );

    const paymentsRes = await tx.query<{
      id: string;
      amount_brl: string;
      payment_date: string;
      receipt_document_id: string | null;
      verification_status: string;
      confirmed_amount_brl: string | null;
      insurer_confirmation_date: string | null;
      customer_comment: string | null;
      verified_by_name: string | null;
      verified_at: string | null;
      notes: string | null;
      created_at: string;
    }>(
      `select
         p.id, p.amount_brl::text, p.payment_date::text, p.receipt_document_id,
         p.verification_status::text, p.confirmed_amount_brl::text,
         p.insurer_confirmation_date::text, p.customer_comment,
         pr.full_name as verified_by_name, p.verified_at::text, p.notes,
         p.created_at::text
       from public.payments p
       left join public.profiles pr on pr.id = p.verified_by
      where p.installment_id = $1
      order by p.created_at desc`,
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
      priority: string;
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
         id, type::text, status::text, priority, description, requested_amount::text,
         endorsement_reference, insurer_breakdown_received_on::text,
         customer_response, resolution, created_at::text, updated_at::text
       from public.exceptions
      where installment_id = $1
      order by created_at desc`,
      [installmentId]
    );

    const dqRes = await tx.query<{
      id: string;
      issue_code: string;
      severity: string;
      status: string;
      holds_visibility: boolean;
      title: string;
      description: string;
      original_values: Record<string, unknown>;
      resolution_notes: string | null;
      created_at: string;
    }>(
      `select
         id, issue_code, severity::text, status::text, holds_visibility,
         title, description, original_values, resolution_notes, created_at::text
       from public.data_quality_issues
      where installment_id = $1
      order by created_at desc`,
      [installmentId]
    );

    const activityRes = await tx.query<{
      id: string;
      action: string;
      visibility: string;
      actor_label: string | null;
      description: string;
      old_values: Record<string, unknown> | null;
      new_values: Record<string, unknown> | null;
      created_at: string;
    }>(
      `select
         id, action, visibility::text, actor_label, description,
         old_values, new_values, created_at::text
       from public.activity_logs
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
      visibility: string;
      created_at: string;
    }>(
      `select
         id, exception_id, file_name, mime_type, size_bytes::text,
         document_type, visibility::text, created_at::text
       from public.documents
      where installment_id = $1
      order by created_at desc`,
      [installmentId]
    );

    const amountBrl = Number(row.amount_brl);
    const outstandingBrl = Number(row.outstanding_balance_brl);
    const daysFromToday = diffDaysFromReference(row.current_due_date, referenceDate);
    const daysOverdue =
      !row.is_credit &&
      row.payment_status !== "paid" &&
      row.payment_status !== "cancelled" &&
      outstandingBrl > 0 &&
      daysFromToday !== null &&
      daysFromToday < 0
        ? Math.abs(daysFromToday)
        : 0;

    const risk = computeHeuristicRisk({
      insuranceType: row.insurance_type,
      paymentStatus: row.payment_status,
      amountBrl,
      outstandingBrl,
      daysOverdue,
      hasPendingReceipt: paymentsRes.rows.some(
        (p) => p.verification_status === "submitted" || p.verification_status === "under_review"
      ),
      isMissingFromLatest: row.is_missing_from_latest,
    });

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
        amountBrl,
        outstandingBalanceBrl: outstandingBrl,
        confirmedPaidBrl: Number(row.confirmed_paid_brl),
        isCredit: row.is_credit,
        originalDueDate: row.original_due_date,
        extendedDueDate: row.extended_due_date,
        currentDueDate: row.current_due_date,
        paymentStatus: row.payment_status,
        sourceStatus: row.source_status,
        isCustomerVisible: row.is_customer_visible,
        dataQualityStatus: row.data_quality_status,
        isMissingFromLatest: row.is_missing_from_latest,
        missingSince: row.missing_since,
        paidSource: row.paid_source,
        cancellationSource: row.cancellation_source,
        cancellationReason: row.cancellation_reason,
        cancelledAt: row.cancelled_at,
        sourceRowId: row.source_row_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        daysOverdue,
        daysFromToday,
        riskLevel: risk.level,
        linePriority: risk.linePriority,
        recommendedFollowUp: risk.recommendedFollowUp,
      },
      internalNotes: notesRes.rows.map((n) => ({
        id: n.id,
        source: n.source,
        content: n.content,
        authorName: n.author_name ?? (n.source === "spreadsheet_import" ? "Spreadsheet Import" : "Meridian Staff"),
        createdAt: n.created_at,
      })),
      trackingHistory: trackingRes.rows.map((t) => ({
        id: t.id,
        checkedBy: t.checked_by_raw,
        sentToClientOn: t.sent_to_client_on,
        fileName: t.file_name,
        createdAt: t.created_at,
      })),
      payments: paymentsRes.rows.map((p) => ({
        id: p.id,
        amountBrl: Number(p.amount_brl),
        paymentDate: p.payment_date,
        receiptDocumentId: p.receipt_document_id,
        verificationStatus: p.verification_status,
        confirmedAmountBrl: p.confirmed_amount_brl ? Number(p.confirmed_amount_brl) : null,
        insurerConfirmationDate: p.insurer_confirmation_date,
        customerComment: p.customer_comment,
        verifiedByName: p.verified_by_name,
        verifiedAt: p.verified_at,
        notes: p.notes,
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
        priority: ex.priority,
        description: ex.description,
        requestedAmount: ex.requested_amount ? Number(ex.requested_amount) : null,
        endorsementReference: ex.endorsement_reference,
        insurerBreakdownReceivedOn: ex.insurer_breakdown_received_on,
        customerResponse: ex.customer_response,
        resolution: ex.resolution,
        createdAt: ex.created_at,
        updatedAt: ex.updated_at,
      })),
      dataQualityIssues: dqRes.rows.map((d) => ({
        id: d.id,
        issueCode: d.issue_code,
        severity: d.severity,
        status: d.status,
        holdsVisibility: d.holds_visibility,
        title: d.title,
        description: d.description,
        originalValues: d.original_values,
        resolutionNotes: d.resolution_notes,
        createdAt: d.created_at,
      })),
      documents: documentsRes.rows.map((d) => ({
        id: d.id,
        exceptionId: d.exception_id,
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes ? Number(d.size_bytes) : null,
        documentType: d.document_type,
        visibility: d.visibility,
        createdAt: d.created_at,
      })),
      timeline: activityRes.rows.map((a) => ({
        id: a.id,
        action: a.action,
        visibility: a.visibility,
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
 * Fetches internal queues for `/internal/extensions`, `/internal/payments`,
 * `/internal/disputes`, `/internal/imports`, `/internal/data-quality`,
 * `/internal/customers`, and `/internal/reminders`.
 */
export async function getInternalExtensionsQueue(staffUser: SessionUser) {
  return withRlsSession(staffUser.id, async (tx) => {
    const res = await tx.query<{
      id: string;
      installment_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_name: string;
      policy_number: string;
      endorsement: string;
      insurance_type: string;
      insurer: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      original_due_date: string | null;
      extended_due_date: string | null;
      current_due_date: string | null;
      attempt_number: number;
      total_attempts: string;
      approved_attempts: string;
      requested_due_date: string;
      approved_due_date: string | null;
      previous_due_date: string | null;
      request_reason: string | null;
      protocol_number: string | null;
      status: string;
      requested_at: string;
      submitted_to_insurer_at: string | null;
      insurer_response_at: string | null;
      response_notes: string | null;
    }>(`
      select
        e.id,
        e.installment_id,
        e.organization_id,
        o.name as organization_name,
        ph.name as policyholder_name,
        p.policy_number,
        p.endorsement,
        p.insurance_type,
        e.insurer,
        i.installment_number,
        i.total_installments,
        i.amount_brl::text,
        i.original_due_date::text,
        i.extended_due_date::text,
        i.current_due_date::text,
        e.attempt_number,
        (select count(*)::text from public.extensions e2 where e2.installment_id = i.id) as total_attempts,
        (select count(*)::text from public.extensions e3 where e3.installment_id = i.id and e3.status = 'approved') as approved_attempts,
        e.requested_due_date::text,
        e.approved_due_date::text,
        e.previous_due_date::text,
        e.request_reason,
        e.protocol_number,
        e.status::text,
        e.requested_at::text,
        e.submitted_to_insurer_at::text,
        e.insurer_response_at::text,
        e.response_notes
      from public.extensions e
      join public.installments i on i.id = e.installment_id
      join public.policies p on p.id = i.policy_id
      join public.organizations o on o.id = e.organization_id
      join public.policyholders ph on ph.id = p.policyholder_id
      order by
        case when e.status in ('requested', 'submitted_to_insurer', 'awaiting_response') then 0 else 1 end asc,
        e.requested_at desc
    `);

    return res.rows.map((r) => ({
      id: r.id,
      installmentId: r.installment_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      policyholderName: r.policyholder_name,
      policyNumber: r.policy_number,
      endorsement: r.endorsement,
      insuranceType: r.insurance_type,
      insurer: r.insurer,
      installmentNumber: r.installment_number,
      totalInstallments: r.total_installments,
      amountBrl: Number(r.amount_brl),
      originalDueDate: r.original_due_date,
      extendedDueDate: r.extended_due_date,
      currentDueDate: r.current_due_date,
      attemptNumber: r.attempt_number,
      totalAttempts: Number(r.total_attempts),
      approvedAttempts: Number(r.approved_attempts),
      requestedDueDate: r.requested_due_date,
      approvedDueDate: r.approved_due_date,
      previousDueDate: r.previous_due_date,
      requestReason: r.request_reason,
      protocolNumber: r.protocol_number,
      status: r.status,
      requestedAt: r.requested_at,
      submittedToInsurerAt: r.submitted_to_insurer_at,
      insurerResponseAt: r.insurer_response_at,
      responseNotes: r.response_notes,
    }));
  });
}

export async function getInternalPaymentsQueue(staffUser: SessionUser) {
  return withRlsSession(staffUser.id, async (tx) => {
    const res = await tx.query<{
      id: string;
      installment_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_name: string;
      policy_number: string;
      endorsement: string;
      insurer: string;
      insurance_type: string;
      installment_number: number;
      total_installments: number;
      installment_amount_brl: string;
      outstanding_balance_brl: string;
      confirmed_paid_brl: string;
      payment_status: string;
      amount_brl: string;
      payment_date: string;
      verification_status: string;
      confirmed_amount_brl: string | null;
      insurer_confirmation_date: string | null;
      customer_comment: string | null;
      verified_by_name: string | null;
      verified_at: string | null;
      notes: string | null;
      receipt_file_name: string | null;
      receipt_document_id: string | null;
      created_at: string;
    }>(`
      select
        pm.id,
        pm.installment_id,
        pm.organization_id,
        o.name as organization_name,
        ph.name as policyholder_name,
        p.policy_number,
        p.endorsement,
        p.insurer,
        p.insurance_type,
        i.installment_number,
        i.total_installments,
        i.amount_brl::text as installment_amount_brl,
        i.outstanding_balance_brl::text,
        i.confirmed_paid_brl::text,
        i.payment_status::text,
        pm.amount_brl::text,
        pm.payment_date::text,
        pm.verification_status::text,
        pm.confirmed_amount_brl::text,
        pm.insurer_confirmation_date::text,
        pm.customer_comment,
        pr.full_name as verified_by_name,
        pm.verified_at::text,
        pm.notes,
        d.file_name as receipt_file_name,
        pm.receipt_document_id,
        pm.created_at::text
      from public.payments pm
      join public.installments i on i.id = pm.installment_id
      join public.policies p on p.id = i.policy_id
      join public.organizations o on o.id = pm.organization_id
      join public.policyholders ph on ph.id = p.policyholder_id
      left join public.profiles pr on pr.id = pm.verified_by
      left join public.documents d on d.id = pm.receipt_document_id
      order by
        case when pm.verification_status in ('submitted', 'under_review') then 0 else 1 end asc,
        pm.created_at desc
    `);

    return res.rows.map((r) => ({
      id: r.id,
      installmentId: r.installment_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      policyholderName: r.policyholder_name,
      policyNumber: r.policy_number,
      endorsement: r.endorsement,
      insurer: r.insurer,
      insuranceType: r.insurance_type,
      installmentNumber: r.installment_number,
      totalInstallments: r.total_installments,
      installmentAmountBrl: Number(r.installment_amount_brl),
      outstandingBalanceBrl: Number(r.outstanding_balance_brl),
      confirmedPaidBrl: Number(r.confirmed_paid_brl),
      installmentPaymentStatus: r.payment_status,
      amountBrl: Number(r.amount_brl),
      paymentDate: r.payment_date,
      verificationStatus: r.verification_status,
      confirmedAmountBrl: r.confirmed_amount_brl ? Number(r.confirmed_amount_brl) : null,
      insurerConfirmationDate: r.insurer_confirmation_date,
      customerComment: r.customer_comment,
      verifiedByName: r.verified_by_name,
      verifiedAt: r.verified_at,
      notes: r.notes,
      receiptFileName: r.receipt_file_name,
      receiptDocumentId: r.receipt_document_id,
      createdAt: r.created_at,
    }));
  });
}

export async function getInternalDisputesQueue(staffUser: SessionUser) {
  return withRlsSession(staffUser.id, async (tx) => {
    const res = await tx.query<{
      id: string;
      installment_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_name: string;
      policy_number: string;
      endorsement: string;
      insurer: string;
      insurance_type: string;
      installment_number: number;
      total_installments: number;
      amount_brl: string;
      current_due_date: string | null;
      status: string;
      priority: string;
      description: string | null;
      requested_amount: string | null;
      endorsement_reference: string | null;
      insurer_breakdown_received_on: string | null;
      customer_response: string | null;
      resolution: string | null;
      created_at: string;
      updated_at: string;
    }>(`
      select
        ex.id,
        ex.installment_id,
        ex.organization_id,
        o.name as organization_name,
        ph.name as policyholder_name,
        p.policy_number,
        p.endorsement,
        p.insurer,
        p.insurance_type,
        i.installment_number,
        i.total_installments,
        i.amount_brl::text,
        i.current_due_date::text,
        ex.status::text,
        ex.priority,
        ex.description,
        ex.requested_amount::text,
        ex.endorsement_reference,
        ex.insurer_breakdown_received_on::text,
        ex.customer_response,
        ex.resolution,
        ex.created_at::text,
        ex.updated_at::text
      from public.exceptions ex
      join public.installments i on i.id = ex.installment_id
      join public.policies p on p.id = i.policy_id
      join public.organizations o on o.id = ex.organization_id
      join public.policyholders ph on ph.id = p.policyholder_id
      where ex.type = 'amount_dispute'
      order by
        case when ex.status not in ('resolved', 'rejected') then 0 else 1 end asc,
        ex.created_at desc
    `);

    return res.rows.map((r) => ({
      id: r.id,
      installmentId: r.installment_id,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      policyholderName: r.policyholder_name,
      policyNumber: r.policy_number,
      endorsement: r.endorsement,
      insurer: r.insurer,
      insuranceType: r.insurance_type,
      installmentNumber: r.installment_number,
      totalInstallments: r.total_installments,
      amountBrl: Number(r.amount_brl),
      currentDueDate: r.current_due_date,
      status: r.status,
      priority: r.priority,
      description: r.description,
      requestedAmount: r.requested_amount ? Number(r.requested_amount) : null,
      endorsementReference: r.endorsement_reference,
      insurerBreakdownReceivedOn: r.insurer_breakdown_received_on,
      customerResponse: r.customer_response,
      resolution: r.resolution,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function getInternalImportsAndDq(staffUser: SessionUser) {
  return withRlsSession(staffUser.id, async (tx) => {
    const batchesRes = await tx.query<{
      id: string;
      file_name: string;
      file_hash: string | null;
      snapshot_date: string;
      total_rows: number;
      imported_rows: number;
      updated_rows: number;
      unchanged_rows: number;
      held_rows: number;
      rejected_rows: number;
      duplicate_rows: number;
      ignored_rows: number;
      missing_rows: number;
      missing_overdue_rows: number;
      warning_count: number;
      status: string;
      duplicate_of: string | null;
      summary: Record<string, unknown>;
      created_at: string;
      completed_at: string | null;
    }>(`
      select
        id, file_name, file_hash, snapshot_date::text,
        total_rows, imported_rows, updated_rows, unchanged_rows,
        held_rows, rejected_rows, duplicate_rows, ignored_rows,
        missing_rows, missing_overdue_rows, warning_count,
        status, duplicate_of::text, summary,
        created_at::text, completed_at::text
      from public.import_batches
      order by snapshot_date desc, created_at desc
    `);

    const dqRes = await tx.query<{
      id: string;
      installment_id: string | null;
      import_batch_id: string | null;
      organization_id: string | null;
      organization_name: string | null;
      row_number: number | null;
      issue_code: string;
      severity: string;
      status: string;
      holds_visibility: boolean;
      title: string;
      description: string;
      original_values: Record<string, unknown>;
      resolution_notes: string | null;
      created_at: string;
      policy_number: string | null;
      policyholder_name: string | null;
      insurer: string | null;
      installment_number: number | null;
      total_installments: number | null;
      amount_brl: string | null;
      original_due_date: string | null;
      extended_due_date: string | null;
      current_due_date: string | null;
      payment_status: string | null;
      is_customer_visible: boolean | null;
    }>(`
      select
        dq.id,
        dq.installment_id,
        dq.import_batch_id,
        dq.organization_id,
        o.name as organization_name,
        dq.row_number,
        dq.issue_code,
        dq.severity::text,
        dq.status::text,
        dq.holds_visibility,
        dq.title,
        dq.description,
        dq.original_values,
        dq.resolution_notes,
        dq.created_at::text,
        p.policy_number,
        ph.name as policyholder_name,
        p.insurer,
        i.installment_number,
        i.total_installments,
        i.amount_brl::text,
        i.original_due_date::text,
        i.extended_due_date::text,
        i.current_due_date::text,
        i.payment_status::text,
        i.is_customer_visible
      from public.data_quality_issues dq
      left join public.organizations o on o.id = dq.organization_id
      left join public.installments i on i.id = dq.installment_id
      left join public.policies p on p.id = i.policy_id
      left join public.policyholders ph on ph.id = p.policyholder_id
      order by
        case when dq.status = 'open' then 0 else 1 end asc,
        case when dq.severity = 'high' then 0 when dq.severity = 'warning' then 1 else 2 end asc,
        dq.row_number asc nulls last
    `);

    return {
      batches: batchesRes.rows.map((b) => ({
        id: b.id,
        fileName: b.file_name,
        fileHash: b.file_hash,
        snapshotDate: b.snapshot_date,
        totalRows: b.total_rows,
        importedRows: b.imported_rows,
        updatedRows: b.updated_rows,
        unchangedRows: b.unchanged_rows,
        heldRows: b.held_rows,
        rejectedRows: b.rejected_rows,
        duplicateRows: b.duplicate_rows,
        ignoredRows: b.ignored_rows,
        missingRows: b.missing_rows,
        missingOverdueRows: b.missing_overdue_rows,
        warningCount: b.warning_count,
        status: b.status,
        duplicateOf: b.duplicate_of,
        summary: b.summary,
        createdAt: b.created_at,
        completedAt: b.completed_at,
      })),
      issues: dqRes.rows.map((d) => ({
        id: d.id,
        installmentId: d.installment_id,
        importBatchId: d.import_batch_id,
        organizationId: d.organization_id,
        organizationName: d.organization_name,
        rowNumber: d.row_number,
        issueCode: d.issue_code,
        severity: d.severity,
        status: d.status,
        holdsVisibility: d.holds_visibility,
        title: d.title,
        description: d.description,
        originalValues: d.original_values,
        resolutionNotes: d.resolution_notes,
        createdAt: d.created_at,
        policyNumber: d.policy_number,
        policyholderName: d.policyholder_name,
        insurer: d.insurer,
        installmentNumber: d.installment_number,
        totalInstallments: d.total_installments,
        amountBrl: d.amount_brl ? Number(d.amount_brl) : null,
        originalDueDate: d.original_due_date,
        extendedDueDate: d.extended_due_date,
        currentDueDate: d.current_due_date,
        paymentStatus: d.payment_status,
        isCustomerVisible: d.is_customer_visible,
      })),
    };
  });
}

export async function getInternalMissingInstallmentsData(staffUser: SessionUser) {
  const [receivables, resolvedCount] = await Promise.all([
    getInternalReceivablesList(staffUser),
    withRlsSession(staffUser.id, async (tx) => {
      const res = await tx.query<{ cnt: string }>(`
        select count(*)::text as cnt
        from public.installments
        where missing_since is not null
          and is_missing_from_latest = false
      `);
      return Number(res.rows[0]?.cnt ?? 0);
    }),
  ]);

  const missingInstallments = receivables
    .filter(
      (r) =>
        (r.isMissingFromLatest || r.paymentStatus === "missing_from_latest_report") &&
        r.daysOverdue > 0
    )
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const totalMissingBrl = missingInstallments.reduce(
    (sum, r) => sum + r.outstandingBalanceBrl,
    0
  );

  return {
    missingInstallments,
    totalMissingBrl,
    resolvedCount,
  };
}

export async function getInternalCustomersAndUsers(staffUser: SessionUser) {
  return withRlsSession(staffUser.id, async (tx) => {
    const orgsRes = await tx.query<{
      id: string;
      name: string;
      normalized_name: string;
      policy_count: string;
      installment_count: string;
      visible_count: string;
      overdue_brl: string;
      outstanding_brl: string;
      policyholders: string[];
    }>(`
      select
        o.id,
        o.name,
        o.normalized_name,
        count(distinct p.id)::text as policy_count,
        count(distinct i.id)::text as installment_count,
        count(distinct i.id) filter (where i.is_customer_visible = true)::text as visible_count,
        coalesce(sum(i.outstanding_balance_brl) filter (where i.outstanding_balance_brl > 0 and i.payment_status not in ('paid', 'cancelled') and i.current_due_date < '${DEFAULT_REFERENCE_DATE}'::date), 0)::text as overdue_brl,
        coalesce(sum(i.outstanding_balance_brl) filter (where i.outstanding_balance_brl > 0 and i.payment_status not in ('paid', 'cancelled')), 0)::text as outstanding_brl,
        coalesce(array_agg(distinct ph.name) filter (where ph.name is not null), array[]::text[]) as policyholders
      from public.organizations o
      left join public.policies p on p.organization_id = o.id
      left join public.installments i on i.policy_id = p.id
      left join public.policyholders ph on ph.id = p.policyholder_id
      group by o.id, o.name, o.normalized_name
      order by o.name asc
    `);

    const usersRes = await tx.query<{
      id: string;
      email: string | null;
      full_name: string | null;
      role: string;
      organization_id: string | null;
      organization_name: string | null;
      created_at: string;
    }>(`
      select
        pr.id,
        pr.email,
        pr.full_name,
        pr.role::text,
        pr.organization_id,
        o.name as organization_name,
        pr.created_at::text
      from public.profiles pr
      left join public.organizations o on o.id = pr.organization_id
      order by
        case when pr.role = 'admin' then 0 when pr.role = 'employee' then 1 else 2 end asc,
        pr.full_name asc
    `);

    // Joint-venture policyholders (appearing in >1 customer organization)
    const jvRes = await tx.query<{
      id: string;
      name: string;
      tax_id: string | null;
      org_names: string[];
      org_counts: string[];
    }>(`
      select
        ph.id,
        ph.name,
        ph.tax_id,
        array_agg(distinct o.name order by o.name) as org_names,
        array_agg(distinct (o.name || ': ' || (
          select count(*)::text from public.installments i2
          join public.policies p2 on p2.id = i2.policy_id
          where p2.policyholder_id = ph.id and p2.organization_id = o.id
        ) || ' installments')) as org_counts
      from public.policyholders ph
      join public.policies p on p.policyholder_id = ph.id
      join public.organizations o on o.id = p.organization_id
      group by ph.id, ph.name, ph.tax_id
      having count(distinct p.organization_id) > 1
    `);

    return {
      organizations: orgsRes.rows.map((o) => ({
        id: o.id,
        name: o.name,
        normalizedName: o.normalized_name,
        policyCount: Number(o.policy_count),
        installmentCount: Number(o.installment_count),
        visibleCount: Number(o.visible_count),
        overdueBrl: Number(o.overdue_brl),
        outstandingBrl: Number(o.outstanding_brl),
        policyholders: o.policyholders,
      })),
      users: usersRes.rows.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        fullName: u.full_name ?? "",
        role: u.role,
        organizationId: u.organization_id,
        organizationName: u.organization_name,
        createdAt: u.created_at,
      })),
      jointVentures: jvRes.rows.map((j) => ({
        id: j.id,
        name: j.name,
        taxId: j.tax_id,
        organizations: j.org_names,
        breakdown: j.org_counts,
      })),
    };
  });
}

export async function getInternalRemindersData(
  staffUser: SessionUser,
  referenceDate: string = DEFAULT_REFERENCE_DATE
) {
  return withRlsSession(staffUser.id, async (tx) => {
    const settingsRes = await tx.query<{
      days_before_due: number;
      enabled: boolean;
      provider_mode: string;
      sender_email: string;
      updated_at: string;
    }>(`
      select days_before_due, enabled, provider_mode, sender_email, updated_at::text
      from public.reminder_settings
      where id = 'default'
      limit 1
    `);

    const settings = settingsRes.rows[0] ?? {
      days_before_due: 3,
      enabled: true,
      provider_mode: "demo",
      sender_email: "receivables@meridian.demo",
      updated_at: new Date().toISOString(),
    };

    const historyRes = await tx.query<{
      id: string;
      installment_id: string;
      organization_id: string;
      organization_name: string;
      policyholder_name: string;
      policy_number: string;
      insurer: string;
      installment_number: number;
      total_installments: number;
      due_date: string;
      days_before_due: number;
      recipient_label: string;
      recipient_email: string | null;
      subject: string;
      body_preview: string;
      amount_brl: string;
      status: string;
      provider: string;
      generated_at: string;
      sent_at: string | null;
    }>(`
      select
        r.id,
        r.installment_id,
        r.organization_id,
        o.name as organization_name,
        ph.name as policyholder_name,
        p.policy_number,
        p.insurer,
        i.installment_number,
        i.total_installments,
        r.due_date::text,
        r.days_before_due,
        r.recipient_label,
        r.recipient_email,
        r.subject,
        r.body_preview,
        r.amount_brl::text,
        r.status::text,
        r.provider,
        r.generated_at::text,
        r.sent_at::text
      from public.reminders r
      join public.organizations o on o.id = r.organization_id
      join public.installments i on i.id = r.installment_id
      join public.policies p on p.id = i.policy_id
      join public.policyholders ph on ph.id = p.policyholder_id
      order by r.generated_at desc
    `);

    const upcomingRes = await tx.query<{
      id: string;
      organization_name: string;
      policyholder_name: string;
      policy_number: string;
      insurer: string;
      insurance_type: string;
      installment_number: number;
      total_installments: number;
      outstanding_balance_brl: string;
      current_due_date: string;
    }>(
      `select
         i.id,
         o.name as organization_name,
         ph.name as policyholder_name,
         p.policy_number,
         p.insurer,
         p.insurance_type,
         i.installment_number,
         i.total_installments,
         i.outstanding_balance_brl::text,
         i.current_due_date::text
       from public.installments i
       join public.policies p on p.id = i.policy_id
       join public.organizations o on o.id = i.organization_id
       join public.policyholders ph on ph.id = p.policyholder_id
      where i.is_customer_visible = true
        and i.amount_brl > 0
        and i.outstanding_balance_brl > 0
        and i.payment_status not in ('paid', 'cancelled')
        and i.current_due_date >= $1::date
        and i.current_due_date <= ($1::date + 30)
      order by i.current_due_date asc
      limit 100`,
      [referenceDate]
    );

    return {
      settings: {
        daysBeforeDue: settings.days_before_due,
        enabled: settings.enabled,
        providerMode: settings.provider_mode,
        senderEmail: settings.sender_email,
        isLiveEmailConfigured: Boolean(process.env.RESEND_API_KEY),
        updatedAt: settings.updated_at,
      },
      history: historyRes.rows.map((h) => ({
        id: h.id,
        installmentId: h.installment_id,
        organizationId: h.organization_id,
        organizationName: h.organization_name,
        policyholderName: h.policyholder_name,
        policyNumber: h.policy_number,
        insurer: h.insurer,
        installmentNumber: h.installment_number,
        totalInstallments: h.total_installments,
        dueDate: h.due_date,
        daysBeforeDue: h.days_before_due,
        recipientLabel: h.recipient_label,
        recipientEmail: h.recipient_email,
        subject: h.subject,
        bodyPreview: h.body_preview,
        amountBrl: Number(h.amount_brl),
        status: h.status,
        provider: h.provider,
        generatedAt: h.generated_at,
        sentAt: h.sent_at,
      })),
      upcomingInstallments: upcomingRes.rows.map((u) => ({
        id: u.id,
        organizationName: u.organization_name,
        policyholderName: u.policyholder_name,
        policyNumber: u.policy_number,
        insurer: u.insurer,
        insuranceType: u.insurance_type,
        installmentNumber: u.installment_number,
        totalInstallments: u.total_installments,
        outstandingBalanceBrl: Number(u.outstanding_balance_brl),
        currentDueDate: u.current_due_date,
        daysUntilDue: diffDaysFromReference(u.current_due_date, referenceDate) ?? 0,
      })),
    };
  });
}
