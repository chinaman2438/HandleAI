import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SqlExecutor } from "../import/sync";

export function getRemoteSupabaseAdmin(): SupabaseClient | null {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchAllRowsFromSupabase(
  admin: SupabaseClient,
  tableName: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from(tableName)
      .select("*")
      .range(from, from + pageSize - 1);

    if (error || !data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function insertRowsIntoLocalDb(
  db: SqlExecutor,
  tableName: string,
  rows: Record<string, unknown>[],
  omitColumns: string[] = []
) {
  if (rows.length === 0) return;

  for (const row of rows) {
    const entries = Object.entries(row).filter(
      ([k, v]) => !omitColumns.includes(k) && v !== undefined
    );
    if (entries.length === 0) continue;

    const cols = entries.map(([k]) => `"${k}"`).join(", ");
    const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
    const values = entries.map(([, v]) =>
      v !== null && typeof v === "object" ? JSON.stringify(v) : v
    );

    await db.query(
      `insert into public.${tableName} (${cols}) values (${placeholders}) on conflict do nothing`,
      values
    );
  }
}

/**
 * Hydrates the embedded PostgreSQL instance from remote Supabase tables over HTTPS
 * when running in serverless environments (like Vercel) where the raw Excel file
 * is not present on disk.
 */
export async function hydrateFromRemoteSupabaseIfAvailable(
  db: SqlExecutor
): Promise<boolean> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return false;

  try {
    const orgRows = await fetchAllRowsFromSupabase(admin, "organizations");
    if (orgRows.length === 0) return false;

    const profiles = await fetchAllRowsFromSupabase(admin, "profiles");
    for (const p of profiles) {
      if (p.id && p.email) {
        await db.query(
          `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
          [p.id, p.email]
        );
      }
    }

    const tablesInOrder: { name: string; omit?: string[] }[] = [
      { name: "organizations" },
      { name: "policyholders" },
      { name: "profiles" },
      { name: "policies" },
      { name: "import_batches" },
      { name: "installments", omit: ["is_credit", "import_row_id"] },
      { name: "import_rows" },
      { name: "documents", omit: ["exception_id"] },
      { name: "payments" },
      { name: "payment_verifications" },
      { name: "extensions" },
      { name: "exceptions" },
      { name: "exception_messages" },
      { name: "internal_notes" },
      { name: "installment_internal_tracking" },
      { name: "activity_logs" },
      { name: "installment_snapshots" },
      { name: "data_quality_issues" },
      { name: "risk_rules" },
      { name: "reminder_settings" },
      { name: "reminders" },
    ];

    for (const tbl of tablesInOrder) {
      const rows =
        tbl.name === "organizations"
          ? orgRows
          : tbl.name === "profiles"
            ? profiles
            : await fetchAllRowsFromSupabase(admin, tbl.name);
      await insertRowsIntoLocalDb(db, tbl.name, rows, tbl.omit ?? []);
    }

    return true;
  } catch (err) {
    console.warn("[supabase-sync] Could not hydrate from remote Supabase:", err);
    return false;
  }
}

/**
 * Mirrors specified tables from the local Postgres instance to remote Supabase
 * after a portal mutation so the Supabase dashboard stays in sync in real time.
 */
export async function mirrorTablesToRemoteSupabase(
  db: SqlExecutor,
  tableNames: string[]
): Promise<void> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return;

  for (const tableName of tableNames) {
    try {
      const res = await db.query<Record<string, unknown>>(
        `select * from public.${tableName}`
      );
      if (res.rows.length === 0) continue;

      const cleaned =
        tableName === "installments"
          ? res.rows.map(({ is_credit: _omit, import_row_id: _omit2, ...rest }) => rest)
          : tableName === "payment_allocations"
            ? res.rows.map(({ id: _omit, ...rest }) => rest)
            : res.rows;

      const conflictCol =
        tableName === "payment_allocations" ? "payment_id,installment_id" : "id";

      for (let i = 0; i < cleaned.length; i += 250) {
        const chunk = cleaned.slice(i, i + 250);
        await admin.from(tableName).upsert(chunk, { onConflict: conflictCol });
      }
    } catch {
      // Non-blocking background sync
    }
  }
}
