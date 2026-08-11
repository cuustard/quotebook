"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/dexie";
import {
  generateInvite,
  listInvites,
  redeemInvite,
  revokeInvite,
} from "@/lib/invites";
import { errorMessage } from "@/lib/errors";
import { deleteQuotebook, renameQuotebook } from "@/lib/repo";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { InviteCode, Quotebook } from "@/lib/types";
import { useAuthStore } from "@/store/useAuthStore";

export default function ManagePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const books =
    useLiveQuery(async () => (await db.quotebooks.toArray()).filter((b) => !b.deleted), []) ?? [];
  const collaborative = books.filter((b) => !b.is_private);

  const handleJoin = async () => {
    setJoinMsg(null);
    try {
      const id = await redeemInvite(joinCode);
      setJoinCode("");
      setJoinMsg({ ok: true, text: "Joined! Opening the quotebook…" });
      setTimeout(() => router.push(`/quotebook/${id}`), 600);
    } catch (e) {
      setJoinMsg({ ok: false, text: errorMessage(e, "Could not join.") });
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="font-heading text-3xl font-semibold text-ink">Manage quotebooks</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Generate invite codes, admit new members, and tidy up your spaces.
      </p>

      {!isSupabaseConfigured && (
        <div className="qb-card mt-6 border-amber-500/20 bg-amber-500/15 p-4 text-sm text-amber-300">
          Collaboration needs a configured Supabase backend. Set your env vars to enable invites and sync.
        </div>
      )}

      {isSupabaseConfigured && !user && (
        <div className="qb-card mt-6 border-accent/20 bg-accent-soft/40 p-4 text-sm">
          <span className="text-ink-muted">Sign in to create invites and join collaborative books. </span>
          <button onClick={() => router.push("/login")} className="font-medium text-accent underline">
            Sign in
          </button>
        </div>
      )}

      {/* Join by code */}
      <section className="mt-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Join with an invite code
        </h2>
        <div className="qb-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <input
            className="qb-input flex-1 uppercase tracking-widest"
            placeholder="ABCD1234"
            value={joinCode}
            disabled={!user}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <button onClick={handleJoin} disabled={!user || !joinCode.trim()} className="qb-btn-primary">
            Join
          </button>
        </div>
        {joinMsg && (
          <p className={`mt-2 text-sm ${joinMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {joinMsg.text}
          </p>
        )}
      </section>

      {/* Owned / joined collaborative books */}
      <section className="mt-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
          Collaborative quotebooks
        </h2>
        {collaborative.length === 0 ? (
          <div className="qb-card p-6 text-sm text-ink-muted">No collaborative quotebooks yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {collaborative.map((book) => (
              <ManageBookRow key={book.id} book={book} canAdmin={Boolean(user)} ownedByMe={book.owner_id === user?.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Exported for testing: the rename box re-syncs when the book prop changes. */
export function ManageBookRow({
  book,
  canAdmin,
  ownedByMe,
}: {
  book: Quotebook;
  canAdmin: boolean;
  ownedByMe: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(book.name);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Re-seed the rename box when the book is renamed elsewhere (another device
  // syncing in). This is React's documented "adjusting state when a prop
  // changes" pattern: comparing against the previous prop DURING render and
  // re-rendering immediately, rather than syncing in an effect — which paints
  // the stale name first and re-renders after (react-hooks/set-state-in-effect).
  const [lastSyncedName, setLastSyncedName] = useState(book.name);
  if (book.name !== lastSyncedName) {
    setLastSyncedName(book.name);
    setName(book.name);
  }

  // The invite list is fetched, so "now" is captured when it lands rather than
  // read during render — Date.now() in a render body is impure and makes the
  // output depend on when React happens to re-run it (react-hooks/purity).
  const [invitesFetchedAt, setInvitesFetchedAt] = useState(() => Date.now());

  const loadInvites = async () => {
    if (!canAdmin) return;
    try {
      const next = await listInvites(book.id);
      setInvites(next);
      setInvitesFetchedAt(Date.now());
    } catch {
      /* offline — show nothing */
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await loadInvites();
  };

  const handleGenerate = async () => {
    setBusy(true);
    setInviteError(null);
    try {
      const invite = await generateInvite(book.id);
      setInvites((prev) => [invite, ...prev]);
    } catch (e) {
      setInviteError(errorMessage(e, "Couldn't create an invite code."));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleDelete = async () => {
    if (window.confirm(`Delete "${book.name}" and all its quotes?`)) {
      await deleteQuotebook(book.id);
    }
  };

  return (
    <div className="qb-card overflow-hidden">
      <button onClick={toggle} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02]">
        <span className="font-medium text-ink">{book.name}</span>
        <span className="text-xs text-ink-muted">{open ? "Hide" : "Manage"}</span>
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          {/* Rename */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input className="qb-input flex-1" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              onClick={() => renameQuotebook(book.id, name)}
              disabled={!name.trim() || name === book.name}
              className="qb-btn-ghost border border-white/10"
            >
              Rename
            </button>
          </div>

          {/* Invites */}
          {canAdmin ? (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Invite codes (valid 24h)
                </span>
                <button onClick={handleGenerate} disabled={busy} className="qb-btn-primary px-3 py-1.5 text-xs">
                  {busy ? "…" : "+ New code"}
                </button>
              </div>
              {inviteError && <p className="mb-2 text-sm text-red-400">{inviteError}</p>}
              {invites.length === 0 ? (
                <p className="text-sm text-ink-muted/80">No active codes.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {invites.map((inv) => {
                    const expired =
                      new Date(inv.expires_at).getTime() < invitesFetchedAt;
                    return (
                      <li key={inv.id} className="flex items-center justify-between rounded-lg bg-paper px-3 py-2">
                        <div>
                          <code className="font-mono text-sm font-semibold tracking-widest text-ink">{inv.code}</code>
                          <span className={`ml-2 text-xs ${expired ? "text-red-400" : "text-ink-muted"}`}>
                            {expired ? "expired" : `expires ${new Date(inv.expires_at).toLocaleString()}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleCopy(inv.code)} className="rounded-md px-2 py-1 text-xs hover:bg-white/5">
                            {copied === inv.code ? "Copied!" : "Copy"}
                          </button>
                          <button onClick={() => { revokeInvite(inv.id).catch((e) => setInviteError(errorMessage(e, "Couldn't revoke the code."))); setInvites((p) => p.filter((x) => x.id !== inv.id)); }} className="rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">
                            Revoke
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="mb-4 text-sm text-ink-muted/80">Sign in to manage invite codes.</p>
          )}

          {/* Danger zone */}
          {ownedByMe && (
            <button onClick={handleDelete} className="text-sm font-medium text-red-400 hover:underline">
              Delete this quotebook
            </button>
          )}
        </div>
      )}
    </div>
  );
}
