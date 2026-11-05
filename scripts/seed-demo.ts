import path from "node:path";
import dotenv from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createMigratedPGlite } from "../src/lib/db/pglite-harness";
import { ensureSeededDatabase } from "../src/lib/import/seed-scenarios";
import { generateUpcomingReminders } from "../src/lib/reminders/service";
import { DEMO_USERS } from "../src/lib/auth/demo-users";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function upsertTableInChunks(
  admin: SupabaseClient,
  tableName: string,
  rows: Record<string, unknown>[],
  conflictColumn = "id",
  chunkSize = 250
) {
  if (rows.length === 0) {
    console.log(`[db:seed -> supabase] ${tableName}: 0 rows (skipped)`);
    return;
  }

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await admin
      .from(tableName)
      .upsert(chunk, { onConflict: conflictColumn });
    if (error) {
      throw new Error(
        `Failed upserting into public.${tableName} (chunk ${i}..${i + chunk.length}): ${error.message} (${error.code})`
      );
    }
  }
  console.log(`[db:seed -> supabase] ${tableName}: synced ${rows.length} rows`);
}

async function main() {
  console.log("[db:seed] Initializing database and seeding workbook + demo scenarios...");
  const db = await createMigratedPGlite();
  await ensureSeededDatabase(db);
  await generateUpcomingReminders(db, { overrideDaysBeforeDue: 7 });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const demoPassword = process.env.DEMO_USER_PASSWORD || "Meridian2026!";

  if (supabaseUrl && serviceRoleKey) {
    console.log(
      `[db:seed] Remote Supabase detected (${supabaseUrl}) — syncing Auth users and all 22 tables via SUPABASE_SERVICE_ROLE_KEY...`
    );
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Check if schema exists in remote Supabase
    const probe = await admin.from("organizations").select("id").limit(1);
    if (probe.error && (probe.error.code === "PGRST205" || probe.error.message.includes("schema cache") || probe.error.message.includes("does not exist"))) {
      console.error(
        "\n[db:seed] ERROR: The tables do not exist yet in your remote Supabase project!\n" +
          "Please open your Supabase Dashboard -> SQL Editor, paste the contents of `supabase/full-schema.sql`, click Run, and then re-run `npm run db:seed`.\n"
      );
      process.exit(1);
    }

    // 1. Ensure Demo Auth Users exist with exact matching UUIDs
    const { data: existingList, error: listErr } = await admin.auth.admin.listUsers({
      perPage: 200,
    });
    if (listErr) {
      console.warn("[db:seed] Warning listing auth users:", listErr.message);
    }
    const byEmail = new Map(
      (existingList?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u])
    );

    for (const demo of Object.values(DEMO_USERS)) {
      const existing = byEmail.get(demo.email.toLowerCase());
      if (existing && existing.id !== demo.id) {
        await admin.auth.admin.deleteUser(existing.id);
      }
      if (!existing || existing.id !== demo.id) {
        const { error } = await admin.auth.admin.createUser({
          id: demo.id,
          email: demo.email,
          password: demoPassword,
          email_confirm: true,
          user_metadata: { full_name: demo.fullName, role: demo.role },
        });
        if (error && !error.message.toLowerCase().includes("already")) {
          console.warn(`[db:seed] Could not create auth user ${demo.email}:`, error.message);
        } else {
          console.log(`[db:seed -> supabase auth] Provisioned ${demo.email} (${demo.id})`);
        }
      } else {
        console.log(`[db:seed -> supabase auth] Verified ${demo.email} (${demo.id})`);
      }
    }

    // 2. Sync all tables in foreign-key dependency order from our seeded Postgres instance
    const tablesToSync: { name: string; conflict: string; pass?: "initial_null_fk" | "final_fk" }[] = [
      { name: "organizations", conflict: "id" },
      { name: "policyholders", conflict: "id" },
      { name: "profiles", conflict: "id" },
      { name: "policies", conflict: "id" },
      { name: "import_batches", conflict: "id" },
      { name: "installments", conflict: "id", pass: "initial_null_fk" },
      { name: "import_rows", conflict: "id" },
      { name: "installments", conflict: "id", pass: "final_fk" },
      { name: "documents", conflict: "id", pass: "initial_null_fk" },
      { name: "payments", conflict: "id" },
      { name: "payment_allocations", conflict: "payment_id,installment_id" },
      { name: "payment_verifications", conflict: "id" },
      { name: "extensions", conflict: "id" },
      { name: "exceptions", conflict: "id" },
      { name: "documents", conflict: "id", pass: "final_fk" },
      { name: "exception_messages", conflict: "id" },
      { name: "internal_notes", conflict: "id" },
      { name: "installment_internal_tracking", conflict: "id" },
      { name: "activity_logs", conflict: "id" },
      { name: "installment_snapshots", conflict: "id" },
      { name: "data_quality_issues", conflict: "id" },
      { name: "risk_rules", conflict: "id" },
      { name: "reminder_settings", conflict: "id" },
      { name: "reminders", conflict: "id" },
    ];

    // Clean any partial prior sync in reverse dependency order so UUIDs stay 100% consistent
    const deleteOrder = [
      "reminders",
      "data_quality_issues",
      "installment_snapshots",
      "activity_logs",
      "installment_internal_tracking",
      "internal_notes",
      "exception_messages",
      "exceptions",
      "extensions",
      "payment_verifications",
      "payment_allocations",
      "payments",
      "documents",
      "import_rows",
      "installments",
      "import_batches",
      "policies",
      "profiles",
      "policyholders",
      "organizations",
    ];
    for (const tblName of deleteOrder) {
      if (tblName === "installments") {
        await admin
          .from("installments")
          .update({ import_row_id: null })
          .neq("id", "00000000-0000-0000-0000-000000000000");
      }
      await admin
        .from(tblName)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    }

    for (const tbl of tablesToSync) {
      const res = await db.query<Record<string, unknown>>(
        `select * from public.${tbl.name}`
      );
      let cleanedRows = res.rows;
      if (tbl.name === "installments") {
        cleanedRows = res.rows.map(({ is_credit: _omit, ...rest }) =>
          tbl.pass === "initial_null_fk" ? { ...rest, import_row_id: null } : rest
        );
      } else if (tbl.name === "documents" && tbl.pass === "initial_null_fk") {
        cleanedRows = res.rows.map((r) => ({ ...r, exception_id: null }));
      } else if (tbl.name === "payment_allocations") {
        cleanedRows = res.rows.map(({ id: _omit, ...rest }) => rest);
      }
      await upsertTableInChunks(admin, tbl.name, cleanedRows, tbl.conflict);
    }

    console.log("[db:seed -> supabase] All remote Supabase tables successfully populated!");
  } else {
    console.log(
      "[db:seed] SUPABASE_SERVICE_ROLE_KEY not set — demo users and data are seeded in the local PostgreSQL engine."
    );
  }

  const stats = await db.query<{
    orgs: string;
    policies: string;
    installments: string;
    visible_installments: string;
    held_installments: string;
    snapshots: string;
  }>(`
    select
      (select count(*)::text from public.organizations) as orgs,
      (select count(*)::text from public.policies) as policies,
      (select count(*)::text from public.installments) as installments,
      (select count(*)::text from public.installments where is_customer_visible = true) as visible_installments,
      (select count(*)::text from public.installments where is_customer_visible = false) as held_installments,
      (select count(*)::text from public.installment_snapshots) as snapshots
  `);

  console.log("[db:seed] Database summary:", stats.rows[0]);
}

main().catch((err) => {
  console.error("[db:seed] Failed:", err);
  process.exit(1);
});
