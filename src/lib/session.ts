/**
 * Tiny module-level holder for the signed-in user id.
 *
 * Kept separate from the Zustand stores so low-level modules (repo, sync) can
 * read it without importing React state and risking circular imports. The auth
 * store is the single writer via `setCurrentUserId`.
 */

let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}
