import { SqlExecutor } from "../import/sync";
import { DEFAULT_REFERENCE_DATE, formatBrl, formatBrDate } from "../format";

export interface NotificationPayload {
  toEmail: string | null;
  recipientLabel: string;
  subject: string;
  bodyText: string;
}

export interface NotificationResult {
  delivered: boolean;
  provider: "demo" | "resend";
  status: "sent" | "demo_logged" | "queued" | "failed";
  providerMessageId?: string;
  errorMessage?: string;
}

export interface NotificationProvider {
  sendReminder(payload: NotificationPayload): Promise<NotificationResult>;
}

/**
 * Demo provider: never claims an email was delivered when credentials are not configured.
 */
export class DemoNotificationProvider implements NotificationProvider {
  async sendReminder(_payload: NotificationPayload): Promise<NotificationResult> {
    return {
      delivered: false,
      provider: "demo",
      status: "demo_logged",
    };
  }
}

export class ResendNotificationProvider implements NotificationProvider {
  constructor(
    private apiKey: string,
    private senderEmail: string
  ) {}

  async sendReminder(payload: NotificationPayload): Promise<NotificationResult> {
    if (!payload.toEmail) {
      return {
        delivered: false,
        provider: "resend",
        status: "queued",
        errorMessage: "Organization does not have a configured recipient email.",
      };
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.senderEmail,
          to: [payload.toEmail],
          subject: payload.subject,
          text: payload.bodyText,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          delivered: false,
          provider: "resend",
          status: "failed",
          errorMessage: `Resend HTTP ${res.status}: ${text}`,
        };
      }

      const data = (await res.json()) as { id?: string };
      return {
        delivered: true,
        provider: "resend",
        status: "sent",
        providerMessageId: data.id,
      };
    } catch (err) {
      return {
        delivered: false,
        provider: "resend",
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export function getNotificationProvider(senderEmail: string): {
  provider: NotificationProvider;
  isLiveEmailConfigured: boolean;
} {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && resendKey.trim() !== "") {
    return {
      provider: new ResendNotificationProvider(resendKey.trim(), senderEmail),
      isLiveEmailConfigured: true,
    };
  }
  return {
    provider: new DemoNotificationProvider(),
    isLiveEmailConfigured: false,
  };
}

/**
 * Generates upcoming payment reminders for installments due within `[referenceDate, referenceDate + daysBeforeDue]`
 * that are active, positive-balance, and not paid or cancelled.
 * Avoids duplicates via `(installment_id, due_date, days_before_due)`.
 */
export async function generateUpcomingReminders(
  db: SqlExecutor,
  options: {
    referenceDate?: string;
    overrideDaysBeforeDue?: number;
    triggeredBy?: string | null;
  } = {}
): Promise<{
  referenceDate: string;
  daysBeforeDue: number;
  isLiveEmailConfigured: boolean;
  generatedCount: number;
  sentCount: number;
  demoLoggedCount: number;
  skippedExistingCount: number;
}> {
  const referenceDate = options.referenceDate ?? DEFAULT_REFERENCE_DATE;

  const settingsRes = await db.query<{
    days_before_due: number;
    enabled: boolean;
    sender_email: string;
  }>(`select days_before_due, enabled, sender_email from public.reminder_settings where id = 'default' limit 1`);

  const settings = settingsRes.rows[0] ?? {
    days_before_due: 3,
    enabled: true,
    sender_email: "receivables@meridian.demo",
  };

  const daysBeforeDue = options.overrideDaysBeforeDue ?? settings.days_before_due;
  const { provider, isLiveEmailConfigured } = getNotificationProvider(settings.sender_email);

  // Find active positive-balance customer-visible installments due within [referenceDate, referenceDate + daysBeforeDue]
  const candidatesRes = await db.query<{
    id: string;
    organization_id: string;
    organization_name: string;
    policyholder_name: string;
    policy_number: string;
    endorsement: string;
    insurer: string;
    insurance_type: string;
    installment_number: number;
    total_installments: number;
    outstanding_balance_brl: string;
    current_due_date: string;
    recipient_email: string | null;
  }>(
    `select
       i.id,
       i.organization_id,
       o.name as organization_name,
       ph.name as policyholder_name,
       p.policy_number,
       p.endorsement,
       p.insurer,
       p.insurance_type,
       i.installment_number,
       i.total_installments,
       i.outstanding_balance_brl::text,
       i.current_due_date::text,
       (
         select pr.email from public.profiles pr
         where pr.organization_id = i.organization_id and pr.role = 'customer'
         order by pr.created_at asc limit 1
       ) as recipient_email
     from public.installments i
     join public.policies p on p.id = i.policy_id
     join public.organizations o on o.id = i.organization_id
     join public.policyholders ph on ph.id = p.policyholder_id
    where i.is_customer_visible = true
      and i.amount_brl > 0
      and i.outstanding_balance_brl > 0
      and i.payment_status not in ('paid', 'cancelled')
      and i.current_due_date >= $1::date
      and i.current_due_date <= ($1::date + ($2:: int))
    order by i.current_due_date asc`,
    [referenceDate, daysBeforeDue]
  );

  let generatedCount = 0;
  let sentCount = 0;
  let demoLoggedCount = 0;
  let skippedExistingCount = 0;

  for (const c of candidatesRes.rows) {
    const existing = await db.query<{ id: string }>(
      `select id from public.reminders
        where installment_id = $1 and due_date = $2::date and days_before_due = $3
        limit 1`,
      [c.id, c.current_due_date, daysBeforeDue]
    );
    if (existing.rows.length > 0) {
      skippedExistingCount++;
      continue;
    }

    const outBrl = Number(c.outstanding_balance_brl);
    const subject = `[Meridian Receivables] Upcoming Installment ${c.installment_number}/${c.total_installments} — Policy ${c.policy_number} due ${formatBrDate(c.current_due_date)}`;
    const bodyText = `Dear ${c.organization_name} Finance Team,\n\nThis is a reminder that installment ${c.installment_number}/${c.total_installments} for policy ${c.policy_number} (${c.policyholder_name} — ${c.insurer}, ${c.insurance_type}) in the amount of ${formatBrl(outBrl)} is due on ${formatBrDate(c.current_due_date)}.\n\nOnce paid, you can upload your payment receipt directly in the Meridian Receivables Portal so our team can verify clearing with ${c.insurer}.`;

    const delivery = await provider.sendReminder({
      toEmail: c.recipient_email,
      recipientLabel: `${c.organization_name} Treasury`,
      subject,
      bodyText,
    });

    await db.query(
      `insert into public.reminders (
        installment_id, organization_id, due_date, days_before_due,
        recipient_label, recipient_email, subject, body_preview,
        amount_brl, status, provider, provider_msg_id, error_message,
        generated_at, sent_at, triggered_by
      ) values (
        $1, $2, $3::date, $4,
        $5, $6, $7, $8,
        $9, $10::public.reminder_status, $11, $12, $13,
        now(), $14, $15
      ) on conflict (installment_id, due_date, days_before_due) do nothing`,
      [
        c.id,
        c.organization_id,
        c.current_due_date,
        daysBeforeDue,
        `${c.organization_name} Treasury`,
        c.recipient_email ?? `treasury@${c.organization_name.toLowerCase().replace(/[^a-z0-9]/g, "")}.demo`,
        subject,
        bodyText,
        outBrl,
        delivery.status,
        delivery.provider,
        delivery.providerMessageId ?? null,
        delivery.errorMessage ?? null,
        delivery.delivered ? new Date().toISOString() : null,
        options.triggeredBy ?? null,
      ]
    );

    generatedCount++;
    if (delivery.status === "sent") sentCount++;
    else demoLoggedCount++;
  }

  return {
    referenceDate,
    daysBeforeDue,
    isLiveEmailConfigured,
    generatedCount,
    sentCount,
    demoLoggedCount,
    skippedExistingCount,
  };
}
