import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

/**
 * Creates an in-memory PostgreSQL instance (PGlite) with a minimal Supabase
 * `auth` schema shim (`auth.users`, `auth.uid()`, and `authenticated`/`anon` roles)
 * and applies every SQL migration in `supabase/migrations/` in lexical order.
 */
export async function createMigratedPGlite(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    create schema if not exists auth;

    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end
    $$;

    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $fn$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $fn$;

    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);

  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
  }

  // Grant table/view/function privileges to `authenticated` as Supabase does by default
  await db.exec(`
    grant usage on schema app to authenticated, service_role;
    grant execute on all functions in schema app to authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
  `);

  return db;
}

/**
 * Execute a callback inside a transaction impersonating a specific Supabase user
 * (`SET LOCAL role = authenticated` + `SET LOCAL request.jwt.claim.sub = userId`).
 */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (tx: { query: PGlite["query"]; exec: PGlite["exec"] }) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated;`);
    await tx.exec(`select set_config('request.jwt.claim.sub', '${userId}', true);`);
    return fn(tx);
  });
}
