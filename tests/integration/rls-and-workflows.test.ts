import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, createMigratedPGlite } from "../../src/lib/db/pglite-harness";
import {
  DEMO_USERS,
  ensureSeededDatabase,
} from "../../src/lib/import/seed-scenarios";
import {
  parseReceivablesWorkbook,
  type ParsedWorkbookResult,
} from "../../src/lib/import/parser";
import { syncWorkbookToDatabase } from "../../src/lib/import/sync";

describe("PostgreSQL Row Level Security (RLS), Confidentiality & End-to-End Workflows", () => {
  let db: PGlite;
  let parsedWorkbook: ParsedWorkbookResult;

  beforeAll(async () => {
    db = await createMigratedPGlite();
    const excelPath = path.resolve(
      process.cwd(),
      "meridian-receivables-2026-11-02.xlsx"
    );
    const buffer = fs.readFileSync(excelPath);
    parsedWorkbook = await parseReceivablesWorkbook(buffer, {
      fileName: "meridian-receivables-2026-11-02.xlsx",
    });
    await ensureSeededDatabase(db, { workbookPath: excelPath });
  }, 60000);

  it("enforces strict cross-organization isolation for customer users", async () => {
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const res = await tx.query<{ organization_name: string }>(`
        select distinct organization_name from public.customer_installments
      `);
      expect(res.rows.map((r) => r.organization_name)).toEqual(["Grupo Atlântica"]);

      // Cannot read Grupo Serra Verde or Construtora Pilar rows from base table either
      const otherOrgsRes = await tx.query<{ cnt: string }>(`
        select count(*)::text as cnt
        from public.installments i
        join public.organizations o on o.id = i.organization_id
        where o.name <> 'Grupo Atlântica'
      `);
      expect(Number(otherOrgsRes.rows[0].cnt)).toBe(0);
    });
  });

  it("isolates Joint-Venture policyholder (Terminal Portuário Sul S.A.) per corporate group", async () => {
    // Grupo Atlântica sees only its 35 installments for Terminal Portuário Sul S.A.
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const res = await tx.query<{ cnt: string }>(`
        select count(*)::text as cnt
        from public.customer_installments
        where policyholder_tax_id = '85.551.345/0001-10'
      `);
      expect(Number(res.rows[0].cnt)).toBe(35);
    });

    // Grupo Serra Verde sees only its 14 installments for Terminal Portuário Sul S.A.
    await asUser(db, DEMO_USERS.serraVerde.id, async (tx) => {
      const res = await tx.query<{ cnt: string }>(`
        select count(*)::text as cnt
        from public.customer_installments
        where policyholder_tax_id = '85.551.345/0001-10'
      `);
      expect(Number(res.rows[0].cnt)).toBe(14);
    });
  });

  it("blocks customer users from accessing Internal Notes, Checked By, Sent to Client On, and internal audit logs", async () => {
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const notesRes = await tx.query(`select * from public.internal_notes`);
      expect(notesRes.rows.length).toBe(0);

      const trackingRes = await tx.query(
        `select * from public.installment_internal_tracking`
      );
      expect(trackingRes.rows.length).toBe(0);

      const verificationsRes = await tx.query(
        `select * from public.payment_verifications`
      );
      expect(verificationsRes.rows.length).toBe(0);

      const dqRes = await tx.query(`select * from public.data_quality_issues`);
      expect(dqRes.rows.length).toBe(0);

      const batchesRes = await tx.query(`select * from public.import_batches`);
      expect(batchesRes.rows.length).toBe(0);

      const internalLogsRes = await tx.query(
        `select * from public.activity_logs where visibility = 'internal'`
      );
      expect(internalLogsRes.rows.length).toBe(0);
    });
  });

  it("hides held-back rows (is_customer_visible = false) from customers until approved by staff", async () => {
    // Find a held-back row belonging to Grupo Atlântica
    const heldRes = await db.query<{ id: string }>(`
      select i.id
      from public.installments i
      join public.organizations o on o.id = i.organization_id
      where o.name = 'Grupo Atlântica' and i.is_customer_visible = false
      limit 1
    `);
    expect(heldRes.rows.length).toBe(1);
    const heldId = heldRes.rows[0].id;

    // Customer cannot see it while held
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const res = await tx.query(
        `select id from public.customer_installments where id = $1`,
        [heldId]
      );
      expect(res.rows.length).toBe(0);
    });

    // Employee approves it
    await asUser(db, DEMO_USERS.employee.id, async (tx) => {
      await tx.query(
        `update public.installments
            set is_customer_visible = true, data_quality_status = 'approved'
          where id = $1`,
        [heldId]
      );
    });

    // Customer can now see it
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const res = await tx.query(
        `select id from public.customer_installments where id = $1`,
        [heldId]
      );
      expect(res.rows.length).toBe(1);
    });

    // Restore held state
    await db.query(
      `update public.installments set is_customer_visible = false, data_quality_status = 'held' where id = $1`,
      [heldId]
    );
  });

  it("enforces partial payment & insurer verification rules (unconfirmed receipt never reduces balance)", async () => {
    // Inspect seeded Partial Payment scenario: Policy 01.18.0004471 Installment 6/10
    const instRes = await db.query<{
      id: string;
      amount_brl: string;
      confirmed_paid_brl: string;
      outstanding_balance_brl: string;
      payment_status: string;
    }>(`
      select i.id, i.amount_brl::text, i.confirmed_paid_brl::text,
             i.outstanding_balance_brl::text, i.payment_status::text
      from public.installments i
      join public.policies p on p.id = i.policy_id
      where p.policy_number = '01.18.0004471' and i.installment_number = 6
      limit 1
    `);

    const inst = instRes.rows[0];
    expect(inst).toBeDefined();
    const totalBrl = Number(inst.amount_brl);
    const confirmedBrl = Number(inst.confirmed_paid_brl);
    const outstandingBrl = Number(inst.outstanding_balance_brl);
    expect(confirmedBrl).toBeGreaterThan(0);
    expect(outstandingBrl).toBeCloseTo(totalBrl - confirmedBrl, 2);
    expect(inst.payment_status).toBe("partially_paid");

    // Now Meridian employee confirms the second receipt with insurer
    await asUser(db, DEMO_USERS.employee.id, async (tx) => {
      await tx.query(
        `update public.payments
            set verification_status = 'confirmed',
                confirmed_amount_brl = amount_brl,
                insurer_confirmation_date = '2026-11-04'::date
          where installment_id = $1 and verification_status in ('submitted', 'under_review')`,
        [inst.id]
      );
      await tx.query(`select app.recalculate_installment_financials($1::uuid)`, [
        inst.id,
      ]);
    });

    const afterRes = await db.query<{
      confirmed_paid_brl: string;
      outstanding_balance_brl: string;
      payment_status: string;
    }>(
      `select confirmed_paid_brl::text, outstanding_balance_brl::text, payment_status::text
       from public.installments where id = $1`,
      [inst.id]
    );
    expect(Number(afterRes.rows[0].confirmed_paid_brl)).toBeCloseTo(totalBrl, 2);
    expect(Number(afterRes.rows[0].outstanding_balance_brl)).toBe(0);
    expect(afterRes.rows[0].payment_status).toBe("paid");
  });

  it("prevents customers from self-approving extensions and preserves multi-attempt extension history", async () => {
    // Check Policy 01.18.0004471 Installment 5/10 (has Attempt #1 approved for 2026-11-15 and Attempt #2 awaiting_response for 2026-11-30)
    const instRes = await db.query<{
      id: string;
      original_due_date: string;
      extended_due_date: string;
      current_due_date: string;
    }>(`
      select i.id, i.original_due_date::text, i.extended_due_date::text, i.current_due_date::text
      from public.installments i
      join public.policies p on p.id = i.policy_id
      where p.policy_number = '01.18.0004471' and i.installment_number = 5
      limit 1
    `);
    const inst = instRes.rows[0];
    expect(inst.original_due_date).toBe("2026-10-10");
    expect(inst.extended_due_date).toBe("2026-11-15");
    expect(inst.current_due_date).toBe("2026-11-15");

    // Customer cannot self-approve an extension via UPDATE
    await asUser(db, DEMO_USERS.atlantica.id, async (tx) => {
      const updateAttempt = await tx.query(
        `update public.extensions set status = 'approved' where installment_id = $1 returning id`,
        [inst.id]
      );
      expect(updateAttempt.rows.length).toBe(0);
    });

    // Employee approves Attempt #2 for 2026-11-30; Attempt #1 remains intact and original_due_date is never overwritten
    await asUser(db, DEMO_USERS.employee.id, async (tx) => {
      await tx.query(
        `update public.extensions
            set status = 'approved', approved_due_date = '2026-11-30'::date
          where installment_id = $1 and attempt_number = 2`,
        [inst.id]
      );
      await tx.query(
        `update public.installments
            set extended_due_date = '2026-11-30'::date,
                current_due_date = '2026-11-30'::date
          where id = $1`,
        [inst.id]
      );
    });

    const extHistory = await db.query<{
      attempt_number: number;
      status: string;
      approved_due_date: string;
    }>(
      `select attempt_number, status::text, approved_due_date::text
       from public.extensions where installment_id = $1 order by attempt_number asc`,
      [inst.id]
    );
    expect(extHistory.rows.length).toBe(2);
    expect(extHistory.rows[0].attempt_number).toBe(1);
    expect(extHistory.rows[0].approved_due_date).toBe("2026-11-15");
    expect(extHistory.rows[1].attempt_number).toBe(2);
    expect(extHistory.rows[1].approved_due_date).toBe("2026-11-30");

    const updatedInst = await db.query<{
      original_due_date: string;
      extended_due_date: string;
      current_due_date: string;
    }>(
      `select original_due_date::text, extended_due_date::text, current_due_date::text
       from public.installments where id = $1`,
      [inst.id]
    );
    expect(updatedInst.rows[0].original_due_date).toBe("2026-10-10");
    expect(updatedInst.rows[0].extended_due_date).toBe("2026-11-30");
    expect(updatedInst.rows[0].current_due_date).toBe("2026-11-30");
  });

  it("executes idempotent re-imports without duplicating installments or erasing portal workflows", async () => {
    const countBeforeRes = await db.query<{ cnt: string }>(
      `select count(*)::text as cnt from public.installments`
    );
    const countBefore = Number(countBeforeRes.rows[0].cnt);

    const reimportSummary = await syncWorkbookToDatabase(db, parsedWorkbook, {
      actorLabel: "Test Suite Idempotent Re-Import",
      detectMissingRows: false,
    });

    expect(reimportSummary.isIdempotentReimport).toBe(true);
    expect(reimportSummary.importedRows).toBe(0);

    const countAfterRes = await db.query<{ cnt: string }>(
      `select count(*)::text as cnt from public.installments`
    );
    expect(Number(countAfterRes.rows[0].cnt)).toBe(countBefore);
  });
});
