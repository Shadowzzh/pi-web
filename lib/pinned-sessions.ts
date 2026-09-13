const STORAGE_KEY = "pi-web:pinned-session-ids";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Privacy mode / disabled storage.
    return null;
  }
}

/**
 * Reads the pinned session ids. Pins are stored client-side because pinning is
 * a per-browser view preference, not session data.
 */
export function loadPinnedSessionIds(storage: StorageLike | null = defaultStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return new Set();
  }
}

/** Persistence is best-effort: quota and privacy-mode errors are ignored. */
export function savePinnedSessionIds(ids: ReadonlySet<string>, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (ids.size === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

export function isPinned(ids: ReadonlySet<string>, sessionId: string): boolean {
  return ids.has(sessionId);
}

/** Returns a new set with the session id added. Pins are idempotent. */
export function pinSession(ids: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(ids);
  next.add(sessionId);
  return next;
}

/** Returns a new set with the session id removed; unknown ids are a no-op. */
export function unpinSession(ids: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(ids);
  next.delete(sessionId);
  return next;
}

export function togglePinnedSession(ids: ReadonlySet<string>, sessionId: string): Set<string> {
  return ids.has(sessionId) ? unpinSession(ids, sessionId) : pinSession(ids, sessionId);
}
