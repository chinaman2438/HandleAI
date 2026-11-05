import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServiceDb } from "../db/engine";
import { createSupabaseServerClient } from "../supabase/server";

export const SESSION_COOKIE_NAME = "meridian_session_uid";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: "customer" | "employee" | "admin";
  organizationId: string | null;
  organizationName: string | null;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  let candidateUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

  // Also check live Supabase Auth session if no local session cookie is set
  if (!candidateUserId && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) {
        candidateUserId = data.user.id;
      }
    } catch {
      // Ignore if offline or no Supabase Auth token
    }
  }

  if (!candidateUserId) {
    return null;
  }

  const db = await getServiceDb();
  const res = await db.query<{
    id: string;
    email: string | null;
    full_name: string | null;
    role: "customer" | "employee" | "admin";
    organization_id: string | null;
    organization_name: string | null;
  }>(
    `select
       p.id,
       p.email,
       p.full_name,
       p.role,
       p.organization_id,
       o.name as organization_name
     from public.profiles p
     left join public.organizations o on o.id = p.organization_id
    where p.id = $1
    limit 1`,
    [candidateUserId]
  );

  const row = res.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    email: row.email ?? "user@meridian.demo",
    fullName: row.full_name ?? "Portal User",
    role: row.role,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

export async function requireAuthenticatedUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireCustomerUser(): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();
  if (user.role === "employee" || user.role === "admin") {
    redirect("/internal/dashboard");
  }
  if (!user.organizationId) {
    redirect("/login?error=missing_org");
  }
  return user;
}

export async function requireStaffUser(): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== "employee" && user.role !== "admin") {
    redirect("/dashboard");
  }
  return user;
}

export async function requireAdminUser(): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== "admin") {
    redirect(user.role === "employee" ? "/internal/dashboard" : "/dashboard");
  }
  return user;
}
