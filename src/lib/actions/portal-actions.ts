"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  requireAdminUser,
  requireCustomerUser,
  requireStaffUser,
} from "../auth/session";
import { DEMO_USERS } from "../auth/demo-users";
import { getServiceDb, withRlsSession } from "../db/engine";
import {
  mirrorBatchUploadToRemoteSupabase,
  mirrorTablesToRemoteSupabase,
  getRemoteSupabaseClient,
  resetDeltaSyncThrottle,
  uploadDocumentBlob,
} from "../db/supabase-sync";
import { parseReceivablesWorkbook, normalizeGroupKey } from "../import/parser";
import { syncWorkbookToDatabase } from "../import/sync";
import { generateUpcomingReminders } from "../reminders/service";
import { formatBrl, formatBrDate } from "../format";

// ---------------------------------------------------------------------------
// 1. Authentication Actions
// ---------------------------------------------------------------------------

export async function loginAsDemoUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    redirect("/login?error=invalid_user");
  }

  const demoMatch = Object.values(DEMO_USERS).find((u) => u.id === userId);
  let resolvedId = demoMatch?.id ?? null;
  let resolvedRole: string | null = demoMatch?.role ?? null;

  if (!resolvedId || !resolvedRole) {
    const db = await getServiceDb();
    const res = await db.query<{ id: string; role: string }>(
      `select id, role::text from public.profiles where id = $1 limit 1`,
      [userId]
    );
    const profile = res.rows[0];
    if (!profile) {
      redirect("/login?error=user_not_found");
    }
    resolvedId = profile.id;
    resolvedRole = profile.role;
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, resolvedId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  if (resolvedRole === "employee" || resolvedRole === "admin") {
    redirect("/internal/dashboard");
  } else {
    redirect("/dashboard");
  }
}

const EmailLoginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export async function loginWithEmailAction(formData: FormData) {
  const parsed = EmailLoginSchema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid_credentials");
  }

  const lowerEmail = parsed.data.email.toLowerCase();
  const demoMatch = Object.values(DEMO_USERS).find(
    (u) => u.email.toLowerCase() === lowerEmail
  );

  let resolvedId = demoMatch?.id ?? null;
  let resolvedRole: string | null = demoMatch?.role ?? null;

  if (!resolvedId || !resolvedRole) {
    const db = await getServiceDb();
    const res = await db.query<{ id: string; role: string }>(
      `select id, role::text from public.profiles where lower(email) = lower($1) limit 1`,
      [parsed.data.email]
    );

    const profile = res.rows[0];
    if (!profile) {
      redirect("/login?error=invalid_credentials");
    }
    resolvedId = profile.id;
    resolvedRole = profile.role;
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, resolvedId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  if (resolvedRole === "employee" || resolvedRole === "admin") {
    redirect("/internal/dashboard");
  } else {
    redirect("/dashboard");
  }
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

// ---------------------------------------------------------------------------
// 2. Customer Portal Actions (RLS-Enforced + Zod Validated)
// ---------------------------------------------------------------------------

const SubmitReceiptSchema = z.object({
  installmentId: z.string().uuid(),
  amountPaidBrl: z.coerce.number().positive("Amount paid must be greater than zero."),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Valid payment date is required."),
  comment: z.string().max(1000).optional(),
});

export async function submitPaymentReceiptAction(formData: FormData) {
  const user = await requireCustomerUser();

  const parsed = SubmitReceiptSchema.safeParse({
    installmentId: formData.get("installmentId"),
    amountPaidBrl: formData.get("amountPaidBrl"),
    paymentDate: formData.get("paymentDate"),
    comment: formData.get("comment") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const file = formData.get("receiptFile") as File | null;
  const fileName =
    file && file.size > 0
      ? file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      : `Comprovante-Pagamento-${parsed.data.paymentDate}.pdf`;
  const rawMime = file && file.size > 0 && file.type ? file.type.toLowerCase() : "";
  const allowedMimes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  const mimeType = allowedMimes.includes(rawMime) ? rawMime : "application/pdf";
  const sizeBytes = file && file.size > 0 ? file.size : 84200;

  const docId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const uploadedBuffer =
    file && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null;
  let savedStoragePath: string | null = null;

  await withRlsSession(user.id, async (tx) => {
    // Verify installment belongs to customer's organization via RLS
    const instRes = await tx.query<{
      id: string;
      organization_id: string;
      policy_number: string;
      installment_number: number;
      total_installments: number;
    }>(
      `select id, organization_id, policy_number, installment_number, total_installments
         from public.customer_installments
        where id = $1
        limit 1`,
      [parsed.data.installmentId]
    );
    const inst = instRes.rows[0];
    if (!inst) {
      throw new Error("Installment not found or access denied.");
    }

    const storagePath = `org/${inst.organization_id}/receipts/${inst.id}/${Date.now()}-${fileName}`;
    savedStoragePath = storagePath;

    // 1. Insert document record
    await tx.query(
      `insert into public.documents (
        id, installment_id, organization_id, uploaded_by, storage_path,
        file_name, mime_type, size_bytes, document_type, visibility
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'payment_receipt', 'customer')`,
      [
        docId,
        inst.id,
        inst.organization_id,
        user.id,
        storagePath,
        fileName,
        mimeType,
        sizeBytes,
      ]
    );

    // 2. Insert payment record with verification_status = 'submitted' (NEVER auto-confirmed!)
    // Avoid `RETURNING id` because customers do not have a direct SELECT policy on `public.payments`
    // (they read via the security-definer `public.customer_payments` view).
    await tx.query(
      `insert into public.payments (
        id, installment_id, organization_id, amount_brl, payment_date,
        receipt_document_id, verification_status, customer_comment,
        submitted_by, submitted_via
      ) values ($1, $2, $3, $4, $5::date, $6, 'submitted', $7, $8, 'customer_portal')`,
      [
        paymentId,
        inst.id,
        inst.organization_id,
        parsed.data.amountPaidBrl,
        parsed.data.paymentDate,
        docId,
        parsed.data.comment ?? null,
        user.id,
      ]
    );

    // 3. Create payment_receipt exception for Meridian review queue
    await tx.query(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, requested_amount, payment_id, created_by
      ) values ($1, $2, 'payment_receipt', 'pending_review', 'normal', $3, $4, $5, $6)`,
      [
        inst.id,
        inst.organization_id,
        `Payment receipt uploaded (${fileName}) for ${formatBrl(parsed.data.amountPaidBrl)} paid on ${formatBrDate(parsed.data.paymentDate)}.${parsed.data.comment ? ` Note: ${parsed.data.comment}` : ""}`,
        parsed.data.amountPaidBrl,
        paymentId,
        user.id,
      ]
    );
  });

  if (uploadedBuffer && savedStoragePath) {
    await uploadDocumentBlob(savedStoragePath, uploadedBuffer, mimeType);
  }

  // Log activity in service context (since activity_logs write policy is staff/service)
  const sdb = await getServiceDb();
  await sdb.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, new_values, description
    ) values ($1, $2, $3, $4, 'installment', $4, 'payment_receipt_submitted', 'customer', $5::jsonb, $6)`,
    [
      user.id,
      user.fullName,
      user.organizationId,
      parsed.data.installmentId,
      JSON.stringify({
        amountPaidBrl: parsed.data.amountPaidBrl,
        paymentDate: parsed.data.paymentDate,
        fileName,
        status: "under_review",
      }),
      `Payment receipt (${fileName}) submitted for ${formatBrl(parsed.data.amountPaidBrl)} paid on ${formatBrDate(parsed.data.paymentDate)}. Status: Awaiting insurer confirmation.`,
    ]
  );

  resetDeltaSyncThrottle();
  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/requests");
  revalidatePath("/documents");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/payments");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

const RequestExtensionSchema = z.object({
  installmentId: z.string().uuid(),
  requestedDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Proposed due date is required."),
  reason: z.string().min(5, "Please explain the reason for the extension request.").max(2000),
});

export async function submitExtensionRequestAction(formData: FormData) {
  const user = await requireCustomerUser();

  const parsed = RequestExtensionSchema.safeParse({
    installmentId: formData.get("installmentId"),
    requestedDueDate: formData.get("requestedDueDate"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  let newAttemptNumber = 1;
  let currentDueDate: string | null = null;

  await withRlsSession(user.id, async (tx) => {
    const instRes = await tx.query<{
      id: string;
      organization_id: string;
      insurer: string;
      current_due_date: string | null;
    }>(
      `select id, organization_id, insurer, current_due_date::text
         from public.customer_installments
        where id = $1
        limit 1`,
      [parsed.data.installmentId]
    );
    const inst = instRes.rows[0];
    if (!inst) {
      throw new Error("Installment not found or access denied.");
    }
    currentDueDate = inst.current_due_date;

    const maxAttemptRes = await tx.query<{ max_attempt: number | null }>(
      `select max(attempt_number) as max_attempt from public.extensions where installment_id = $1`,
      [inst.id]
    );
    newAttemptNumber = (maxAttemptRes.rows[0]?.max_attempt ?? 0) + 1;

    // Insert new extension attempt with status = 'requested' and approved_due_date = NULL
    const extRes = await tx.query<{ id: string }>(
      `insert into public.extensions (
        installment_id, organization_id, attempt_number,
        requested_due_date, approved_due_date, previous_due_date,
        request_reason, insurer, status, requested_by, requested_via
      ) values (
        $1, $2, $3,
        $4::date, null, $5::date,
        $6, $7, 'requested', $8, 'customer_portal'
      ) returning id`,
      [
        inst.id,
        inst.organization_id,
        newAttemptNumber,
        parsed.data.requestedDueDate,
        inst.current_due_date,
        parsed.data.reason,
        inst.insurer,
        user.id,
      ]
    );

    await tx.query(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, extension_id, created_by
      ) values ($1, $2, 'extension_request', 'pending_review', $3, $4, $5, $6)`,
      [
        inst.id,
        inst.organization_id,
        newAttemptNumber >= 2 ? "high" : "normal",
        `Extension request (Attempt #${newAttemptNumber}) proposing new due date ${formatBrDate(parsed.data.requestedDueDate)}. Reason: ${parsed.data.reason}`,
        extRes.rows[0].id,
        user.id,
      ]
    );
  });

  const sdb = await getServiceDb();
  await sdb.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, old_values, new_values, description
    ) values ($1, $2, $3, $4, 'installment', $4, 'extension_requested', 'customer', $5::jsonb, $6::jsonb, $7)`,
    [
      user.id,
      user.fullName,
      user.organizationId,
      parsed.data.installmentId,
      JSON.stringify({ currentDueDate }),
      JSON.stringify({
        attemptNumber: newAttemptNumber,
        requestedDueDate: parsed.data.requestedDueDate,
        status: "requested",
      }),
      `Extension Attempt #${newAttemptNumber} requested for ${formatBrDate(parsed.data.requestedDueDate)} (Awaiting insurer approval; current due date remains ${formatBrDate(currentDueDate)}).`,
    ]
  );

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/requests");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/extensions");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

const SubmitDisputeSchema = z.object({
  installmentId: z.string().uuid(),
  expectedAmountBrl: z.coerce.number().nonnegative("Expected amount must be zero or positive."),
  description: z.string().min(5, "Please explain the amount discrepancy.").max(2000),
});

export async function submitAmountDisputeAction(formData: FormData) {
  const user = await requireCustomerUser();

  const parsed = SubmitDisputeSchema.safeParse({
    installmentId: formData.get("installmentId"),
    expectedAmountBrl: formData.get("expectedAmountBrl"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const file = formData.get("supportFile") as File | null;
  const disputeFileBuffer =
    file && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null;
  let disputeStoragePath: string | null = null;
  const disputeMimeType = (file && file.type) || "application/pdf";

  await withRlsSession(user.id, async (tx) => {
    const instRes = await tx.query<{
      id: string;
      organization_id: string;
      amount_brl: string;
    }>(
      `select id, organization_id, amount_brl::text
         from public.customer_installments
        where id = $1
        limit 1`,
      [parsed.data.installmentId]
    );
    const inst = instRes.rows[0];
    if (!inst) {
      throw new Error("Installment not found or access denied.");
    }

    const excRes = await tx.query<{ id: string }>(
      `insert into public.exceptions (
        installment_id, organization_id, type, status, priority,
        description, requested_amount, created_by
      ) values ($1, $2, 'amount_dispute', 'pending_review', 'high', $3, $4, $5)
      returning id`,
      [
        inst.id,
        inst.organization_id,
        parsed.data.description,
        parsed.data.expectedAmountBrl,
        user.id,
      ]
    );

    if (file && file.size > 0) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `org/${inst.organization_id}/disputes/${excRes.rows[0].id}/${Date.now()}-${safeName}`;
      disputeStoragePath = storagePath;
      await tx.query(
        `insert into public.documents (
          installment_id, exception_id, organization_id, uploaded_by,
          storage_path, file_name, mime_type, size_bytes, document_type, visibility
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'dispute_support', 'customer')`,
        [
          inst.id,
          excRes.rows[0].id,
          inst.organization_id,
          user.id,
          storagePath,
          safeName,
          disputeMimeType,
          file.size,
        ]
      );
    }
  });

  if (disputeFileBuffer && disputeStoragePath) {
    await uploadDocumentBlob(disputeStoragePath, disputeFileBuffer, disputeMimeType);
  }

  const sdb = await getServiceDb();
  await sdb.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, new_values, description
    ) values ($1, $2, $3, $4, 'installment', $4, 'dispute_opened', 'customer', $5::jsonb, $6)`,
    [
      user.id,
      user.fullName,
      user.organizationId,
      parsed.data.installmentId,
      JSON.stringify({
        expectedAmountBrl: parsed.data.expectedAmountBrl,
        description: parsed.data.description,
      }),
      `Amount dispute opened by customer (expected ${formatBrl(parsed.data.expectedAmountBrl)}): ${parsed.data.description}`,
    ]
  );

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/requests");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/disputes");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

// ---------------------------------------------------------------------------
// 3. Meridian Employee & Admin Actions (Server-Side Privileged Operations)
// ---------------------------------------------------------------------------

const VerifyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  installmentId: z.string().uuid(),
  decision: z.enum(["confirmed", "rejected", "under_review"]),
  confirmedAmountBrl: z.coerce.number().nonnegative(),
  insurerConfirmationDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export async function verifyPaymentWithInsurerAction(formData: FormData) {
  const staff = await requireStaffUser();

  const parsed = VerifyPaymentSchema.safeParse({
    paymentId: formData.get("paymentId"),
    installmentId: formData.get("installmentId"),
    decision: formData.get("decision"),
    confirmedAmountBrl: formData.get("confirmedAmountBrl") ?? 0,
    insurerConfirmationDate: formData.get("insurerConfirmationDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();

  const instBefore = await db.query<{
    id: string;
    organization_id: string;
    amount_brl: string;
    outstanding_balance_brl: string;
    payment_status: string;
  }>(
    `select id, organization_id, amount_brl::text, outstanding_balance_brl::text, payment_status::text
       from public.installments where id = $1 limit 1`,
    [parsed.data.installmentId]
  );
  const before = instBefore.rows[0];
  if (!before) throw new Error("Installment not found.");

  const confirmDate =
    parsed.data.insurerConfirmationDate || new Date().toISOString().slice(0, 10);

  await db.query(
    `update public.payments
        set verification_status = $2::public.verification_status,
            confirmed_amount_brl = case when $2 = 'confirmed' then $3 else null end,
            insurer_confirmation_date = case when $2 = 'confirmed' then $4::date else null end,
            verified_by = $5,
            verified_at = now(),
            notes = coalesce($6, notes),
            updated_at = now()
      where id = $1`,
    [
      parsed.data.paymentId,
      parsed.data.decision,
      parsed.data.confirmedAmountBrl,
      confirmDate,
      staff.id,
      parsed.data.notes ?? null,
    ]
  );

  // Trigger recalculates confirmed_paid_brl, outstanding_balance_brl, and payment_status
  await db.query(`select app.recalculate_installment_financials($1::uuid)`, [
    parsed.data.installmentId,
  ]);

  const instAfter = await db.query<{
    outstanding_balance_brl: string;
    confirmed_paid_brl: string;
    payment_status: string;
  }>(
    `select outstanding_balance_brl::text, confirmed_paid_brl::text, payment_status::text
       from public.installments where id = $1 limit 1`,
    [parsed.data.installmentId]
  );
  const after = instAfter.rows[0];
  const remainingBrl = Number(after?.outstanding_balance_brl ?? "0");

  await db.query(
    `insert into public.payment_verifications (
      payment_id, installment_id, checked_by, checked_at,
      insurer_confirmed, confirmed_amount_brl, remaining_balance_brl,
      insurer_confirmation_date, notes
    ) values ($1, $2, $3, now(), $4, $5, $6, $7::date, $8)`,
    [
      parsed.data.paymentId,
      parsed.data.installmentId,
      staff.id,
      parsed.data.decision === "confirmed",
      parsed.data.decision === "confirmed" ? parsed.data.confirmedAmountBrl : 0,
      remainingBrl,
      confirmDate,
      parsed.data.notes ?? null,
    ]
  );

  // Record Checked By entry in internal tracking
  const initials = staff.fullName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const ddMm = `${confirmDate.slice(8, 10)}/${confirmDate.slice(5, 7)}`;
  await db.query(
    `insert into public.installment_internal_tracking (
      installment_id, checked_by_raw, recorded_by
    ) values ($1, $2, $3)`,
    [parsed.data.installmentId, `${initials} ${ddMm}`, staff.id]
  );

  // Update linked payment_receipt exception
  await db.query(
    `update public.exceptions
        set status = $2::public.exception_status,
            resolution = $3,
            resolved_at = case when $2 in ('approved', 'rejected', 'resolved') then now() else null end,
            updated_at = now()
      where payment_id = $1`,
    [
      parsed.data.paymentId,
      parsed.data.decision === "confirmed"
        ? "resolved"
        : parsed.data.decision === "rejected"
          ? "rejected"
          : "pending_review",
      parsed.data.decision === "confirmed"
        ? `Insurer confirmed receipt of ${formatBrl(parsed.data.confirmedAmountBrl)} on ${formatBrDate(confirmDate)}. Remaining installment balance: ${formatBrl(remainingBrl)}.`
        : parsed.data.decision === "rejected"
          ? `Insurer could not confirm receipt. Please verify payment voucher.`
          : `Under insurer review.`,
    ]
  );

  // Customer-visible activity log
  await db.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, old_values, new_values, description
    ) values ($1, $2, $3, $4, 'payment', $5, $6, 'customer', $7::jsonb, $8::jsonb, $9)`,
    [
      staff.id,
      staff.fullName,
      before.organization_id,
      parsed.data.installmentId,
      parsed.data.paymentId,
      parsed.data.decision === "confirmed" ? "payment_confirmed" : "payment_reviewed",
      JSON.stringify({
        previousOutstandingBrl: Number(before.outstanding_balance_brl),
        previousStatus: before.payment_status,
      }),
      JSON.stringify({
        verificationStatus: parsed.data.decision,
        confirmedAmountBrl: parsed.data.confirmedAmountBrl,
        remainingBalanceBrl: remainingBrl,
        installmentStatus: after?.payment_status,
      }),
      parsed.data.decision === "confirmed"
        ? `Insurer confirmed payment of ${formatBrl(parsed.data.confirmedAmountBrl)} on ${formatBrDate(confirmDate)}. Remaining balance: ${formatBrl(remainingBrl)} (Installment status: ${after?.payment_status}).`
        : `Payment receipt reviewed (${parsed.data.decision}). Remaining confirmed balance: ${formatBrl(remainingBrl)}.`,
    ]
  );

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/receivables");
  revalidatePath("/internal/payments");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

const ManageExtensionSchema = z.object({
  extensionId: z.string().uuid(),
  installmentId: z.string().uuid(),
  actionType: z.enum(["submit_to_insurer", "approve", "reject"]),
  approvedDueDate: z.string().optional(),
  protocolNumber: z.string().max(120).optional(),
  responseNotes: z.string().max(2000).optional(),
});

export async function manageExtensionWorkflowAction(formData: FormData) {
  const staff = await requireStaffUser();

  const parsed = ManageExtensionSchema.safeParse({
    extensionId: formData.get("extensionId"),
    installmentId: formData.get("installmentId"),
    actionType: formData.get("actionType"),
    approvedDueDate: formData.get("approvedDueDate") || undefined,
    protocolNumber: formData.get("protocolNumber") || undefined,
    responseNotes: formData.get("responseNotes") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();

  const extRes = await db.query<{
    id: string;
    organization_id: string;
    attempt_number: number;
    requested_due_date: string;
    insurer: string;
    protocol_number: string | null;
  }>(
    `select id, organization_id, attempt_number, requested_due_date::text, insurer, protocol_number
       from public.extensions where id = $1 limit 1`,
    [parsed.data.extensionId]
  );
  const ext = extRes.rows[0];
  if (!ext) throw new Error("Extension request not found.");

  const instRes = await db.query<{
    original_due_date: string | null;
    extended_due_date: string | null;
    current_due_date: string | null;
  }>(
    `select original_due_date::text, extended_due_date::text, current_due_date::text
       from public.installments where id = $1 limit 1`,
    [parsed.data.installmentId]
  );
  const inst = instRes.rows[0];

  if (parsed.data.actionType === "submit_to_insurer") {
    await db.query(
      `update public.extensions
          set status = 'awaiting_response',
              submitted_to_insurer_at = coalesce(submitted_to_insurer_at, now()),
              protocol_number = coalesce($2, protocol_number),
              response_notes = coalesce($3, response_notes),
              updated_at = now()
        where id = $1`,
      [
        ext.id,
        parsed.data.protocolNumber ?? null,
        parsed.data.responseNotes ?? "Submitted to insurer underwriting desk; awaiting decision.",
      ]
    );

    await db.query(
      `update public.exceptions
          set status = 'awaiting_insurer',
              customer_response = $2,
              updated_at = now()
        where extension_id = $1`,
      [
        ext.id,
        `Extension request #${ext.attempt_number} submitted to ${ext.insurer}${parsed.data.protocolNumber ? ` (Protocol ${parsed.data.protocolNumber})` : ""}. Current due date remains ${formatBrDate(inst?.current_due_date)} until insurer confirmation.`,
      ]
    );

    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, new_values, description
      ) values ($1, $2, $3, $4, 'extension', $5, 'extension_submitted_to_insurer', 'customer', $6::jsonb, $7)`,
      [
        staff.id,
        staff.fullName,
        ext.organization_id,
        parsed.data.installmentId,
        ext.id,
        JSON.stringify({
          attemptNumber: ext.attempt_number,
          protocolNumber: parsed.data.protocolNumber ?? ext.protocol_number,
          status: "awaiting_response",
        }),
        `Extension request #${ext.attempt_number} submitted to ${ext.insurer}${parsed.data.protocolNumber ? ` (Protocol ${parsed.data.protocolNumber})` : ""}. Awaiting insurer response; current due date remains ${formatBrDate(inst?.current_due_date)}.`,
      ]
    );
  } else if (parsed.data.actionType === "approve") {
    const approvedDate = parsed.data.approvedDueDate || ext.requested_due_date;
    const protocol = parsed.data.protocolNumber || ext.protocol_number || `PROT-${Date.now().toString().slice(-6)}`;

    await db.query(
      `update public.extensions
          set status = 'approved',
              approved_due_date = $2::date,
              protocol_number = $3,
              submitted_to_insurer_at = coalesce(submitted_to_insurer_at, now()),
              insurer_response_at = now(),
              response_notes = coalesce($4, response_notes),
              updated_at = now()
        where id = $1`,
      [
        ext.id,
        approvedDate,
        protocol,
        parsed.data.responseNotes ??
          (approvedDate !== ext.requested_due_date
            ? `Insurer approved ${formatBrDate(approvedDate)} (requested ${formatBrDate(ext.requested_due_date)}) under protocol ${protocol}.`
            : `Insurer approved new due date ${formatBrDate(approvedDate)} under protocol ${protocol}.`),
      ]
    );

    // Update installment's extended_due_date and current_due_date (NEVER overwrite original_due_date!)
    await db.query(
      `update public.installments
          set extended_due_date = $2::date,
              current_due_date = $2::date,
              updated_at = now()
        where id = $1`,
      [parsed.data.installmentId, approvedDate]
    );

    const diffNote =
      approvedDate !== ext.requested_due_date
        ? `Note: ${ext.insurer} approved ${formatBrDate(approvedDate)} rather than the requested ${formatBrDate(ext.requested_due_date)}.`
        : "";

    await db.query(
      `update public.exceptions
          set status = 'approved',
              customer_response = $2,
              resolution = $2,
              resolved_at = now(),
              updated_at = now()
        where extension_id = $1`,
      [
        ext.id,
        `Confirmed by ${ext.insurer} (Protocol ${protocol}): new official due date is ${formatBrDate(approvedDate)}. ${diffNote}`.trim(),
      ]
    );

    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, old_values, new_values, description
      ) values ($1, $2, $3, $4, 'extension', $5, 'extension_approved', 'customer', $6::jsonb, $7::jsonb, $8)`,
      [
        staff.id,
        staff.fullName,
        ext.organization_id,
        parsed.data.installmentId,
        ext.id,
        JSON.stringify({
          previousDueDate: inst?.current_due_date,
          requestedDueDate: ext.requested_due_date,
        }),
        JSON.stringify({
          approvedDueDate: approvedDate,
          protocolNumber: protocol,
          attemptNumber: ext.attempt_number,
        }),
        `${ext.insurer} approved extension #${ext.attempt_number}: new due date is ${formatBrDate(approvedDate)} (requested ${formatBrDate(ext.requested_due_date)}, Protocol ${protocol}).`,
      ]
    );
  } else if (parsed.data.actionType === "reject") {
    const protocol = parsed.data.protocolNumber || ext.protocol_number || null;

    await db.query(
      `update public.extensions
          set status = 'rejected',
              protocol_number = coalesce($2, protocol_number),
              insurer_response_at = now(),
              response_notes = coalesce($3, 'Insurer declined extension request.'),
              updated_at = now()
        where id = $1`,
      [ext.id, protocol, parsed.data.responseNotes ?? null]
    );

    await db.query(
      `update public.exceptions
          set status = 'rejected',
              customer_response = $2,
              resolution = $2,
              resolved_at = now(),
              updated_at = now()
        where extension_id = $1`,
      [
        ext.id,
        `${ext.insurer} declined extension request #${ext.attempt_number}${protocol ? ` (Protocol ${protocol})` : ""}. Official due date remains ${formatBrDate(inst?.current_due_date)}. ${parsed.data.responseNotes ?? ""}`.trim(),
      ]
    );

    await db.query(
      `insert into public.activity_logs (
        actor_id, actor_label, organization_id, installment_id,
        entity_type, entity_id, action, visibility, new_values, description
      ) values ($1, $2, $3, $4, 'extension', $5, 'extension_rejected', 'customer', $6::jsonb, $7)`,
      [
        staff.id,
        staff.fullName,
        ext.organization_id,
        parsed.data.installmentId,
        ext.id,
        JSON.stringify({
          attemptNumber: ext.attempt_number,
          protocolNumber: protocol,
          currentDueDate: inst?.current_due_date,
        }),
        `${ext.insurer} declined extension #${ext.attempt_number}${protocol ? ` (Protocol ${protocol})` : ""}. Current due date remains ${formatBrDate(inst?.current_due_date)}.`,
      ]
    );
  }

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/requests");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/extensions");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

const ResolveDisputeSchema = z.object({
  exceptionId: z.string().uuid(),
  installmentId: z.string().uuid(),
  status: z.enum(["awaiting_insurer", "awaiting_customer", "resolved", "rejected"]),
  endorsementReference: z.string().max(300).optional(),
  insurerBreakdownReceivedOn: z.string().optional(),
  customerResponse: z.string().min(5, "Customer response / explanation is required.").max(3000),
});

export async function resolveAmountDisputeAction(formData: FormData) {
  const staff = await requireStaffUser();

  const parsed = ResolveDisputeSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    installmentId: formData.get("installmentId"),
    status: formData.get("status"),
    endorsementReference: formData.get("endorsementReference") || undefined,
    insurerBreakdownReceivedOn: formData.get("insurerBreakdownReceivedOn") || undefined,
    customerResponse: formData.get("customerResponse"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const breakdownFile = formData.get("breakdownFile") as File | null;
  const db = await getServiceDb();

  const excRes = await db.query<{ organization_id: string }>(
    `select organization_id from public.exceptions where id = $1 limit 1`,
    [parsed.data.exceptionId]
  );
  const orgId = excRes.rows[0]?.organization_id;
  if (!orgId) throw new Error("Dispute record not found.");

  await db.query(
    `update public.exceptions
        set status = $2::public.exception_status,
            endorsement_reference = coalesce($3, endorsement_reference),
            insurer_breakdown_received_on = coalesce($4::date, insurer_breakdown_received_on),
            customer_response = $5,
            resolution = case when $2 in ('resolved', 'rejected') then $5 else resolution end,
            resolved_at = case when $2 in ('resolved', 'rejected') then now() else resolved_at end,
            updated_at = now()
      where id = $1`,
    [
      parsed.data.exceptionId,
      parsed.data.status,
      parsed.data.endorsementReference ?? null,
      parsed.data.insurerBreakdownReceivedOn ?? null,
      parsed.data.customerResponse,
    ]
  );

  if (breakdownFile && breakdownFile.size > 0) {
    const safeName = breakdownFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `org/${orgId}/disputes/${parsed.data.exceptionId}/${Date.now()}-${safeName}`;
    const breakdownMime = breakdownFile.type || "application/pdf";
    const breakdownBuffer = Buffer.from(await breakdownFile.arrayBuffer());
    await db.query(
      `insert into public.documents (
        installment_id, exception_id, organization_id, uploaded_by,
        storage_path, file_name, mime_type, size_bytes, document_type, visibility
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'insurer_breakdown', 'customer')`,
      [
        parsed.data.installmentId,
        parsed.data.exceptionId,
        orgId,
        staff.id,
        storagePath,
        safeName,
        breakdownMime,
        breakdownFile.size,
      ]
    );
    await uploadDocumentBlob(storagePath, breakdownBuffer, breakdownMime);
  }

  await db.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, new_values, description
    ) values ($1, $2, $3, $4, 'exception', $5, $6, 'customer', $7::jsonb, $8)`,
    [
      staff.id,
      staff.fullName,
      orgId,
      parsed.data.installmentId,
      parsed.data.exceptionId,
      parsed.data.status === "resolved" ? "dispute_resolved" : "dispute_updated",
      JSON.stringify({
        status: parsed.data.status,
        endorsementReference: parsed.data.endorsementReference,
        insurerBreakdownReceivedOn: parsed.data.insurerBreakdownReceivedOn,
      }),
      `Meridian update on amount dispute (${parsed.data.status}): ${parsed.data.customerResponse}`,
    ]
  );

  revalidatePath("/dashboard");
  revalidatePath(`/installments/${parsed.data.installmentId}`);
  revalidatePath("/requests");
  revalidatePath("/documents");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/disputes");
  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
}

const AddInternalNoteSchema = z.object({
  installmentId: z.string().uuid(),
  content: z.string().min(2, "Note cannot be empty.").max(4000),
});

export async function addInternalNoteAction(formData: FormData) {
  const staff = await requireStaffUser();
  const parsed = AddInternalNoteSchema.safeParse({
    installmentId: formData.get("installmentId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();
  const instRes = await db.query<{ policy_id: string; organization_id: string }>(
    `select policy_id, organization_id from public.installments where id = $1 limit 1`,
    [parsed.data.installmentId]
  );
  const inst = instRes.rows[0];
  if (!inst) throw new Error("Installment not found.");

  await db.query(
    `insert into public.internal_notes (installment_id, policy_id, author_id, source, content)
     values ($1, $2, $3, 'manual', $4)`,
    [parsed.data.installmentId, inst.policy_id, staff.id, parsed.data.content]
  );

  // STRICTLY INTERNAL activity log
  await db.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, description
    ) values ($1, $2, $3, $4, 'installment', $4, 'internal_note_added', 'internal', $5)`,
    [
      staff.id,
      staff.fullName,
      inst.organization_id,
      parsed.data.installmentId,
      `Internal note added by ${staff.fullName}: "${parsed.data.content}"`,
    ]
  );

  revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
  revalidatePath("/internal/receivables");
}

const ResolveDqIssueSchema = z.object({
  issueId: z.string().uuid(),
  installmentId: z.string().uuid().optional(),
  resolutionAction: z.enum([
    "approve_for_customer",
    "swap_dates_and_approve",
    "mark_missing_paid",
    "mark_missing_cancelled",
    "mark_missing_omitted",
    "dismiss",
  ]),
  policyholderName: z.string().optional(),
  amountBrl: z.coerce.number().optional(),
  resolutionNotes: z.string().min(3, "Please provide resolution notes.").max(2000),
});

export async function resolveDataQualityIssueAction(formData: FormData) {
  const staff = await requireStaffUser();

  const parsed = ResolveDqIssueSchema.safeParse({
    issueId: formData.get("issueId"),
    installmentId: formData.get("installmentId") || undefined,
    resolutionAction: formData.get("resolutionAction"),
    policyholderName: formData.get("policyholderName") || undefined,
    amountBrl: formData.get("amountBrl") || undefined,
    resolutionNotes: formData.get("resolutionNotes"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();

  if (parsed.data.installmentId) {
    const instRes = await db.query<{
      id: string;
      policy_id: string;
      organization_id: string;
      original_due_date: string | null;
      extended_due_date: string | null;
      amount_brl: string;
    }>(
      `select id, policy_id, organization_id, original_due_date::text, extended_due_date::text, amount_brl::text
         from public.installments where id = $1 limit 1`,
      [parsed.data.installmentId]
    );
    const inst = instRes.rows[0];

    if (inst) {
      if (parsed.data.policyholderName && parsed.data.policyholderName.trim() !== "") {
        await db.query(
          `update public.policyholders
              set name = $2, updated_at = now()
            where id = (select policyholder_id from public.policies where id = $1)`,
          [inst.policy_id, parsed.data.policyholderName.trim()]
        );
      }

      if (parsed.data.resolutionAction === "swap_dates_and_approve") {
        await db.query(
          `update public.installments
              set original_due_date = extended_due_date,
                  extended_due_date = original_due_date,
                  current_due_date = original_due_date,
                  is_customer_visible = true,
                  data_quality_status = 'approved',
                  updated_at = now()
            where id = $1`,
          [inst.id]
        );
      } else if (parsed.data.resolutionAction === "approve_for_customer") {
        await db.query(
          `update public.installments
              set amount_brl = coalesce($2, amount_brl),
                  is_customer_visible = true,
                  data_quality_status = 'approved',
                  updated_at = now()
            where id = $1`,
          [inst.id, parsed.data.amountBrl ?? null]
        );
        await db.query(`select app.recalculate_installment_financials($1::uuid)`, [inst.id]);
      } else if (parsed.data.resolutionAction === "mark_missing_paid") {
        await db.query(
          `update public.installments
              set payment_status = 'paid',
                  source_status = 'paid',
                  paid_source = 'investigation',
                  confirmed_paid_brl = greatest(confirmed_paid_brl, amount_brl),
                  outstanding_balance_brl = 0,
                  is_missing_from_latest = false,
                  is_customer_visible = true,
                  updated_at = now()
            where id = $1`,
          [inst.id]
        );
      } else if (parsed.data.resolutionAction === "mark_missing_cancelled") {
        await db.query(
          `update public.installments
              set payment_status = 'cancelled',
                  source_status = 'cancelled',
                  cancellation_source = 'Employee investigation',
                  cancellation_reason = $2,
                  cancelled_at = now(),
                  is_missing_from_latest = false,
                  is_customer_visible = false,
                  updated_at = now()
            where id = $1`,
          [inst.id, parsed.data.resolutionNotes]
        );
      } else if (parsed.data.resolutionAction === "mark_missing_omitted") {
        await db.query(
          `update public.installments
              set payment_status = 'open',
                  is_missing_from_latest = false,
                  is_customer_visible = true,
                  updated_at = now()
            where id = $1`,
          [inst.id]
        );
      }

      await db.query(
        `insert into public.activity_logs (
          actor_id, actor_label, organization_id, installment_id,
          entity_type, entity_id, action, visibility, description
        ) values ($1, $2, $3, $4, 'installment', $4, 'data_quality_resolved', 'internal', $5)`,
        [
          staff.id,
          staff.fullName,
          inst.organization_id,
          inst.id,
          `Data-quality exception resolved (${parsed.data.resolutionAction}): ${parsed.data.resolutionNotes}`,
        ]
      );
    }
  }

  const targetDqStatus = parsed.data.resolutionAction === "dismiss" ? "dismissed" : "resolved";

  await db.query(
    `update public.data_quality_issues
        set status = $2::public.dq_status,
            resolution_notes = $3,
            resolved_by = $4,
            resolved_at = now(),
            updated_at = now()
      where id = $1`,
    [
      parsed.data.issueId,
      targetDqStatus,
      parsed.data.resolutionNotes,
      staff.id,
    ]
  );

  const admin = await getRemoteSupabaseClient();
  if (admin) {
    try {
      const nowIso = new Date().toISOString();
      const { error: dqErr } = await admin.from("data_quality_issues").update({
        status: targetDqStatus,
        resolution_notes: parsed.data.resolutionNotes,
        resolved_by: staff.id,
        resolved_at: nowIso,
        updated_at: nowIso,
      }).eq("id", parsed.data.issueId);
      if (dqErr) {
        console.warn("[portal-actions] Supabase data_quality_issues update warning:", dqErr.message);
      }

      if (parsed.data.installmentId) {
        const instRes = await db.query<Record<string, unknown>>(
          `select * from public.installments where id = $1`,
          [parsed.data.installmentId]
        );
        const iRow = instRes.rows[0];
        if (iRow) {
          const { is_credit: _omit1, import_row_id: _omit2, ...cleanedInst } = iRow;
          const { error: instErr } = await admin.from("installments").upsert({
            ...cleanedInst,
            updated_at: nowIso,
          }, { onConflict: "id" });
          if (instErr) {
            console.warn("[portal-actions] Supabase installments upsert warning:", instErr.message);
          }

          if (cleanedInst.policy_id) {
            const polRes = await db.query<Record<string, unknown>>(
              `select * from public.policies where id = $1`,
              [cleanedInst.policy_id]
            );
            if (polRes.rows[0]) {
              await admin.from("policies").upsert(polRes.rows[0], { onConflict: "id" });
              if (polRes.rows[0].policyholder_id) {
                const phRes = await db.query<Record<string, unknown>>(
                  `select * from public.policyholders where id = $1`,
                  [polRes.rows[0].policyholder_id]
                );
                if (phRes.rows[0]) {
                  await admin.from("policyholders").upsert(phRes.rows[0], { onConflict: "id" });
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[portal-actions] Direct Supabase resolution update warning:", err);
    }
  }

  resetDeltaSyncThrottle();

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/receivables");
  revalidatePath("/internal/data-quality");
  if (parsed.data.installmentId) {
    revalidatePath(`/internal/installments/${parsed.data.installmentId}`);
  }
}

const ResolveMissingInstallmentSchema = z.object({
  installmentId: z.string().uuid(),
  resolutionAction: z.enum([
    "return_open",
    "paid_keep_hidden",
    "return_cancelled",
  ]),
  resolutionNotes: z.string().max(2000).optional(),
});

export async function resolveMissingInstallmentAction(formData: FormData) {
  const staff = await requireStaffUser();

  const rawNotes = String(formData.get("resolutionNotes") ?? "").trim();
  const parsed = ResolveMissingInstallmentSchema.safeParse({
    installmentId: formData.get("installmentId"),
    resolutionAction: formData.get("resolutionAction"),
    resolutionNotes: rawNotes || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();
  const instRes = await db.query<{
    id: string;
    policy_id: string;
    organization_id: string;
  }>(
    `select id, policy_id, organization_id from public.installments where id = $1 limit 1`,
    [parsed.data.installmentId]
  );
  const inst = instRes.rows[0];
  if (!inst) {
    throw new Error("Installment not found.");
  }

  const noteSummary =
    parsed.data.resolutionNotes ||
    (parsed.data.resolutionAction === "return_open"
      ? "Returned to report as Open (visible to customer)."
      : parsed.data.resolutionAction === "paid_keep_hidden"
        ? "Confirmed Paid & kept hidden from customer report."
        : "Returned to report as Cancelled (visible to customer).");

  if (parsed.data.resolutionAction === "return_open") {
    await db.query(
      `update public.installments
          set payment_status = 'open',
              source_status = 'open',
              is_missing_from_latest = false,
              is_customer_visible = true,
              missing_since = coalesce(missing_since, current_date),
              updated_at = now()
        where id = $1`,
      [inst.id]
    );
  } else if (parsed.data.resolutionAction === "paid_keep_hidden") {
    await db.query(
      `update public.installments
          set payment_status = 'paid',
              source_status = 'paid',
              paid_source = 'investigation',
              confirmed_paid_brl = greatest(confirmed_paid_brl, amount_brl),
              outstanding_balance_brl = 0,
              is_missing_from_latest = false,
              is_customer_visible = false,
              missing_since = coalesce(missing_since, current_date),
              updated_at = now()
        where id = $1`,
      [inst.id]
    );
  } else if (parsed.data.resolutionAction === "return_cancelled") {
    await db.query(
      `update public.installments
          set payment_status = 'cancelled',
              source_status = 'cancelled',
              cancellation_source = 'Employee investigation',
              cancellation_reason = $2,
              cancelled_at = now(),
              is_missing_from_latest = false,
              is_customer_visible = true,
              missing_since = coalesce(missing_since, current_date),
              updated_at = now()
        where id = $1`,
      [inst.id, noteSummary]
    );
  }

  await db.query(
    `update public.data_quality_issues
        set status = 'resolved'::public.dq_status,
            resolution_notes = $2,
            resolved_by = $3,
            resolved_at = now(),
            updated_at = now()
      where installment_id = $1
        and status = 'open'
        and issue_code in ('missing_overdue_from_report', 'missing_from_latest_report')`,
    [inst.id, noteSummary, staff.id]
  );

  await db.query(
    `insert into public.activity_logs (
      actor_id, actor_label, organization_id, installment_id,
      entity_type, entity_id, action, visibility, description
    ) values ($1, $2, $3, $4, 'installment', $4, 'missing_installment_resolved', 'internal', $5)`,
    [
      staff.id,
      staff.fullName,
      inst.organization_id,
      inst.id,
      `Missing installment resolved (${parsed.data.resolutionAction}): ${noteSummary}`,
    ]
  );

  const admin = await getRemoteSupabaseClient();
  if (admin) {
    try {
      const nowIso = new Date().toISOString();
      const updatedInstRes = await db.query<Record<string, unknown>>(
        `select * from public.installments where id = $1`,
        [inst.id]
      );
      const iRow = updatedInstRes.rows[0];
      if (iRow) {
        const { is_credit: _omit1, import_row_id: _omit2, ...cleanedInst } = iRow;
        const { error: instErr } = await admin.from("installments").upsert(
          {
            ...cleanedInst,
            updated_at: nowIso,
          },
          { onConflict: "id" }
        );
        if (instErr) {
          console.warn(
            "[portal-actions] Supabase missing installment upsert warning:",
            instErr.message
          );
        }
      }
    } catch (err) {
      console.warn("[portal-actions] Direct Supabase missing installment update warning:", err);
    }
  }

  resetDeltaSyncThrottle();

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/receivables");
  revalidatePath("/internal/missing-installments");
  revalidatePath("/internal/data-quality");
  revalidatePath(`/internal/installments/${inst.id}`);
}

export async function uploadExcelSpreadsheetAction(formData: FormData) {
  const staff = await requireStaffUser();
  const file = formData.get("excelFile") as File | null;
  const overrideDate = String(formData.get("snapshotDate") ?? "").trim() || undefined;

  if (!file || file.size === 0) {
    throw new Error("Please select an Excel (.xlsx) file to upload.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const parsed = await parseReceivablesWorkbook(arrayBuffer, {
    fileName: file.name,
    overrideSnapshotDate: overrideDate,
  });

  const db = await getServiceDb({ skipMirror: true });
  await db.query(
    `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
    [staff.id, staff.email]
  );
  const batchResult = await syncWorkbookToDatabase(db, parsed, {
    actorId: staff.id,
    actorLabel: `${staff.fullName} (Portal Upload)`,
    detectMissingRows: true,
  });
  await mirrorBatchUploadToRemoteSupabase(db, batchResult.batchId);

  revalidatePath("/dashboard");
  revalidatePath("/installments");
  revalidatePath("/internal/dashboard");
  revalidatePath("/internal/receivables");
  revalidatePath("/internal/imports");
  revalidatePath("/internal/data-quality");
  revalidatePath("/internal/reports");
  revalidatePath("/internal/cancellation-risk");

  return batchResult;
}

export async function runRemindersAction(formData: FormData) {
  const staff = await requireStaffUser();
  const daysOverrideRaw = formData.get("daysBeforeDue");
  const daysOverride = daysOverrideRaw ? Number(daysOverrideRaw) : undefined;

  const db = await getServiceDb({ skipMirror: true });
  if (daysOverride && Number.isFinite(daysOverride) && daysOverride >= 1 && daysOverride <= 30) {
    await db.query(
      `update public.reminder_settings
          set days_before_due = $1, updated_by = $2, updated_at = now()
        where id = 'default'`,
      [daysOverride, staff.id]
    );
  }

  await generateUpcomingReminders(db, {
    overrideDaysBeforeDue: daysOverride,
    triggeredBy: staff.id,
  });
  await mirrorTablesToRemoteSupabase(db, ["reminder_settings", "reminders"]);

  revalidatePath("/internal/reminders");
  revalidatePath("/dashboard");
}

const CreateUserOrOrgSchema = z.object({
  organizationName: z.string().min(2).max(120),
  userEmail: z.string().email().optional().or(z.literal("")),
  userFullName: z.string().max(120).optional(),
  userRole: z.enum(["customer", "employee", "admin"]).default("customer"),
});

export async function createOrgAndUserAction(formData: FormData) {
  await requireAdminUser();

  const parsed = CreateUserOrOrgSchema.safeParse({
    organizationName: String(formData.get("organizationName") ?? "").trim(),
    userEmail: String(formData.get("userEmail") ?? "").trim(),
    userFullName: String(formData.get("userFullName") ?? "").trim() || undefined,
    userRole: String(formData.get("userRole") ?? "customer"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = await getServiceDb();
  const norm = normalizeGroupKey(parsed.data.organizationName);

  const orgRes = await db.query<{ id: string }>(
    `insert into public.organizations (name, normalized_name)
     values ($1, $2)
     on conflict (normalized_name) do update set name = excluded.name, updated_at = now()
     returning id`,
    [parsed.data.organizationName, norm]
  );
  const orgId = orgRes.rows[0].id;

  if (parsed.data.userEmail) {
    const newIdRes = await db.query<{ id: string }>(`select gen_random_uuid()::text as id`);
    const newId = newIdRes.rows[0].id;

    try {
      await db.query(
        `insert into auth.users (id, email) values ($1, $2) on conflict (email) do nothing`,
        [newId, parsed.data.userEmail]
      );
    } catch {
      // Ignore if auth.users is managed externally
    }

    const userRow = await db.query<{ id: string }>(
      `select id from auth.users where lower(email) = lower($1) limit 1`,
      [parsed.data.userEmail]
    );

    if (userRow.rows[0]) {
      await db.query(
        `insert into public.profiles (id, organization_id, full_name, email, role)
         values ($1, $2, $3, $4, $5::public.app_role)
         on conflict (id) do update
           set organization_id = excluded.organization_id,
               full_name = excluded.full_name,
               role = excluded.role`,
        [
          userRow.rows[0].id,
          parsed.data.userRole === "customer" ? orgId : null,
          parsed.data.userFullName || parsed.data.userEmail,
          parsed.data.userEmail,
          parsed.data.userRole,
        ]
      );
    }
  }

  revalidatePath("/internal/customers");
  revalidatePath("/login");
}
