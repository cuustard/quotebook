"use client";

/**
 * Mobile/tablet primary navigation.
 *
 * Below `lg` the sidebar is an off-canvas drawer, which puts every route
 * behind a hamburger at the top-left — the hardest corner of a phone to reach
 * one-handed. This puts the four routes the app is actually used through
 * within thumb reach and leaves them permanently visible.
 *
 * ─────────────────────────── Boundaries ───────────────────────────
 * `lg:hidden` — the desktop sidebar is untouched, and this never renders
 * alongside it. The breakpoint is the same `lg` the sidebar already switches
 * on, so the two are exact complements: there is no width at which both or
 * neither appear.
 *
 * It ADDS to the drawer rather than replacing it. The drawer still holds
 * Manage Quotebooks, sync status and the account block; dropping it to make
 * the bottom bar the only mobile navigation would lose all three. So the bar
 * is the fast path for the common routes, and the drawer remains for the rest.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import { INBOX_STATUSES } from "@/lib/captures";
import { cn } from "@/lib/cn";
import {
  GearIcon,
  HomeIcon,
  InboxIcon,
  ZapIcon,
} from "@/components/ui/NavIcons";

const ITEMS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/quick", label: "Capture", icon: ZapIcon },
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const inboxCount =
    useLiveQuery(
      () => db.captures.where("status").anyOf([...INBOX_STATUSES]).count(),
      [],
    ) ?? 0;

  return (
    <nav
      data-bottom-nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.06] bg-paper-raised lg:hidden",
        // Keep the row clear of the iOS home indicator without padding the bar
        // out on devices that have none.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex items-stretch">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // min-h-14 keeps every target comfortably past the ~44px
                  // minimum even on the shortest phones.
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[0.65rem] font-medium transition",
                  active ? "text-accent" : "text-ink-muted",
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {href === "/inbox" && inboxCount > 0 && (
                    <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
                      {inboxCount}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
