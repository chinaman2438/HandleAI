-- =============================================================================
-- Migration 08: Service-Role RPC SQL Bridge for Serverless / HTTPS Execution
-- Allows the Next.js server (when authenticated with SUPABASE_SERVICE_ROLE_KEY)
-- to execute parameterized SQL and RLS-scoped transactions over HTTPS REST
-- even when a direct TCP Postgres connection string (SUPABASE_DB_URL) is not set.
-- =============================================================================

create or replace function public.meridian_exec_sql(
  query_text text,
  query_params jsonb default '[]'::jsonb,
  rls_user_id uuid default null
)
returns jsonb
language plpgsql
as $$
declare
  final_sql text := query_text;
  n int := coalesce(jsonb_array_length(query_params), 0);
  i int;
  elem jsonb;
  rep text;
  rec record;
  rows_json jsonb := '[]'::jsonb;
  is_returning boolean;
begin
  if n > 0 then
    for i in reverse n..1 loop
      elem := query_params -> (i - 1);
      if elem is null or jsonb_typeof(elem) = 'null' then
        rep := 'NULL';
      elsif jsonb_typeof(elem) = 'boolean' then
        rep := elem::text;
      elsif jsonb_typeof(elem) = 'number' then
        rep := elem::text;
      else
        rep := quote_literal(elem #>> '{}');
      end if;
      final_sql := regexp_replace(final_sql, '\$' || i::text || '(?![0-9])', rep, 'g');
    end loop;
  end if;

  if rls_user_id is not null then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', rls_user_id::text, true);
  end if;

  is_returning := (final_sql ~* '^\s*(select|with)\M') or (final_sql ~* '\mreturning\M');
  if is_returning then
    for rec in execute final_sql loop
      rows_json := rows_json || jsonb_build_array(to_jsonb(rec));
    end loop;
  else
    execute final_sql;
  end if;

  if rls_user_id is not null then
    perform set_config('role', 'service_role', true);
  end if;

  return rows_json;
exception
  when others then
    if rls_user_id is not null then
      perform set_config('role', 'service_role', true);
    end if;
    raise;
end;
$$;

revoke all on function public.meridian_exec_sql(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.meridian_exec_sql(text, jsonb, uuid) to service_role;
