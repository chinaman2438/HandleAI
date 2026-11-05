import React from "react";
import { requireStaffUser } from "@/lib/auth/session";
import { PortalShell } from "@/components/layout/portal-shell";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaffUser();
  return (
    <PortalShell user={staff} mode="internal">
      {children}
    </PortalShell>
  );
}
