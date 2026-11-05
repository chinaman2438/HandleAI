import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Privileged Supabase client using `SUPABASE_SERVICE_ROLE_KEY`.
 * Protected by `import "server-only"` so it can NEVER be bundled into browser code.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
