"use client";

/**
 * Client bootstrap. Runs once on mount to:
 *   1. guarantee the anchored Private Quotebook exists (guest onboarding),
 *   2. resolve the Supabase session and wire auth side-effects,
 *   3. start the background sync engine.
 *
 * Everything below is client-only because Dexie/IndexedDB and the sync engine
 * have no meaning on the server.
 */

import { useEffect, useState } from "react";
import { ensurePrivateQuotebook } from "@/lib/repo";
import { startSyncEngine, stopSyncEngine } from "@/lib/sync";
import { useAuthStore } from "@/store/useAuthStore";

export function Providers({ children }: { children: React.ReactNode }) {
  const initAuth = useAuthStore((s) => s.init);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      await ensurePrivateQuotebook(); // 1 private book always available offline
      await initAuth(); // resolves session, claims guest data if signed in
      startSyncEngine();
      if (active) setBooted(true);
    })();

    return () => {
      active = false;
      stopSyncEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="animate-pulse font-serif text-lg text-ink-muted">
          Opening your quotebook…
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
