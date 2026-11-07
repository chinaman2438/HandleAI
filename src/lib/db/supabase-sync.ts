import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SqlExecutor } from "../import/sync";
import bundledSeedSnapshot from "./seed-snapshot.json";

const DEFAULT_PUBLIC_SUPABASE_URL = "https://bclondcopescvclsbsci.supabase.co";
const DEFAULT_PUBLIC_SUPABASE_ANON_KEY =
  "sb_publishable_pnlhAdQ79U-on4-53xF3yA_fivT08PN";

declare global {
  // eslint-disable-next-line no-var
  var __meridianSupabaseClientPromise: Promise<SupabaseClient | null> | undefined;
  // eslint-disable-next-line no-var
  var __meridianDocumentBuffers:
    | Map<string, { buffer: Buffer; mimeType: string }>
    | undefined;
}

function cleanEnvValue(val: string | undefined): string {
  if (!val) return "";
  return val.trim().replace(/^['"]|['"]$/g, "").trim();
}

export function getRemoteSupabaseAdmin(): SupabaseClient | null {
  const runtimeEnv = (globalThis.process?.env ?? {}) as Record<
    string,
    string | undefined
  >;

  if (runtimeEnv["VITEST"] || runtimeEnv["NODE_ENV"] === "test") {
    return null;
  }

  let supabaseUrl = cleanEnvValue(
    runtimeEnv["NEXT_PUBLIC_SUPABASE_URL"] ||
      runtimeEnv["PUBLIC_SUPABASE_URL"] ||
      runtimeEnv["SUPABASE_URL"]
  );

  let serviceRoleKey = cleanEnvValue(
    runtimeEnv["SUPABASE_SERVICE_ROLE_KEY"] ||
      runtimeEnv["PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] ||
      runtimeEnv["NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] ||
      runtimeEnv["SUPABASE_SECRET_KEY"]
  );

  if (!supabaseUrl || !serviceRoleKey) {
    for (const [k, v] of Object.entries(runtimeEnv)) {
      if (!v) continue;
      const trimmed = cleanEnvValue(v);
      if (
        !supabaseUrl &&
        trimmed.startsWith("https://") &&
        trimmed.includes(".supabase.co")
      ) {
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

  if (!supabaseUrl) {
    supabaseUrl = DEFAULT_PUBLIC_SUPABASE_URL;
  }

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Returns a Supabase client with full staff/admin read-write access.
 * Uses SUPABASE_SERVICE_ROLE_KEY when present; otherwise authenticates via the
 * publishable anon key as the seeded admin account so cross-container sync works
 * on Vercel even when only public keys are available.
 */
export async function getRemoteSupabaseClient(): Promise<SupabaseClient | null> {
  const runtimeEnv = (globalThis.process?.env ?? {}) as Record<
    string,
    string | undefined
  >;

  if (runtimeEnv["VITEST"] || runtimeEnv["NODE_ENV"] === "test") {
    return null;
  }

  const directAdmin = getRemoteSupabaseAdmin();
  if (directAdmin) return directAdmin;

  if (!globalThis.__meridianSupabaseClientPromise) {
    globalThis.__meridianSupabaseClientPromise = (async () => {
      try {
        const supabaseUrl =
          cleanEnvValue(
            runtimeEnv["NEXT_PUBLIC_SUPABASE_URL"] ||
              runtimeEnv["PUBLIC_SUPABASE_URL"] ||
              runtimeEnv["SUPABASE_URL"]
          ) || DEFAULT_PUBLIC_SUPABASE_URL;

        const anonKey =
          cleanEnvValue(
            runtimeEnv["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ||
              runtimeEnv["PUBLIC_SUPABASE_ANON_KEY"] ||
              runtimeEnv["SUPABASE_ANON_KEY"]
          ) || DEFAULT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !anonKey) return null;

        const client = createClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const password =
          cleanEnvValue(runtimeEnv["DEMO_USER_PASSWORD"]) || "Meridian2026!";

        const { error } = await client.auth.signInWithPassword({
          email: "admin@meridian.demo",
          password,
        });

        if (error) {
          console.warn(
            "[supabase-sync] Fallback admin sign-in failed:",
            error.message
          );
          return null;
        }

        return client;
      } catch (err) {
        console.warn("[supabase-sync] Could not initialize remote client:", err);
        return null;
      }
    })();
  }

  const client = await globalThis.__meridianSupabaseClientPromise;
  if (!client) {
    globalThis.__meridianSupabaseClientPromise = undefined;
  }
  return client;
}

function getDocumentBufferCache(): Map<string, { buffer: Buffer; mimeType: string }> {
  if (!globalThis.__meridianDocumentBuffers) {
    globalThis.__meridianDocumentBuffers = new Map();
  }
  return globalThis.__meridianDocumentBuffers;
}

/**
 * Persists an uploaded document binary to both the local in-memory cache and
 * the remote Supabase `documents` Storage bucket so any serverless container
 * can serve the exact file uploaded by the user.
 */
export async function uploadDocumentBlob(
  storagePath: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  getDocumentBufferCache().set(storagePath, { buffer, mimeType });

  const client = await getRemoteSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.storage.from("documents").upload(storagePath, buffer, {
      contentType: mimeType || "application/pdf",
      upsert: true,
    });
    if (error) {
      console.warn("[supabase-sync] Storage upload warning:", error.message);
    }
  } catch (err) {
    console.warn("[supabase-sync] Storage upload failed:", err);
  }
}

/**
 * Retrieves an uploaded document binary from the local cache or remote Supabase
 * `documents` Storage bucket. Returns null if the document is a seeded placeholder.
 */
export async function downloadDocumentBlob(
  storagePath: string
): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  const cached = getDocumentBufferCache().get(storagePath);
  if (cached) {
    return cached;
  }

  const client = await getRemoteSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client.storage.from("documents").download(storagePath);
    if (error || !data) {
      return null;
    }
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = data.type || undefined;
    getDocumentBufferCache().set(storagePath, {
      buffer,
      mimeType: mimeType ?? "application/pdf",
    });
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllRowsFromSupabase(
  admin: SupabaseClient,
  tableName: string,
  options?: {
    maxRows?: number;
    orderBy?: string;
    eqColumn?: string;
    eqValue?: string;
    gtColumn?: string;
    gtValue?: string;
  }
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = options?.maxRows ? Math.min(options.maxRows, 1000) : 1000;
  let from = 0;

  while (true) {
    let lastError: unknown = null;
    let pageData: Record<string, unknown>[] | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      let query = admin.from(tableName).select("*");
      if (options?.eqColumn && options?.eqValue !== undefined) {
        query = query.eq(options.eqColumn, options.eqValue);
      }
      if (options?.gtColumn && options?.gtValue !== undefined) {
        query = query.gt(options.gtColumn, options.gtValue);
      }
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
  omitColumns: string[] = [],
  conflictTarget?: string
) {
  if (rows.length === 0) return;

  const sampleKeys = Object.keys(rows[0]).filter((k) => !omitColumns.includes(k));
  if (sampleKeys.length === 0) return;

  const colList = sampleKeys.map((k) => `"${k}"`).join(", ");
  const batchSize = 250;

  let conflictClause = "on conflict do nothing";
  if (conflictTarget) {
    const conflictCols = new Set(
      conflictTarget.split(",").map((c) => c.trim().replace(/"/g, ""))
    );
    const updateCols = sampleKeys.filter((k) => !conflictCols.has(k));
    if (updateCols.length > 0) {
      const setList = updateCols
        .map((k) => `"${k}" = excluded."${k}"`)
        .join(", ");
      conflictClause = `on conflict (${conflictTarget}) do update set ${setList}`;
    }
  }

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const valuesTuples = chunk
      .map((row) => {
        const vals = sampleKeys.map((k) => sqlLiteral(row[k]));
        return `(${vals.join(", ")})`;
      })
      .join(",\n");

    await db.query(
      `insert into public.${tableName} (${colList}) values ${valuesTuples} ${conflictClause}`
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
  const admin = await getRemoteSupabaseClient();
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
      { name: "payment_allocations" },
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

const TABLES_WITH_UPDATED_AT = new Set([
  "organizations",
  "policyholders",
  "profiles",
  "policies",
  "installments",
  "exceptions",
  "payments",
  "extensions",
  "data_quality_issues",
  "risk_rules",
  "reminder_settings",
]);

/**
 * Mirrors mutated tables from the local Postgres instance to remote Supabase
 * after a single-record portal mutation so the Supabase dashboard stays in sync.
 * Rows are selected by most recent modification (updated_at when available) so
 * updates to old rows (e.g. resolving a data-quality issue) are always mirrored.
 */
export async function mirrorTablesToRemoteSupabase(
  db: SqlExecutor,
  tableNames: string[]
): Promise<void> {
  const admin = await getRemoteSupabaseClient();
  if (!admin) return;

  for (const tableName of tableNames) {
    try {
      const timeCol = TABLES_WITH_UPDATED_AT.has(tableName)
        ? "updated_at"
        : "created_at";

      // Only mirror rows modified or created in the last 30 seconds so we NEVER
      // overwrite other records in remote Supabase with stale local baseline state.
      const res = await db.query<Record<string, unknown>>(
        `select * from public.${tableName}
          where ${timeCol} >= now() - interval '30 seconds'
          order by ${timeCol} desc
          limit 50`
      );
      if (res.rows.length === 0) continue;

      const cleaned =
        tableName === "installments"
          ? res.rows.map(({ is_credit: _omit, import_row_id: _omit2, ...rest }) => rest)
          : tableName === "data_quality_issues"
            ? res.rows.map(({ import_row_id: _omit, ...rest }) => rest)
            : tableName === "documents"
              ? res.rows.map(({ exception_id: _omit, ...rest }) => rest)
              : tableName === "payment_allocations"
                ? res.rows.map(({ id: _omit, ...rest }) => rest)
                : res.rows;

      const conflictCol =
        tableName === "payment_allocations" ? "payment_id,installment_id" : "id";

      const { error } = await admin
        .from(tableName)
        .upsert(cleaned, { onConflict: conflictCol });
      if (error) {
        console.warn(`[supabase-sync] mirror ${tableName} error:`, error.message);
      }
    } catch (err) {
      console.warn(`[supabase-sync] mirror ${tableName} failed:`, err);
    }
  }
}

let lastDeltaCheckMs = 0;

export function resetDeltaSyncThrottle(): void {
  lastDeltaCheckMs = 0;
}

/**
 * Bulk-mirrors the result of an Excel workbook import to remote Supabase
 * in batched requests so other serverless containers can immediately pull the delta.
 */
export async function mirrorBatchUploadToRemoteSupabase(
  db: SqlExecutor,
  batchId: string
): Promise<void> {
  resetDeltaSyncThrottle();
  const admin = await getRemoteSupabaseClient();
  if (!admin) return;

  try {
    const batchRes = await db.query<Record<string, unknown>>(
      `select * from public.import_batches where id = $1`,
      [batchId]
    );
    if (batchRes.rows.length > 0) {
      const cleanedBatch = batchRes.rows.map(({ duplicate_of: _omit, ...rest }) => rest);
      const { error } = await admin
        .from("import_batches")
        .upsert(cleanedBatch, { onConflict: "id" });
      if (error) {
        console.warn("[supabase-sync] import_batches upsert error:", error.message);
      }
    }

    const [orgRes, phRes, polRes] = await Promise.all([
      db.query<Record<string, unknown>>(`select * from public.organizations`),
      db.query<Record<string, unknown>>(`select * from public.policyholders`),
      db.query<Record<string, unknown>>(`select * from public.policies`),
    ]);

    if (orgRes.rows.length > 0) {
      await admin.from("organizations").upsert(orgRes.rows, { onConflict: "id" });
    }
    if (phRes.rows.length > 0) {
      await admin.from("policyholders").upsert(phRes.rows, { onConflict: "id" });
    }
    if (polRes.rows.length > 0) {
      const polChunks: Record<string, unknown>[][] = [];
      for (let i = 0; i < polRes.rows.length; i += 1000) {
        polChunks.push(polRes.rows.slice(i, i + 1000));
      }
      await Promise.all(
        polChunks.map((chunk) =>
          admin.from("policies").upsert(chunk, { onConflict: "id" })
        )
      );
    }

    const [instRes, snapRes, dqRes] = await Promise.all([
      db.query<Record<string, unknown>>(
        `select * from public.installments where import_batch_id = $1 or is_missing_from_latest = true`,
        [batchId]
      ),
      db.query<Record<string, unknown>>(
        `select * from public.installment_snapshots where import_batch_id = $1`,
        [batchId]
      ),
      db.query<Record<string, unknown>>(
        `select * from public.data_quality_issues where import_batch_id = $1`,
        [batchId]
      ),
    ]);

    const cleanedInst = instRes.rows.map(
      ({ is_credit: _omit, import_row_id: _omit2, ...rest }) => rest
    );
    const instChunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < cleanedInst.length; i += 1000) {
      instChunks.push(cleanedInst.slice(i, i + 1000));
    }
    await Promise.all(
      instChunks.map(async (chunk) => {
        const { error } = await admin
          .from("installments")
          .upsert(chunk, { onConflict: "id" });
        if (error) {
          console.warn("[supabase-sync] installments upsert error:", error.message);
        }
      })
    );

    const snapChunks: Record<string, unknown>[][] = [];
    for (let i = 0; i < snapRes.rows.length; i += 1000) {
      snapChunks.push(snapRes.rows.slice(i, i + 1000));
    }

    await Promise.all([
      ...snapChunks.map(async (chunk) => {
        const { error } = await admin
          .from("installment_snapshots")
          .upsert(chunk, {
            onConflict: "import_batch_id,installment_id",
          });
        if (error) {
          console.warn(
            "[supabase-sync] installment_snapshots upsert error:",
            error.message
          );
        }
      }),
      (async () => {
        if (dqRes.rows.length > 0) {
          const cleanedDq = dqRes.rows.map(
            ({ import_row_id: _omit, ...rest }) => rest
          );
          await admin
            .from("data_quality_issues")
            .upsert(cleanedDq, { onConflict: "id" });
        }
      })(),
    ]);
  } catch (err) {
    console.warn("[supabase-sync] Bulk upload sync warning:", err);
  }
}

/**
 * Cross-container synchronization: pulls (1) any Excel import batches recorded in
 * remote Supabase by another serverless container and (2) any rows modified
 * remotely since the last check (e.g. a data-quality issue resolved, a payment
 * confirmed, or a note added on a different container) into local PGlite.
 */
export async function syncLatestBatchesFromRemoteSupabase(
  db: SqlExecutor
): Promise<void> {
  const now = Date.now();
  if (now - lastDeltaCheckMs < 1000) return;
  lastDeltaCheckMs = now;

  const admin = await getRemoteSupabaseClient();
  if (!admin) return;

  await pullNewImportBatches(db, admin);
  await pullRecentRowChanges(db, admin);
}

const DELTA_TABLES: {
  name: string;
  tsColumn: "updated_at" | "created_at";
  omit?: string[];
  conflict?: string;
}[] = [
  { name: "organizations", tsColumn: "updated_at" },
  { name: "policyholders", tsColumn: "updated_at" },
  { name: "profiles", tsColumn: "updated_at" },
  { name: "policies", tsColumn: "updated_at" },
  { name: "installments", tsColumn: "updated_at", omit: ["is_credit", "import_row_id"] },
  { name: "documents", tsColumn: "created_at", omit: ["exception_id"] },
  { name: "payments", tsColumn: "updated_at" },
  {
    name: "payment_allocations",
    tsColumn: "created_at",
    omit: ["id"],
    conflict: "payment_id, installment_id",
  },
  { name: "payment_verifications", tsColumn: "created_at" },
  { name: "extensions", tsColumn: "updated_at" },
  { name: "exceptions", tsColumn: "updated_at" },
  { name: "exception_messages", tsColumn: "created_at" },
  { name: "internal_notes", tsColumn: "created_at" },
  { name: "installment_internal_tracking", tsColumn: "created_at" },
  { name: "activity_logs", tsColumn: "created_at" },
  { name: "data_quality_issues", tsColumn: "updated_at", omit: ["import_row_id"] },
  { name: "risk_rules", tsColumn: "updated_at" },
  { name: "reminder_settings", tsColumn: "updated_at" },
  { name: "reminders", tsColumn: "created_at" },
];

// Safety margin to tolerate commit ordering / clock skew between writers across containers.
const DELTA_MARGIN_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __meridianDeltaWatermarks: Map<string, number> | undefined;
}

function toMs(val: unknown): number {
  if (!val) return 0;
  const ms = Date.parse(String(val));
  return Number.isFinite(ms) ? ms : 0;
}

function getWatermarks(): Map<string, number> {
  if (!globalThis.__meridianDeltaWatermarks) {
    // Initialize from the bundled snapshot (exported from remote Supabase), so a
    // freshly hydrated container pulls every change made after the snapshot.
    const snap = bundledSeedSnapshot as Record<string, Record<string, unknown>[]>;
    const map = new Map<string, number>();
    for (const t of DELTA_TABLES) {
      let max = 0;
      for (const row of snap[t.name] ?? []) {
        max = Math.max(max, toMs(row[t.tsColumn]), toMs(row["created_at"]));
      }
      map.set(t.name, max);
    }
    globalThis.__meridianDeltaWatermarks = map;
  }
  return globalThis.__meridianDeltaWatermarks;
}

async function pullRecentRowChanges(
  db: SqlExecutor,
  admin: SupabaseClient
): Promise<void> {
  // For small critical workflow tables, ALWAYS fetch all rows directly from Supabase.
  // There are only ~35 rows total across these tables. Full-sync is nearly instantaneous (<60ms)
  // and completely eliminates watermark drift, clock skew, and cross-container stale state.
  const CRITICAL_FULL_SYNC_TABLES = new Set([
    "data_quality_issues",
    "documents",
    "extensions",
    "exceptions",
    "exception_messages",
    "payments",
    "payment_allocations",
    "payment_verifications",
    "reminder_settings",
    "risk_rules",
  ]);

  const watermarks = getWatermarks();

  let fetched: { table: (typeof DELTA_TABLES)[number]; rows: Record<string, unknown>[] }[];
  try {
    fetched = await Promise.all(
      DELTA_TABLES.map(async (table) => {
        if (CRITICAL_FULL_SYNC_TABLES.has(table.name)) {
          try {
            const rows = await fetchAllRowsFromSupabase(admin, table.name);
            return { table, rows };
          } catch (err) {
            console.warn(`[supabase-sync] full fetch ${table.name} failed:`, err);
            return { table, rows: [] };
          }
        }

        const wm = watermarks.get(table.name) ?? 0;
        const since = new Date(Math.max(0, wm - DELTA_MARGIN_MS)).toISOString();
        try {
          const rows = await fetchAllRowsFromSupabase(admin, table.name, {
            gtColumn: table.tsColumn,
            gtValue: since,
            orderBy: table.tsColumn,
          });
          return { table, rows };
        } catch (err) {
          console.warn(`[supabase-sync] delta fetch ${table.name} failed:`, err);
          return { table, rows: [] };
        }
      })
    );
  } catch (err) {
    console.warn("[supabase-sync] delta fetch failed:", err);
    return;
  }

  for (const { table, rows } of fetched) {
    if (rows.length === 0) continue;
    try {
      if (table.name === "profiles") {
        const authTuples = rows
          .filter((p) => p.id && p.email)
          .map((p) => `(${sqlLiteral(p.id)}, ${sqlLiteral(p.email)})`)
          .join(", ");
        if (authTuples) {
          await db.query(
            `insert into auth.users (id, email) values ${authTuples} on conflict (id) do nothing`
          );
        }
      }
      await bulkInsertRowsIntoLocalDb(
        db,
        table.name,
        rows,
        table.omit ?? [],
        table.conflict ?? "id"
      );
      let max = watermarks.get(table.name) ?? 0;
      for (const r of rows) max = Math.max(max, toMs(r[table.tsColumn]));
      watermarks.set(table.name, max);
    } catch (err) {
      console.warn(`[supabase-sync] delta apply ${table.name} failed:`, err);
    }
  }
}

async function pullNewImportBatches(
  db: SqlExecutor,
  admin: SupabaseClient
): Promise<void> {
  try {
    const { data: remoteBatches, error } = await admin
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(20);

    if (error || !remoteBatches || remoteBatches.length === 0) return;

    const existingBatchesRes = await db.query<{
      id: string;
      snap_cnt: number;
    }>(
      `select
         b.id,
         (select count(*)::int from public.installment_snapshots s where s.import_batch_id = b.id) as snap_cnt
       from public.import_batches b`
    );
    const completeBatchIds = new Set(
      existingBatchesRes.rows
        .filter((r) => r.snap_cnt > 0)
        .map((r) => r.id)
    );
    const newBatches = (remoteBatches as Record<string, unknown>[]).filter(
      (b) => b.id && !completeBatchIds.has(String(b.id))
    );

    if (newBatches.length === 0) return;

    const [orgs, phs, pols, allInst] = await Promise.all([
      fetchAllRowsFromSupabase(admin, "organizations"),
      fetchAllRowsFromSupabase(admin, "policyholders"),
      fetchAllRowsFromSupabase(admin, "policies"),
      fetchAllRowsFromSupabase(admin, "installments"),
    ]);
    await bulkInsertRowsIntoLocalDb(db, "organizations", orgs, [], "id");
    await bulkInsertRowsIntoLocalDb(db, "policyholders", phs, [], "id");
    await bulkInsertRowsIntoLocalDb(db, "policies", pols, [], "id");

    const cleanedBatches = newBatches.map(({ duplicate_of: _omit, ...rest }) => rest);
    await bulkInsertRowsIntoLocalDb(
      db,
      "import_batches",
      cleanedBatches,
      [],
      "id"
    );

    if (allInst.length > 0) {
      await bulkInsertRowsIntoLocalDb(
        db,
        "installments",
        allInst,
        ["is_credit", "import_row_id"],
        "id"
      );
    }

    for (const b of newBatches) {
      const batchId = String(b.id);

      const [snapData, dqData] = await Promise.all([
        fetchAllRowsFromSupabase(admin, "installment_snapshots", {
          eqColumn: "import_batch_id",
          eqValue: batchId,
        }),
        fetchAllRowsFromSupabase(admin, "data_quality_issues", {
          eqColumn: "import_batch_id",
          eqValue: batchId,
        }),
      ]);

      if (snapData.length > 0) {
        await bulkInsertRowsIntoLocalDb(
          db,
          "installment_snapshots",
          snapData,
          [],
          "import_batch_id, installment_id"
        );
      }

      if (dqData.length > 0) {
        await bulkInsertRowsIntoLocalDb(
          db,
          "data_quality_issues",
          dqData,
          ["import_row_id"],
          "id"
        );
      }
    }
  } catch (err) {
    console.warn("[supabase-sync] Cross-container sync error:", err);
  }
}

/**
 * Hydrates PGlite from the pre-built JSON seed snapshot bundled in the codebase
 * (~150ms), whose UUIDs match remote Supabase 1-to-1.
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
      { name: "payment_allocations" },
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
