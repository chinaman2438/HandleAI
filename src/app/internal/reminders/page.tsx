import Link from "next/link";
import { Bell, Mail, Clock, CheckCircle2, Play, Calendar } from "lucide-react";
import { requireStaffUser } from "@/lib/auth/session";
import { getInternalRemindersData } from "@/lib/data/internal-queries";
import { runRemindersAction } from "@/lib/actions/portal-actions";
import { formatBrl, formatBrDate, formatBrDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InternalRemindersPage() {
  const user = await requireStaffUser();
  const { settings, history, upcomingInstallments } = await getInternalRemindersData(user);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Upcoming Payment Reminders & Notification Log
          </h1>
          <p className="text-sm text-slate-600">
            Configure lead days before due date, trigger reminder batches on demand or via scheduled cron, and audit generated vs. sent status.
          </p>
        </div>
      </div>

      {/* Mode & Configuration Banner */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Reminder Rule Configuration</h2>
              <p className="text-xs text-slate-500">
                Current lead window: <strong>{settings.daysBeforeDue} days</strong> before due date
              </p>
            </div>
          </div>

          <form action={runRemindersAction} className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Lead Days Before Official Due Date (<code>days_before_due</code>)
              </label>
              <input
                type="number"
                name="daysBeforeDue"
                min={1}
                max={30}
                defaultValue={settings.daysBeforeDue}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Evaluates open, positive-amount, customer-visible installments due within <code>[today, today + N days]</code>.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Delivery Mode:</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    settings.isLiveEmailConfigured
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {settings.isLiveEmailConfigured ? "Live Email (Resend)" : "Demo / In-Portal Mode"}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {settings.isLiveEmailConfigured
                  ? "RESEND_API_KEY is configured. Reminders are dispatched via email and marked 'sent' with sent_at timestamp."
                  : "No external email API key required for demo. Reminders are stored in public.reminders with status = 'generated' (generated_at set, sent_at = NULL) so demo mode never falsely claims an external email was delivered."}
              </p>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              Save Lead Window & Generate Reminders Now
            </button>
          </form>
        </div>

        {/* Upcoming Installments in Next 30 Days */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                Upcoming Installments Due Within 30 Days ({upcomingInstallments.length})
              </h2>
              <p className="text-xs text-slate-500">
                Installments due within <strong>{settings.daysBeforeDue} days</strong> are highlighted as eligible for the active reminder rule.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto max-h-80">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500 sticky top-0">
                <tr>
                  <th className="px-4 py-2.5">Due In</th>
                  <th className="px-4 py-2.5">Due Date</th>
                  <th className="px-4 py-2.5">Customer Group & Policyholder</th>
                  <th className="px-4 py-2.5">Policy & Insurer</th>
                  <th className="px-4 py-2.5">Inst.</th>
                  <th className="px-4 py-2.5 text-right">Balance BRL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {upcomingInstallments.map((u) => {
                  const isInWindow = u.daysUntilDue <= settings.daysBeforeDue;
                  return (
                    <tr
                      key={u.id}
                      className={isInWindow ? "bg-blue-50/50 hover:bg-blue-50" : "hover:bg-slate-50"}
                    >
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            isInWindow
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {u.daysUntilDue === 0 ? "Due Today" : `In ${u.daysUntilDue}d`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                        {formatBrDate(u.currentDueDate)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">{u.organizationName}</div>
                        <div className="text-slate-500">{u.policyholderName}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/internal/installments/${u.id}`}
                          className="font-mono font-semibold text-blue-600 hover:underline"
                        >
                          {u.policyNumber}
                        </Link>
                        <div className="text-slate-500">{u.insurer}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono">
                        {u.installmentNumber}/{u.totalInstallments}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                        {formatBrl(u.outstandingBalanceBrl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reminder History Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-600" />
              Generated & Sent Reminder Audit History ({history.length})
            </h2>
            <p className="text-xs text-slate-500">
              Deduplicated by <code>(installment_id, due_date, days_before_due)</code> so repeated runs never spam customers.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Status & Mode</th>
                <th className="px-4 py-3">Recipient Organization</th>
                <th className="px-4 py-3">Policy / Installment</th>
                <th className="px-4 py-3">Due Date & Rule</th>
                <th className="px-4 py-3 text-right">Amount BRL</th>
                <th className="px-4 py-3">Subject & Preview</th>
                <th className="px-4 py-3">Generated At</th>
                <th className="px-4 py-3">Sent At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {history.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 align-top">
                    {item.status === "sent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                        <CheckCircle2 className="h-3 w-3" /> Sent ({item.provider})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
                        <Clock className="h-3 w-3" /> Generated (In-Portal Demo)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-slate-900">{item.organizationName}</div>
                    <div className="text-slate-500">{item.policyholderName}</div>
                    {item.recipientEmail && (
                      <div className="font-mono text-[11px] text-slate-400">
                        {item.recipientEmail}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Link
                      href={`/internal/installments/${item.installmentId}`}
                      className="font-mono font-semibold text-blue-600 hover:underline"
                    >
                      {item.policyNumber}
                    </Link>
                    <div className="text-slate-500">
                      Inst. {item.installmentNumber}/{item.totalInstallments} • {item.insurer}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-mono font-semibold text-slate-900">
                      {formatBrDate(item.dueDate)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Rule: {item.daysBeforeDue}d before due
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-right font-mono font-bold text-slate-900">
                    {formatBrl(item.amountBrl)}
                  </td>
                  <td className="px-4 py-3 align-top max-w-sm">
                    <div className="font-semibold text-slate-900">{item.subject}</div>
                    <div className="mt-0.5 text-slate-500 line-clamp-2">{item.bodyPreview}</div>
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[11px] text-slate-600">
                    {formatBrDateTime(item.generatedAt)}
                  </td>
                  <td className="px-4 py-3 align-top font-mono text-[11px] text-slate-500">
                    {item.sentAt ? formatBrDateTime(item.sentAt) : "Not sent externally (Demo)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
