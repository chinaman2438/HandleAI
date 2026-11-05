import path from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getServiceDb } from "../src/lib/db/engine";
import { DEMO_USERS } from "../src/lib/import/seed-scenarios";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  console.log("[db:seed] Initializing database and seeding workbook + demo scenarios...");
  const db = await getServiceDb();

  // If SUPABASE_SERVICE_ROLE_KEY is present, also provision the demo accounts in Supabase Auth
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const demoPassword = process.env.DEMO_USER_PASSWORD || "Meridian2026!";

  if (supabaseUrl && serviceRoleKey) {
    console.log("[db:seed] SUPABASE_SERVICE_ROLE_KEY detected — provisioning demo users in Supabase Auth...");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const orgs = await db.query<{ id: string; normalized_name: string }>(
      `select id, normalized_name from public.organizations`
    );
    const orgByNorm = new Map(orgs.rows.map((o) => [o.normalized_name, o.id]));

    const { data: existingList } = await admin.auth.admin.listUsers({ perPage: 200 });
    const byEmail = new Map(
      (existingList?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u])
    );

    for (const demo of Object.values(DEMO_USERS)) {
      const existing = byEmail.get(demo.email.toLowerCase());
      let userId = existing?.id;

      if (!userId) {
        const { data: created, error } = await admin.auth.admin.createUser({
          email: demo.email,
          password: demoPassword,
          email_confirm: true,
          user_metadata: { full_name: demo.fullName, role: demo.role },
        });
        if (error) {
          console.warn(`[db:seed] Could not create auth user ${demo.email}:`, error.message);
          continue;
        }
        userId = created.user.id;
      }

      const orgId = demo.organizationNormalized
        ? orgByNorm.get(demo.organizationNormalized) ?? null
        : null;

      await db.query(
        `insert into public.profiles (id, organization_id, full_name, email, role)
         values ($1, $2, $3, $4, $5::public.app_role)
         on conflict (id) do update
           set organization_id = excluded.organization_id,
               full_name = excluded.full_name,
               email = excluded.email,
               role = excluded.role`,
        [userId, orgId, demo.fullName, demo.email, demo.role]
      );
      console.log(`[db:seed] Provisioned ${demo.email} (${demo.role})`);
    }
  } else {
    console.log(
      "[db:seed] SUPABASE_SERVICE_ROLE_KEY not set — demo users are seeded in the local PostgreSQL engine and available via One-Click Demo Login on /login."
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
