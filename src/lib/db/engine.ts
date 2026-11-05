import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createMigratedPGlite, asUser } from "./pglite-harness";
import { ensureSeededDatabase } from "../import/seed-scenarios";
import { SqlExecutor } from "../import/sync";

declare global {
  // eslint-disable-next-line no-var
  var __meridianPgPromise: Promise<PGlite> | undefined;
  // eslint-disable-next-line no-var
  var __meridianRemotePool: pg.Pool | undefined;
  // eslint-disable-next-line no-var
  var __meridianRemoteSeeded: boolean | undefined;
}

export function isRemotePostgresConfigured(): boolean {
  return Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
}

async function getEmbeddedPGlite(): Promise<PGlite> {
  if (!globalThis.__meridianPgPromise) {
    globalThis.__meridianPgPromise = (async () => {
      const db = await createMigratedPGlite();
      await ensureSeededDatabase(db);
      return db;
    })();
  }
  return globalThis.__meridianPgPromise;
}

/**
 * Returns a SQL executor connected to either the remote Supabase PostgreSQL
 * database (when `SUPABASE_DB_URL` is set) or the embedded PostgreSQL (PGlite)
 * instance running the exact same migrations, RLS policies, and workbook data.
 */
export async function getServiceDb(): Promise<SqlExecutor> {
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

  return getEmbeddedPGlite();
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
  return asUser(pglite, userId, async (tx) => fn(tx));
}
