import React from "react";
import { requireStaffUser } from "@/lib/auth/session";
import { PortalShell } from "@/components/layout/portal-shell";
import { getLatestReportSnapshotDate } from "@/lib/data/internal-queries";

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaffUser();
  const latestSnapshotDate = await getLatestReportSnapshotDate();
  return (
    <PortalShell user={staff} mode="internal" latestSnapshotDate={latestSnapshotDate}>
      {children}
    </PortalShell>
  );
}
