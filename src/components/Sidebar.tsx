"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { INBOX_STATUSES } from "@/lib/captures";
import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SyncIndicator } from "@/components/SyncIndicator";
import { useAuthStore } from "@/store/useAuthStore";
import { useUIStore } from "@/store/useUIStore";
import {
  GearIcon,
  HomeIcon,
  InboxIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/ui/NavIcons";

const NAV = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/quick", label: "Quick Add", icon: ZapIcon },
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/manage", label: "Manage Quotebooks", icon: UsersIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  // Unreviewed captures — the "review it a bit later" nudge.
  const inboxCount =
    useLiveQuery(
      () => db.captures.where("status").anyOf([...INBOX_STATUSES]).count(),
      [],
    ) ?? 0;

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}

      <aside
        className={cn(
          // Mobile: an off-canvas drawer that slides in over the content.
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/[0.06] bg-paper-raised px-4 py-5 transition-[transform,width]",
          // Desktop: sticky rather than static, so it stays put down a long
          // feed. `sticky` keeps it a flex item (unlike `fixed`, which would
          // need the main column to be manually offset), and the explicit
          // viewport height gives `mt-auto` on the account block something to
          // push against. `overflow-y-auto` covers the nav outgrowing a short
          // window.
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:overflow-y-auto",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-[4.5rem] lg:px-2" : "lg:w-72",
        )}
      >
        <div className={cn("mb-6 flex items-center px-2", collapsed ? "lg:flex-col lg:gap-2" : "justify-between")}>
          <Link
            href="/"
            className={cn("flex items-center gap-2", collapsed && "lg:justify-center")}
            onClick={() => setMobileNav(false)}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent font-heading text-lg font-bold text-white">
              Q
            </span>
            <span className={cn("font-heading text-xl font-semibold tracking-tight", collapsed && "lg:hidden")}>
              Quotebook
            </span>
          </Link>
          {/* Desktop-only — inline with the title rather than its own row. */}
          <button
            onClick={toggleCollapsed}
            className="hidden shrink-0 rounded-lg p-1.5 text-ink-muted transition hover:bg-white/5 hover:text-ink lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <CollapseIcon className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileNav(false)}
                title={collapsed ? label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  collapsed && "lg:justify-center lg:px-0",
                  active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-white/5 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={cn(collapsed && "lg:hidden")}>{label}</span>
                {href === "/inbox" && inboxCount > 0 && (
                  <span
                    className={cn(
                      "rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white",
                      collapsed ? "lg:absolute lg:ml-6 lg:mt-[-14px]" : "ml-auto",
                    )}
                  >
                    {inboxCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 pt-6">
          <div className={cn("px-2", collapsed && "lg:hidden")}>
            <SyncIndicator />
          </div>

          {user ? (
            <div className={cn("qb-card p-3", collapsed && "lg:p-2")}>
              <div className={cn(collapsed && "lg:hidden")}>
                <p className="truncate text-xs text-ink-muted">Signed in as</p>
                <p className="mb-2 truncate text-sm font-medium">{user.email}</p>
              </div>
              <button
                onClick={() => signOut()}
                title={collapsed ? "Sign out" : undefined}
                className={cn(
                  "qb-btn-ghost w-full justify-start px-2 text-sm",
                  collapsed && "lg:justify-center lg:px-0",
                )}
              >
                {collapsed ? <SignOutIcon className="h-4 w-4" /> : "Sign out"}
              </button>
            </div>
          ) : (
            <div className={cn("qb-card border-accent/20 bg-accent-soft/50 p-4", collapsed && "lg:hidden")}>
              <p className="mb-1 font-heading text-sm font-semibold text-ink">Secure your account</p>
              <p className="mb-3 text-xs text-ink-muted">
                {isSupabaseConfigured
                  ? "You're a guest. Create an account to back up and sync your quotes across devices."
                  : "Connect Supabase to enable accounts and cross-device sync."}
              </p>
              {isSupabaseConfigured && (
                <Link href="/signup" className="qb-btn-primary w-full" onClick={() => setMobileNav(false)}>
                  Secure Account
                </Link>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// --- Inline icons (no extra dependency) -----------------------------------
function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M14 10l-2 2 2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
