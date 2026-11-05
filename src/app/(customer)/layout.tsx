import React from "react";
import { requireCustomerUser } from "@/lib/auth/session";
import { PortalShell } from "@/components/layout/portal-shell";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireCustomerUser();
  return (
    <PortalShell user={user} mode="customer">
      {children}
    </PortalShell>
  );
}
