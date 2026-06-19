"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/supabase";
import { SyncIndicator } from "@/components/SyncIndicator";
import { useAuthStore } from "@/store/useAuthStore";
import { useUIStore } from "@/store/useUIStore";

const NAV = [
  { href: "/", label: "Dashboard", icon: HomeIcon },
  { href: "/manage", label: "Manage Quotebooks", icon: UsersIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const setMobileNav = useUIStore((s) => s.setMobileNav);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-black/[0.06] bg-paper-raised px-4 py-5 transition-transform lg:static lg:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileNav(false)}>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-serif text-lg font-bold text-white">
              Q
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight">Quotebook</span>
          </Link>
          <SyncIndicator />
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileNav(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  active ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-black/5 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6">
          {user ? (
            <div className="qb-card p-3">
              <p className="truncate text-xs text-ink-muted">Signed in as</p>
              <p className="mb-2 truncate text-sm font-medium">{user.email}</p>
              <button onClick={() => signOut()} className="qb-btn-ghost w-full justify-start px-2 text-sm">
                Sign out
              </button>
            </div>
          ) : (
            <div className="qb-card border-accent/20 bg-accent-soft/50 p-4">
              <p className="mb-1 font-serif text-sm font-semibold text-ink">Secure your account</p>
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
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 8v-1a4 4 0 0 0-3-3.87M16 5.13A4 4 0 0 1 16 13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.61.78 1 1.42 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
