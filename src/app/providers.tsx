"use client";

/**
 * Client bootstrap. Runs once on mount to:
 *   1. resolve the Supabase session and wire auth side-effects (this includes
 *      a bounded first pull for signed-in users),
 *   2. guarantee the anchored Private Quotebook exists (guest onboarding),
 *   3. start the background sync engine.
 *
 * Everything below is client-only because Dexie/IndexedDB and the sync engine
 * have no meaning on the server.
 */

import { useEffect, useState } from "react";
import { startCaptureEngine, stopCaptureEngine } from "@/lib/captures";
import { ensurePrivateQuotebook } from "@/lib/repo";
import { startSyncEngine, stopSyncEngine } from "@/lib/sync";
import { useAuthStore } from "@/store/useAuthStore";

// Module-level so React Strict Mode's double-mounted effect shares ONE boot:
// a second concurrent run would double-subscribe onAuthStateChange and race
// ensurePrivateQuotebook against itself.
let bootPromise: Promise<void> | null = null;

export function Providers({ children }: { children: React.ReactNode }) {
  const initAuth = useAuthStore((s) => s.init);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let active = true;
    if (!bootPromise) {
      bootPromise = (async () => {
        // Auth FIRST: for a signed-in user this runs a bounded initial pull,
        // so ensurePrivateQuotebook sees the remote private book instead of
        // minting a duplicate on a fresh device. Guests resolve instantly.
        await initAuth();
        await ensurePrivateQuotebook(); // 1 private book always available offline
      })();
    }
    void bootPromise.then(() => {
      if (!active) return;
      // Engines start OUTSIDE the memoized boot: start/stop are idempotent,
      // so a remount restarts them while the one-time boot stays one-time.
      startSyncEngine();
      startCaptureEngine(); // Quick Add resolution (inert until AI parsing ships)
      setBooted(true);
    });

    return () => {
      active = false;
      stopSyncEngine();
      stopCaptureEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="animate-pulse font-heading text-lg text-ink-muted">
          Opening your quotebook…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
