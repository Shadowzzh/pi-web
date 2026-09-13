import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getSessionFamily, listSessionFamilies } = await createJiti(import.meta.url).import("./session-family.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("groups nested subagents under their main session and uses family activity for sorting", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-04T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "main", profile: "explore", description: "Explore", status: "completed",
  });
  const grandchild = session("grandchild", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "child", profile: "review", description: "Review", status: "running",
  });
  const newerRoot = session("newer-root", "2026-01-02T00:00:00.000Z");

  const families = listSessionFamilies([main, child, grandchild, newerRoot]);
  assert.deepEqual(families.map((family) => family.root.id), ["main", "newer-root"]);
  assert.deepEqual(families[0].subagents.map((item) => item.id), ["child", "grandchild"]);
  assert.equal(getSessionFamily([main, child, grandchild], "grandchild")?.root.id, "main");
});

test("does not promote orphaned or cyclic subagent metadata into the main session list", () => {
  const orphan = session("orphan", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "missing", profile: "explore", description: "Explore", status: "interrupted",
  });
  const a = session("a", "2026-01-01T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "b", profile: "a", description: "A", status: "interrupted",
  });
  const b = session("b", "2026-01-02T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "a", profile: "b", description: "B", status: "interrupted",
  });

  assert.deepEqual(listSessionFamilies([orphan, a, b]), []);
  assert.equal(getSessionFamily([orphan, a, b], "orphan"), null);
});

test("sorts pinned families first while keeping recent-activity order inside each group", () => {
  const older = session("older", "2026-01-01T00:00:00.000Z");
  const middle = session("middle", "2026-01-02T00:00:00.000Z");
  const newest = session("newest", "2026-01-03T00:00:00.000Z");
  const all = [older, middle, newest];

  // Without pins the order is purely by activity, newest first.
  assert.deepEqual(listSessionFamilies(all).map((family) => family.root.id), ["newest", "middle", "older"]);

  // The oldest pinned session still leads; the rest keep activity order.
  assert.deepEqual(
    listSessionFamilies(all, new Set(["older"])).map((family) => family.root.id),
    ["older", "newest", "middle"],
  );

  // Multiple pins are also ordered by activity among themselves.
  assert.deepEqual(
    listSessionFamilies(all, new Set(["older", "middle"])).map((family) => family.root.id),
    ["middle", "older", "newest"],
  );
});

test("matches pins against family roots so a pinned session with subagents still leads", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-05T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "main", profile: "explore", description: "Explore", status: "completed",
  });
  const other = session("other", "2026-01-02T00:00:00.000Z");

  // 'other' is not pinned, so the busier family sorts first by activity.
  assert.deepEqual(listSessionFamilies([main, child, other]).map((family) => family.root.id), ["main", "other"]);
  // Pinning the quieter root lifts its whole family above the unpinned one.
  assert.deepEqual(
    listSessionFamilies([main, child, other], new Set(["main"])).map((family) => family.root.id),
    ["main", "other"],
  );
  assert.deepEqual(
    listSessionFamilies([main, child, other], new Set(["other"])).map((family) => family.root.id),
    ["other", "main"],
  );
});

test("ignores pins for sessions that are no longer listed", () => {
  const only = session("only", "2026-01-01T00:00:00.000Z");
  assert.deepEqual(
    listSessionFamilies([only], new Set(["deleted-session"])).map((family) => family.root.id),
    ["only"],
  );
});
