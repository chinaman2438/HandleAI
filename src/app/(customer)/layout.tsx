import React from "react";
import { requireCustomerUser } from "@/lib/auth/session";
import { PortalShell } from "@/components/layout/portal-shell";
import { getLatestReportSnapshotDate } from "@/lib/data/internal-queries";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireCustomerUser();
  const latestSnapshotDate = await getLatestReportSnapshotDate();
  return (
    <PortalShell user={user} mode="customer" latestSnapshotDate={latestSnapshotDate}>
      {children}
    </PortalShell>
  );
}
