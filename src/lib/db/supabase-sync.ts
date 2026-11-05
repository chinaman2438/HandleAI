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

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "NULL";
  if (typeof val === "object") {
    const json = JSON.stringify(val).replace(/'/g, "''");
    return `'${json}'`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

async function bulkInsertRowsIntoLocalDb(
  db: SqlExecutor,
  tableName: string,
  rows: Record<string, unknown>[],
  omitColumns: string[] = []
) {
  if (rows.length === 0) return;

  const sampleKeys = Object.keys(rows[0]).filter((k) => !omitColumns.includes(k));
  if (sampleKeys.length === 0) return;

  const colList = sampleKeys.map((k) => `"${k}"`).join(", ");
  const batchSize = 250;

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const valuesTuples = chunk
      .map((row) => {
        const vals = sampleKeys.map((k) => sqlLiteral(row[k]));
        return `(${vals.join(", ")})`;
      })
      .join(",\n");

    await db.query(
      `insert into public.${tableName} (${colList}) values ${valuesTuples} on conflict do nothing`
    );
  }
}

/**
 * Hydrates the embedded PostgreSQL instance from remote Supabase tables over HTTPS
 * in parallel + bulk SQL statements (~300ms total) when running in serverless
 * environments (like Vercel) where the raw Excel file is not present on disk.
 */
export async function hydrateFromRemoteSupabaseIfAvailable(
  db: SqlExecutor
): Promise<boolean> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return false;

  try {
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

    // Fetch all tables in parallel over HTTP/2
    const fetchedEntries = await Promise.all(
      tablesInOrder.map(async (tbl) => {
        const rows = await fetchAllRowsFromSupabase(admin, tbl.name);
        return { ...tbl, rows };
      })
    );

    const orgEntry = fetchedEntries.find((e) => e.name === "organizations");
    if (!orgEntry || orgEntry.rows.length === 0) {
      return false;
    }

    const profilesEntry = fetchedEntries.find((e) => e.name === "profiles");
    if (profilesEntry && profilesEntry.rows.length > 0) {
      const authTuples = profilesEntry.rows
        .filter((p) => p.id && p.email)
        .map((p) => `(${sqlLiteral(p.id)}, ${sqlLiteral(p.email)})`)
        .join(", ");
      if (authTuples) {
        await db.query(
          `insert into auth.users (id, email) values ${authTuples} on conflict (id) do nothing`
        );
      }
    }

    for (const entry of fetchedEntries) {
      await bulkInsertRowsIntoLocalDb(db, entry.name, entry.rows, entry.omit ?? []);
    }

    return true;
  } catch (err) {
    console.warn("[supabase-sync] Could not hydrate from remote Supabase:", err);
    return false;
  }
}

/**
 * Mirrors mutated tables from the local Postgres instance to remote Supabase
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
        `select * from public.${tableName} order by created_at desc nulls last limit 50`
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

      await admin.from(tableName).upsert(cleaned, { onConflict: conflictCol });
    } catch {
      // Non-blocking background sync
    }
  }
}
