import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import { createMigratedPGlite } from "../src/lib/db/pglite-harness";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Always write a combined SQL bundle so the operator can also run it in the
  // Supabase SQL Editor with one click if SUPABASE_DB_URL is not configured.
  const combinedPath = path.resolve(process.cwd(), "supabase/full-schema.sql");
  const combinedSql = files
    .map((f) => `-- >>> ${f}\n${fs.readFileSync(path.join(migrationsDir, f), "utf8")}`)
    .join("\n\n");
  fs.writeFileSync(combinedPath, combinedSql, "utf8");
  console.log(`[db:migrate] Consolidated ${files.length} migration files -> supabase/full-schema.sql`);

  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (dbUrl) {
    console.log("[db:migrate] Connecting to remote PostgreSQL via SUPABASE_DB_URL...");
    const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query(`
        create table if not exists public._schema_migrations (
          filename text primary key,
          applied_at timestamptz not null default now()
        );
      `);
      for (const file of files) {
        const already = await client.query(
          "select 1 from public._schema_migrations where filename = $1",
          [file]
        );
        if (already.rowCount && already.rowCount > 0) {
          console.log(`[db:migrate] Skipping already applied: ${file}`);
          continue;
        }
        console.log(`[db:migrate] Applying ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        await client.query("begin");
        try {
          await client.query(sql);
          await client.query("insert into public._schema_migrations (filename) values ($1)", [file]);
          await client.query("commit");
        } catch (err) {
          await client.query("rollback");
          throw err;
        }
      }
      console.log("[db:migrate] All migrations applied to remote Supabase PostgreSQL.");
    } finally {
      await client.end();
    }
  } else {
    console.log(
      "[db:migrate] SUPABASE_DB_URL not set in .env.local — verifying all migrations in embedded PostgreSQL (PGlite)..."
    );
    const db = await createMigratedPGlite();
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`
    );
    console.log(
      `[db:migrate] Verified ${files.length} migrations cleanly. Created ${res.rows.length} public tables/views:`,
      res.rows.map((r) => r.table_name).join(", ")
    );
    await db.close();
  }
}

main().catch((err) => {
  console.error("[db:migrate] Failed:", err);
  process.exit(1);
});
