import type { SessionInfo } from "./types";

const EMPTY_PINNED: ReadonlySet<string> = new Set();

export interface SessionFamily {
  root: SessionInfo;
  subagents: SessionInfo[];
  latestModified: string;
}

function resolveFamilyRoots(sessions: readonly SessionInfo[]): Map<string, string | null> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const roots = new Map<string, string | null>();

  for (const session of sessions) {
    if (roots.has(session.id)) continue;

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId = session.id;
    let rootId: string | null = null;

    while (true) {
      if (roots.has(currentId)) {
        rootId = roots.get(currentId) ?? null;
        break;
      }
      if (visited.has(currentId)) break;

      visited.add(currentId);
      path.push(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      if (current.relation?.kind !== "subagent") {
        rootId = current.id;
        break;
      }
      currentId = current.relation.parentSessionId;
    }

    for (const id of path) roots.set(id, rootId);
  }

  return roots;
}

/**
 * Groups visible main/fork sessions with every persisted subagent descendant.
 *
 * `pinnedSessionIds` holds pinned *root* session ids (the ids the sidebar renders
 * rows for). Pinned families sort first; within each group the existing
 * most-recent-activity order is preserved, so pinning is a stable two-state
 * flag rather than a manual ordering. Passing nothing keeps the previous order.
 */
export function listSessionFamilies(
  sessions: readonly SessionInfo[],
  pinnedSessionIds: ReadonlySet<string> = EMPTY_PINNED,
): SessionFamily[] {
  const rootsBySessionId = resolveFamilyRoots(sessions);
  const families = new Map<string, SessionFamily>();

  for (const session of sessions) {
    if (session.relation?.kind === "subagent") continue;
    families.set(session.id, {
      root: session,
      subagents: [],
      latestModified: session.modified,
    });
  }

  for (const session of sessions) {
    if (session.relation?.kind !== "subagent") continue;
    const rootId = rootsBySessionId.get(session.id);
    const family = rootId ? families.get(rootId) : undefined;
    if (!family) continue;
    family.subagents.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }

  return [...families.values()].sort((a, b) => {
    const aPinned = pinnedSessionIds.has(a.root.id);
    const bPinned = pinnedSessionIds.has(b.root.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return b.latestModified.localeCompare(a.latestModified);
  });
}

export function getSessionFamily(
  sessions: readonly SessionInfo[],
  sessionId: string | null | undefined,
): SessionFamily | null {
  if (!sessionId) return null;
  return listSessionFamilies(sessions).find((family) => (
    family.root.id === sessionId
    || family.subagents.some((session) => session.id === sessionId)
  )) ?? null;
}
