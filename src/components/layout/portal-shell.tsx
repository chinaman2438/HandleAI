"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Clock,
  Receipt,
  Scale,
  AlertTriangle,
  Upload,
  ShieldAlert,
  Building2,
  Bell,
  BarChart3,
  FileText,
  UserCircle,
  LogOut,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/actions/portal-actions";
import { formatBrDate } from "@/lib/format";
import { PageLoader } from "@/components/ui/page-loader";

function NavigationObserver({ onRouteSettled }: { onRouteSettled: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";

  useEffect(() => {
    onRouteSettled();
  }, [pathname, searchKey, onRouteSettled]);

  return null;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

const CUSTOMER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview Dashboard", icon: LayoutDashboard },
  { href: "/installments", label: "Installments", icon: FileSpreadsheet },
  { href: "/requests", label: "My Requests", icon: Clock },
  { href: "/documents", label: "Receipts & Documents", icon: FileText },
  { href: "/profile", label: "Group Profile", icon: UserCircle },
];

const INTERNAL_NAV: NavItem[] = [
  { href: "/internal/dashboard", label: "Management Overview", icon: LayoutDashboard },
  { href: "/internal/receivables", label: "Receivables Portfolio", icon: FileSpreadsheet },
  { href: "/internal/payments", label: "Payment Verification", icon: Receipt },
  { href: "/internal/extensions", label: "Extension Requests", icon: Clock },
  { href: "/internal/disputes", label: "Amount Disputes", icon: Scale },
  { href: "/internal/cancellation-risk", label: "Cancellation Risk", icon: AlertTriangle },
  { href: "/internal/reports", label: "WoW Analytics & Aging", icon: BarChart3 },
  { href: "/internal/imports", label: "Excel Imports & Sync", icon: Upload },
  { href: "/internal/data-quality", label: "Data-Quality Queue", icon: ShieldAlert },
  { href: "/internal/reminders", label: "Payment Reminders", icon: Bell },
  { href: "/internal/customers", label: "Customer Groups & Access", icon: Building2 },
];

export function PortalShell({
  user,
  mode,
  latestSnapshotDate,
  children,
}: {
  user: SessionUser;
  mode: "customer" | "internal";
  latestSnapshotDate?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const navItems = mode === "internal" ? INTERNAL_NAV : CUSTOMER_NAV;

  const clearPending = React.useCallback(() => {
    setPendingHref(null);
  }, []);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => setPendingHref(null), 12000);
    return () => clearTimeout(timer);
  }, [pendingHref]);

  const handleLinkClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const anchor = (e.target as HTMLElement | null)?.closest("a");
    if (!anchor) return;
    const rawHref = anchor.getAttribute("href");
    if (
      !rawHref ||
      rawHref.startsWith("#") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      anchor.target === "_blank" ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    try {
      const targetUrl = new URL(rawHref, window.location.origin);
      if (targetUrl.origin !== window.location.origin) return;
      if (targetUrl.pathname.startsWith("/api/")) return;
      const currentFull = window.location.pathname + window.location.search;
      const targetFull = targetUrl.pathname + targetUrl.search;
      if (targetFull !== currentFull) {
        setPendingHref(targetUrl.pathname);
        setMobileOpen(false);
      }
    } catch {
      // Ignore malformed URLs
    }
  };

  return (
    <div
      onClickCapture={handleLinkClickCapture}
      className="min-h-screen bg-slate-50 flex flex-col lg:flex-row"
    >
      <Suspense fallback={null}>
        <NavigationObserver onRouteSettled={clearPending} />
      </Suspense>

      {/* Persistent Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 h-screen bg-slate-900 text-slate-100 flex flex-col border-r border-slate-800 transition-transform lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white text-sm shadow-sm">
              M
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-white leading-none">
                MERIDIAN
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {mode === "internal" ? "Receivables Operations" : "Customer Portal"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden text-slate-400 hover:text-white"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Context Banner */}
        <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-950/40 shrink-0">
          {mode === "customer" ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                Corporate Group Scope
              </div>
              <div className="text-xs font-medium text-slate-100 truncate mt-0.5">
                {user.organizationName ?? "Assigned Group"}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                Internal Workspace
              </div>
            </div>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const targetPath = pendingHref ?? pathname;
            const active =
              targetPath === item.href ||
              (item.href !== "/dashboard" &&
                item.href !== "/internal/dashboard" &&
                targetPath.startsWith(item.href));
            const isItemLoading =
              pendingHref !== null &&
              (pendingHref === item.href ||
                (item.href !== "/dashboard" &&
                  item.href !== "/internal/dashboard" &&
                  pendingHref.startsWith(item.href)));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                }`}
              >
                {isItemLoading ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/50 shrink-0">
          <div className="text-xs font-medium text-white truncate">{user.fullName}</div>
          <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
          <form action={logoutAction} className="mt-3">
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="relative sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {mode === "internal"
                    ? "Meridian Insurance Brokers — Receivables Control Center"
                    : `${user.organizationName} — Policy Installments & Receivables Portal`}
                </span>
                <span
                  className={`hidden sm:inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    mode === "internal"
                      ? "bg-slate-900 text-amber-300"
                      : "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20"
                  }`}
                >
                  {mode === "internal" ? `INTERNAL (${user.role.toUpperCase()})` : "CUSTOMER GROUP VIEW"}
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Latest Report Snapshot: {formatBrDate(latestSnapshotDate ?? "2026-11-02")}
              </p>
            </div>
          </div>
          {pendingHref && (
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-100 overflow-hidden">
              <div className="h-full w-full bg-blue-600 animate-pulse" />
            </div>
          )}
        </header>

        {/* Page Body */}
        <main className="relative flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {pendingHref ? <PageLoader /> : children}
        </main>
      </div>
    </div>
  );
}
