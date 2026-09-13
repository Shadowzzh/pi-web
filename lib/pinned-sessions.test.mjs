import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  loadPinnedSessionIds,
  savePinnedSessionIds,
  isPinned,
  pinSession,
  unpinSession,
  togglePinnedSession,
} = await jiti.import("./pinned-sessions.ts");

function createStorage(initial = {}, { throws = false } = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      if (throws) throw new Error("storage unavailable");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (throws) throw new Error("quota exceeded");
      values.set(key, value);
    },
    removeItem(key) {
      if (throws) throw new Error("storage unavailable");
      values.delete(key);
    },
  };
}

test("round-trips pinned session ids", () => {
  const storage = createStorage();
  assert.deepEqual([...loadPinnedSessionIds(storage)], []);

  savePinnedSessionIds(new Set(["a", "b"]), storage);
  assert.deepEqual([...loadPinnedSessionIds(storage)].sort(), ["a", "b"]);
});

test("removing the last pin clears the storage key instead of storing an empty array", () => {
  const storage = createStorage();
  savePinnedSessionIds(new Set(["a"]), storage);
  savePinnedSessionIds(new Set(), storage);
  assert.equal(storage.values.has("pi-web:pinned-session-ids"), false);
  assert.deepEqual([...loadPinnedSessionIds(storage)], []);
});

test("ignores corrupt, non-array, and non-string entries", () => {
  assert.deepEqual([...loadPinnedSessionIds(createStorage({ "pi-web:pinned-session-ids": "not json" }))], []);
  assert.deepEqual([...loadPinnedSessionIds(createStorage({ "pi-web:pinned-session-ids": '{"a":1}' }))], []);
  const mixed = createStorage({ "pi-web:pinned-session-ids": JSON.stringify(["a", 2, null, "", "b"]) });
  assert.deepEqual([...loadPinnedSessionIds(mixed)].sort(), ["a", "b"]);
});

test("storage failures degrade to an empty set and no-op writes", () => {
  const storage = createStorage({}, { throws: true });
  assert.deepEqual([...loadPinnedSessionIds(storage)], []);
  assert.doesNotThrow(() => savePinnedSessionIds(new Set(["a"]), storage));
  assert.deepEqual([...loadPinnedSessionIds(null)], []);
  assert.doesNotThrow(() => savePinnedSessionIds(new Set(["a"]), null));
});

test("pin, unpin, and toggle are immutable and idempotent", () => {
  const original = new Set(["a"]);
  const pinned = pinSession(original, "b");
  assert.deepEqual([...original], ["a"], "original set is not mutated");
  assert.deepEqual([...pinned].sort(), ["a", "b"]);

  assert.deepEqual([...pinSession(pinned, "b")].sort(), ["a", "b"], "pinning twice is a no-op");
  assert.deepEqual([...unpinSession(pinned, "missing")].sort(), ["a", "b"], "unpinning unknown id is a no-op");
  assert.deepEqual([...unpinSession(pinned, "a")], ["b"]);

  assert.equal(isPinned(pinned, "a"), true);
  assert.equal(isPinned(pinned, "z"), false);
  assert.deepEqual([...togglePinnedSession(pinned, "a")], ["b"]);
  assert.deepEqual([...togglePinnedSession(pinned, "z")].sort(), ["a", "b", "z"]);
});
