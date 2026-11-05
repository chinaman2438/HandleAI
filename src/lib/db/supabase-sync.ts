import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SqlExecutor } from "../import/sync";
import bundledSeedSnapshot from "./seed-snapshot.json";

export function getRemoteSupabaseAdmin(): SupabaseClient | null {
  const runtimeEnv = (globalThis.process?.env ?? {}) as Record<
    string,
    string | undefined
  >;

  let supabaseUrl = (
    runtimeEnv["NEXT_PUBLIC_SUPABASE_URL"] ||
    runtimeEnv["PUBLIC_SUPABASE_URL"] ||
    runtimeEnv["SUPABASE_URL"] ||
    ""
  ).trim();

  let serviceRoleKey = (
    runtimeEnv["SUPABASE_SERVICE_ROLE_KEY"] ||
    runtimeEnv["PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] ||
    runtimeEnv["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] ||
    runtimeEnv["SUPABASE_SECRET_KEY"] ||
    ""
  ).trim();

  if (!supabaseUrl || !serviceRoleKey) {
    for (const [k, v] of Object.entries(runtimeEnv)) {
      if (!v) continue;
      const trimmed = v.trim();
      if (!supabaseUrl && trimmed.startsWith("https://") && trimmed.includes(".supabase.co")) {
        supabaseUrl = trimmed;
      }
      if (
        !serviceRoleKey &&
        (trimmed.startsWith("sb_secret_") || /service_role|secret_key/i.test(k))
      ) {
        serviceRoleKey = trimmed;
      }
    }
  }

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllRowsFromSupabase(
  admin: SupabaseClient,
  tableName: string,
  options?: { maxRows?: number; orderBy?: string }
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = options?.maxRows ? Math.min(options.maxRows, 1000) : 1000;
  let from = 0;

  while (true) {
    let lastError: unknown = null;
    let pageData: Record<string, unknown>[] | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      let query = admin.from(tableName).select("*");
      if (options?.orderBy) {
        query = query.order(options.orderBy, { ascending: false });
      }
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (!error && data) {
        pageData = data as Record<string, unknown>[];
        lastError = null;
        break;
      }
      lastError = error;
      await sleep(attempt * 150);
    }

    if (lastError) {
      throw new Error(
        `Failed to fetch table ${tableName} at offset ${from}: ${JSON.stringify(lastError)}`
      );
    }

    if (!pageData || pageData.length === 0) break;
    all.push(...pageData);
    if (options?.maxRows && all.length >= options.maxRows) {
      return all.slice(0, options.maxRows);
    }
    if (pageData.length < pageSize) break;
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
 * with bounded concurrency and retry protection when running in serverless
 * environments (like Vercel).
 */
export async function hydrateFromRemoteSupabaseIfAvailable(
  db: SqlExecutor
): Promise<boolean> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return false;

  try {
    const tablesInOrder: {
      name: string;
      omit?: string[];
      maxRows?: number;
      orderBy?: string;
    }[] = [
      { name: "organizations" },
      { name: "policyholders" },
      { name: "profiles" },
      { name: "policies" },
      { name: "import_batches", omit: ["duplicate_of"] },
      { name: "installments", omit: ["is_credit", "import_row_id"] },
      { name: "documents", omit: ["exception_id"] },
      { name: "payments" },
      { name: "payment_verifications" },
      { name: "extensions" },
      { name: "exceptions" },
      { name: "exception_messages" },
      { name: "internal_notes" },
      { name: "installment_internal_tracking" },
      { name: "activity_logs", maxRows: 250, orderBy: "created_at" },
      { name: "installment_snapshots" },
      { name: "data_quality_issues", omit: ["import_row_id"] },
      { name: "risk_rules" },
      { name: "reminder_settings" },
      { name: "reminders" },
    ];

    // Fetch tables in controlled batches of 5 to avoid connection pool saturation
    const fetchedEntries: {
      name: string;
      omit?: string[];
      rows: Record<string, unknown>[];
    }[] = [];

    const concurrency = 5;
    for (let i = 0; i < tablesInOrder.length; i += concurrency) {
      const slice = tablesInOrder.slice(i, i + concurrency);
      const results = await Promise.all(
        slice.map(async (tbl) => {
          const rows = await fetchAllRowsFromSupabase(admin, tbl.name, {
            maxRows: tbl.maxRows,
            orderBy: tbl.orderBy,
          });
          return { ...tbl, rows };
        })
      );
      fetchedEntries.push(...results);
    }

    const orgEntry = fetchedEntries.find((e) => e.name === "organizations");
    const instEntry = fetchedEntries.find((e) => e.name === "installments");
    if (
      !orgEntry ||
      orgEntry.rows.length === 0 ||
      !instEntry ||
      instEntry.rows.length === 0
    ) {
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

    const verifyRes = await db.query<{ cnt: number }>(
      `select count(*)::int as cnt from public.installments`
    );
    return (verifyRes.rows[0]?.cnt ?? 0) > 0;
  } catch (err) {
    console.warn("[supabase-sync] Could not hydrate from remote Supabase:", err);
    return false;
  }
}

const TABLES_WITHOUT_CREATED_AT = new Set([
  "reminder_settings",
  "installment_internal_tracking",
]);

/**
 * Mirrors mutated tables from the local Postgres instance to remote Supabase
 * after a single-record portal mutation so the Supabase dashboard stays in sync.
 */
export async function mirrorTablesToRemoteSupabase(
  db: SqlExecutor,
  tableNames: string[]
): Promise<void> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return;

  for (const tableName of tableNames) {
    try {
      const orderClause = TABLES_WITHOUT_CREATED_AT.has(tableName)
        ? "order by updated_at desc nulls last limit 50"
        : "order by created_at desc nulls last limit 50";

      const res = await db.query<Record<string, unknown>>(
        `select * from public.${tableName} ${orderClause}`
      );
      if (res.rows.length === 0) continue;

      const cleaned =
        tableName === "installments"
          ? res.rows.map(({ is_credit: _omit, import_row_id: _omit2, ...rest }) => rest)
          : tableName === "data_quality_issues"
            ? res.rows.map(({ import_row_id: _omit, ...rest }) => rest)
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

/**
 * Bulk-mirrors the result of an Excel workbook import to remote Supabase
 * in a few batched requests (~300ms) instead of per-row HTTP calls.
 */
export async function mirrorBatchUploadToRemoteSupabase(
  db: SqlExecutor,
  batchId: string
): Promise<void> {
  const admin = getRemoteSupabaseAdmin();
  if (!admin) return;

  try {
    const batchRes = await db.query<Record<string, unknown>>(
      `select * from public.import_batches where id = $1`,
      [batchId]
    );
    if (batchRes.rows.length > 0) {
      await admin.from("import_batches").upsert(batchRes.rows, { onConflict: "id" });
    }

    const orgRes = await db.query<Record<string, unknown>>(
      `select * from public.organizations`
    );
    if (orgRes.rows.length > 0) {
      await admin.from("organizations").upsert(orgRes.rows, { onConflict: "id" });
    }

    const phRes = await db.query<Record<string, unknown>>(
      `select * from public.policyholders`
    );
    if (phRes.rows.length > 0) {
      await admin.from("policyholders").upsert(phRes.rows, { onConflict: "id" });
    }

    const polRes = await db.query<Record<string, unknown>>(
      `select * from public.policies`
    );
    for (let i = 0; i < polRes.rows.length; i += 500) {
      await admin
        .from("policies")
        .upsert(polRes.rows.slice(i, i + 500), { onConflict: "id" });
    }

    const instRes = await db.query<Record<string, unknown>>(
      `select * from public.installments where latest_batch_id = $1`,
      [batchId]
    );
    const cleanedInst = instRes.rows.map(
      ({ is_credit: _omit, import_row_id: _omit2, ...rest }) => rest
    );
    for (let i = 0; i < cleanedInst.length; i += 500) {
      await admin
        .from("installments")
        .upsert(cleanedInst.slice(i, i + 500), { onConflict: "id" });
    }

    const dqRes = await db.query<Record<string, unknown>>(
      `select * from public.data_quality_issues where import_batch_id = $1`,
      [batchId]
    );
    if (dqRes.rows.length > 0) {
      const cleanedDq = dqRes.rows.map(({ import_row_id: _omit, ...rest }) => rest);
      await admin.from("data_quality_issues").upsert(cleanedDq, { onConflict: "id" });
    }
  } catch (err) {
    console.warn("[supabase-sync] Bulk upload sync warning:", err);
  }
}

let lastDeltaCheckMs = 0;

/**
 * Lightweight cross-container synchronization check: if another serverless container
 * recorded a new Excel import batch in remote Supabase, pulls it into local PGlite.
 */
export async function syncLatestBatchesFromRemoteSupabase(
  db: SqlExecutor
): Promise<void> {
  const now = Date.now();
  if (now - lastDeltaCheckMs < 3000) return;
  lastDeltaCheckMs = now;

  const admin = getRemoteSupabaseAdmin();
  if (!admin) return;

  try {
    const { data, error } = await admin
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) return;

    const rows = (data as Record<string, unknown>[]).map(
      ({ duplicate_of: _omit, ...rest }) => rest
    );
    await bulkInsertRowsIntoLocalDb(db, "import_batches", rows);
  } catch {
    // Ignore transient network errors
  }
}

/**
 * Hydrates PGlite from the pre-built JSON seed snapshot bundled in the codebase
 * (~250ms) whenever remote Supabase environment variables are absent or unreachable.
 */
export async function hydrateFromBundledSeedSnapshot(
  db: SqlExecutor
): Promise<boolean> {
  try {
    const snap = bundledSeedSnapshot as Record<string, Record<string, unknown>[]>;
    const profiles = snap["profiles"] ?? [];
    if (profiles.length > 0) {
      const authTuples = profiles
        .filter((p) => p.id && p.email)
        .map((p) => `(${sqlLiteral(p.id)}, ${sqlLiteral(p.email)})`)
        .join(", ");
      if (authTuples) {
        await db.query(
          `insert into auth.users (id, email) values ${authTuples} on conflict (id) do nothing`
        );
      }
    }

    const tablesInOrder: { name: string; omit?: string[] }[] = [
      { name: "organizations" },
      { name: "policyholders" },
      { name: "profiles" },
      { name: "policies" },
      { name: "import_batches", omit: ["duplicate_of"] },
      { name: "installments", omit: ["is_credit", "import_row_id"] },
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
      { name: "data_quality_issues", omit: ["import_row_id"] },
      { name: "risk_rules" },
      { name: "reminder_settings" },
      { name: "reminders" },
    ];

    for (const tbl of tablesInOrder) {
      const rows = snap[tbl.name] ?? [];
      await bulkInsertRowsIntoLocalDb(db, tbl.name, rows, tbl.omit ?? []);
    }

    return true;
  } catch (err) {
    console.warn("[supabase-sync] Bundled snapshot hydration error:", err);
    return false;
  }
}
