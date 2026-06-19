/**
 * Zustand store for sync status + collaborative editing presence.
 *
 * Two concerns live here:
 *   1. Sync status surfaced in the UI (online/offline, syncing, pending count).
 *      The sync engine (`src/lib/sync.ts`) is the writer via the setters.
 *   2. Soft-lock presence: when a user opens the edit pane for a quote we
 *      broadcast an "editing" beacon over a Supabase realtime channel so other
 *      viewers see "User X is editing…" and have their edit button disabled.
 *      Broadcasts are ephemeral, so editors re-emit a heartbeat and stale
 *      beacons expire after PRESENCE_TTL_MS.
 */

import { create } from "zustand";
import { getDeviceId } from "@/db/dexie";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

// A beacon older than this is considered stale (editor closed tab / crashed).
const PRESENCE_TTL_MS = 30000;
// Editors re-broadcast this often so late-joining viewers still see the lock.
const PRESENCE_HEARTBEAT_MS = 10000;

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "disabled";

export interface EditingBeacon {
  quoteId: string;
  deviceId: string;
  userId: string | null;
  label: string;
  at: number; // epoch ms of last heartbeat
}

interface SyncState {
  // --- status ---
  online: boolean;
  status: SyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  error: string | null;

  // --- presence ---
  editing: Record<string, EditingBeacon>; // keyed by quoteId
  myDeviceId: string | null;
  myLabel: string;

  // setters (used by the sync engine)
  setOnline: (online: boolean) => void;
  setStatus: (status: SyncStatus) => void;
  setLastSyncedAt: (iso: string) => void;
  setPendingCount: (n: number) => void;
  setError: (e: string | null) => void;

  // presence API (used by the quotebook page + edit modal)
  setMyLabel: (label: string) => void;
  joinBook: (bookId: string) => Promise<void>;
  leaveBook: () => void;
  startEditing: (quoteId: string) => Promise<void>;
  stopEditing: (quoteId: string) => void;
  /** Is some *other* device currently editing this quote (within TTL)? */
  lockedBy: (quoteId: string) => EditingBeacon | null;
}

// Module-level (non-reactive) channel + timer refs.
let channel: RealtimeChannel | null = null;
let channelBookId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
const editingByMe = new Set<string>();

export const useSyncStore = create<SyncState>((set, get) => ({
  online: true,
  status: "disabled",
  lastSyncedAt: null,
  pendingCount: 0,
  error: null,

  editing: {},
  myDeviceId: null,
  myLabel: "A guest",

  setOnline: (online) => set({ online }),
  setStatus: (status) => set({ status }),
  setLastSyncedAt: (iso) => set({ lastSyncedAt: iso }),
  setPendingCount: (n) => set({ pendingCount: n }),
  setError: (e) => set({ error: e }),

  setMyLabel: (label) => set({ myLabel: label }),

  joinBook: async (bookId) => {
    const supabase = getSupabase();
    if (!supabase) return; // guest / offline: no collaborators to coordinate with
    if (channelBookId === bookId && channel) return; // already joined

    get().leaveBook();
    const deviceId = await getDeviceId();
    set({ myDeviceId: deviceId, editing: {} });

    channel = supabase.channel(`presence:${bookId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "editing" }, ({ payload }) => {
      const beacon = payload as EditingBeacon & { action: "start" | "stop" };
      set((state) => {
        const next = { ...state.editing };
        if (beacon.action === "stop") {
          delete next[beacon.quoteId];
        } else {
          next[beacon.quoteId] = {
            quoteId: beacon.quoteId,
            deviceId: beacon.deviceId,
            userId: beacon.userId ?? null,
            label: beacon.label,
            at: Date.now(),
          };
        }
        return { editing: next };
      });
    });

    await channel.subscribe();
    channelBookId = bookId;

    // Periodically drop stale beacons (e.g. an editor that closed its tab).
    pruneTimer = setInterval(() => {
      const cutoff = Date.now() - PRESENCE_TTL_MS;
      set((state) => {
        const next: Record<string, EditingBeacon> = {};
        let changed = false;
        for (const [id, b] of Object.entries(state.editing)) {
          if (b.at >= cutoff) next[id] = b;
          else changed = true;
        }
        return changed ? { editing: next } : {};
      });
    }, PRESENCE_HEARTBEAT_MS);
  },

  leaveBook: () => {
    const supabase = getSupabase();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    heartbeatTimer = null;
    pruneTimer = null;
    editingByMe.clear();
    if (channel && supabase) void supabase.removeChannel(channel);
    channel = null;
    channelBookId = null;
    set({ editing: {} });
  },

  startEditing: async (quoteId) => {
    if (!channel) return;
    editingByMe.add(quoteId);
    const { myDeviceId, myLabel } = get();

    const emit = () =>
      channel?.send({
        type: "broadcast",
        event: "editing",
        payload: {
          action: "start",
          quoteId,
          deviceId: myDeviceId,
          label: myLabel,
        },
      });
    await emit();

    // Heartbeat so viewers who join mid-edit still see the lock.
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        for (const id of editingByMe) {
          void channel?.send({
            type: "broadcast",
            event: "editing",
            payload: {
              action: "start",
              quoteId: id,
              deviceId: get().myDeviceId,
              label: get().myLabel,
            },
          });
        }
      }, PRESENCE_HEARTBEAT_MS);
    }
  },

  stopEditing: (quoteId) => {
    editingByMe.delete(quoteId);
    if (editingByMe.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    void channel?.send({
      type: "broadcast",
      event: "editing",
      payload: { action: "stop", quoteId, deviceId: get().myDeviceId },
    });
  },

  lockedBy: (quoteId) => {
    const { editing, myDeviceId } = get();
    const beacon = editing[quoteId];
    if (!beacon) return null;
    if (beacon.deviceId === myDeviceId) return null; // it's me
    if (Date.now() - beacon.at > PRESENCE_TTL_MS) return null; // stale
    return beacon;
  },
}));
