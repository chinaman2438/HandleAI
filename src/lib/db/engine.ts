import pg from "pg";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { createMigratedPGlite, asUser } from "./pglite-harness";
import { ensureSeededDatabase } from "../import/seed-scenarios";
import { SqlExecutor } from "../import/sync";
import {
  hydrateFromRemoteSupabaseIfAvailable,
  mirrorTablesToRemoteSupabase,
  syncLatestBatchesFromRemoteSupabase,
} from "./supabase-sync";

declare global {
  // eslint-disable-next-line no-var
  var __meridianPgPromise: Promise<PGlite> | undefined;
  // eslint-disable-next-line no-var
  var __meridianPgMutex: Promise<unknown> | undefined;
  // eslint-disable-next-line no-var
  var __meridianRemotePool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __meridianRemoteSeeded: boolean | undefined;
}

/**
 * Serializes access to the single-connection in-memory PGlite instance so concurrent
 * Next.js Server Component requests (e.g., Promise.all or parallel route prefetches)
 * never interleave transactions or `SET LOCAL role = authenticated` state.
 */
async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__meridianPgMutex ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.__meridianPgMutex = prev.then(() => next, () => next);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

export function isRemotePostgresConfigured(): boolean {
  return Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
}

async function getEmbeddedPGlite(): Promise<PGlite> {
  if (!globalThis.__meridianPgPromise) {
    globalThis.__meridianPgPromise = (async () => {
      const db = await createMigratedPGlite();
      const workbookPath = path.resolve(
        process.cwd(),
        "meridian-receivables-2026-11-02.xlsx"
      );

      let hydrated = await hydrateFromRemoteSupabaseIfAvailable(db);
      if (!hydrated) {
        // Retry once after a short delay in case of transient cold-start network hiccup
        await new Promise((r) => setTimeout(r, 250));
        hydrated = await hydrateFromRemoteSupabaseIfAvailable(db);
      }

      if (!hydrated && fs.existsSync(workbookPath)) {
        await ensureSeededDatabase(db);
      }

      const checkRes = await db.query<{ cnt: number }>(
        `select count(*)::int as cnt from public.installments`
      );
      if ((checkRes.rows[0]?.cnt ?? 0) === 0) {
        // Never cache an empty database instance across future requests
        globalThis.__meridianPgPromise = undefined;
      }

      return db;
    })().catch((err) => {
      globalThis.__meridianPgPromise = undefined;
      throw err;
    });
  }

  const db = await globalThis.__meridianPgPromise;

  // Self-healing guard: if a previous attempt left 0 installments, re-hydrate immediately
  const countCheck = await db.query<{ cnt: number }>(
    `select count(*)::int as cnt from public.installments`
  );
  if ((countCheck.rows[0]?.cnt ?? 0) === 0) {
    await hydrateFromRemoteSupabaseIfAvailable(db);
  }

  return db;
}

function detectMutatedTables(sql: string): string[] {
  const lower = sql.toLowerCase();
  if (!/\b(insert|update|delete)\b/.test(lower)) return [];

  const candidates = [
    "organizations",
    "policyholders",
    "profiles",
    "policies",
    "import_batches",
    "installments",
    "import_rows",
    "documents",
    "payments",
    "payment_allocations",
    "payment_verifications",
    "extensions",
    "exceptions",
    "exception_messages",
    "internal_notes",
    "installment_internal_tracking",
    "activity_logs",
    "installment_snapshots",
    "data_quality_issues",
    "reminder_settings",
    "reminders",
  ];

  return candidates.filter((t) => lower.includes(`public.${t}`) || lower.includes(` ${t}`));
}

/**
 * Returns a SQL executor connected to either the remote Supabase PostgreSQL
 * database (when `SUPABASE_DB_URL` is set) or the PostgreSQL engine synchronized
 * with remote Supabase via `SUPABASE_SERVICE_ROLE_KEY`.
 */
export async function getServiceDb(options?: {
  skipMirror?: boolean;
}): Promise<SqlExecutor> {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (dbUrl) {
    if (!globalThis.__meridianRemotePool) {
      globalThis.__meridianRemotePool = new pg.Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        max: 5,
      });
    }
    const pool = globalThis.__meridianRemotePool;
    if (!globalThis.__meridianRemoteSeeded) {
      globalThis.__meridianRemoteSeeded = true;
      await ensureSeededDatabase(pool);
    }
    return pool;
  }

  const pglite = await getEmbeddedPGlite();
  const skipMirror = options?.skipMirror ?? false;

  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      return runExclusive(async () => {
        const res = await pglite.query<T>(sql, params);
        if (!skipMirror) {
          const mutated = detectMutatedTables(sql);
          if (mutated.length > 0) {
            await mirrorTablesToRemoteSupabase(pglite, mutated);
          }
        }
        return res;
      });
    },
  };
}

/**
 * Executes a query callback inside a PostgreSQL transaction as `authenticated`
 * with `request.jwt.claim.sub = userId`, enforcing all Supabase Row Level Security
 * (RLS) policies at the database engine level.
 */
export async function withRlsSession<T>(
  userId: string,
  fn: (tx: SqlExecutor) => Promise<T>
): Promise<T> {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = (await getServiceDb()) as pg.Pool;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  const pglite = await getEmbeddedPGlite();

  return runExclusive(async () => {
    await syncLatestBatchesFromRemoteSupabase(pglite);

    const mutatedSet = new Set<string>();
    const result = await asUser(pglite, userId, async (tx) =>
      fn({
        async query<R = Record<string, unknown>>(sql: string, params?: unknown[]) {
          for (const tbl of detectMutatedTables(sql)) mutatedSet.add(tbl);
          return tx.query<R>(sql, params);
        },
      })
    );

    if (mutatedSet.size > 0) {
      await mirrorTablesToRemoteSupabase(pglite, [...mutatedSet]);
    }
    return result;
  });
}
