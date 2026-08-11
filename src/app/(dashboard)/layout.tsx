"use client";

import { Sidebar } from "@/components/Sidebar";
import { QuoteModal } from "@/components/QuoteModal";
import { useUIStore } from "@/store/useUIStore";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const setMobileNav = useUIStore((s) => s.setMobileNav);

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-paper/80 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileNav(true)}
            className="rounded-lg p-2 text-ink-muted hover:bg-white/5"
            aria-label="Open navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <span className="font-heading text-lg font-semibold">Quotebook</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Globally-mounted creation/edit modal */}
      <QuoteModal />
    </div>
  );
}
