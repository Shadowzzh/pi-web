import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { FileAttachmentStore } = await jiti.import("./file-materialization.ts");
const { ImageAttachmentStore } = await jiti.import("./image-materialization.ts");
const textBytes = Buffer.from("hello from an attached document\n");
const doc = { name: "notes.txt", mimeType: "text/plain", data: textBytes.toString("base64") };
const png = { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
const PATH_LINE = /^\d+\. (".*?")(?: \(original name: (".*?")\))?$/gm;

/** Image annotation lines match PATH_LINE too, so keep only materialized file paths. */
function parseFileEntries(message) {
  return [...message.matchAll(PATH_LINE)]
    .map(match => ({ path: JSON.parse(match[1]), name: match[2] ? JSON.parse(match[2]) : "" }))
    .filter(entry => basename(entry.path).startsWith("pi-web-attach-"));
}

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-rpc-files-"));
  const previousFiles = globalThis.__piFileAttachmentStore;
  const previousImages = globalThis.__piImageAttachmentStore;
  const store = new FileAttachmentStore({ root: join(root, "files") });
  const imageStore = new ImageAttachmentStore({ root: join(root, "images") });
  await rm(join(root, "files"), { recursive: true, force: true });
  await rm(join(root, "images"), { recursive: true, force: true });
  globalThis.__piFileAttachmentStore = store;
  globalThis.__piImageAttachmentStore = imageStore;
  const calls = [];
  const capture = async (message, images) => {
    const entries = parseFileEntries(message);
    for (const entry of entries) assert.deepEqual(await readFile(entry.path), textBytes);
    calls.push({ message, images, entries });
  };
  const inner = {
    sessionId: "file-test", sessionManager: { getCwd: () => root },
    isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: {} }, extensionRunner: {}, dispose() {},
    prompt: async (message, options) => {
      const entries = parseFileEntries(message);
      for (const entry of entries) assert.deepEqual(await readFile(entry.path), textBytes);
      calls.push({ message, images: options.images, entries });
      options.preflightResult(true);
    },
    steer: capture, followUp: capture,
    ...overrides,
  };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(async () => {
    wrapper.destroy();
    store.disposeSync();
    imageStore.disposeSync();
    globalThis.__piFileAttachmentStore = previousFiles;
    globalThis.__piImageAttachmentStore = previousImages;
    await rm(root, { recursive: true, force: true });
  });
  return { wrapper, calls, root, store, imageStore, inner };
}

for (const command of [
  { type: "prompt" }, { type: "prompt", streamingBehavior: "steer" },
  { type: "prompt", streamingBehavior: "followUp" }, { type: "steer" }, { type: "follow_up" },
]) test(`provides readable paths and original names for ${JSON.stringify(command)}`, async (t) => {
  const { wrapper, calls } = await fixture(t);
  await wrapper.send({ ...command, message: "Summarize this", files: [doc, { name: "second.docx", data: doc.data }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images, undefined);
  assert.equal(calls[0].entries.length, 2);
  assert.deepEqual(calls[0].entries.map(entry => entry.name), ["notes.txt", "second.docx"]);
  assert.ok(calls[0].message.startsWith("Summarize this"));
  assert.match(calls[0].message, /\[Attached files on this server \(temporary\):/);
  assert.ok(!calls[0].message.includes("included as image inputs"));
  const reader = createReadTool(tmpdir(), { autoResizeImages: false });
  const result = await reader.execute("read-fixture", { path: calls[0].entries[0].path });
  assert.ok(result.content.some(block => block.type === "text" && block.text.includes("hello from an attached document")));
  wrapper.destroy();
});

test("files and images can be attached to the same message", async (t) => {
  const { wrapper, calls } = await fixture(t);
  await wrapper.send({ type: "prompt", message: "Look at both", images: [png], files: [doc] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].images.length, 1);
  assert.equal(calls[0].entries.length, 1);
  assert.match(calls[0].message, /Attached image files/);
  assert.match(calls[0].message, /Attached files on this server/);
});

test("rejected preflight rolls back only its own file batch", async (t) => {
  let rejectedPath;
  const { wrapper, store } = await fixture(t, {
    prompt: async (message, options) => {
      rejectedPath = JSON.parse(message.match(/^1\. (".*?")/m)[1]);
      assert.ok((await stat(rejectedPath)).isFile());
      options.preflightResult(false);
      throw new Error("fixture rejected");
    },
  });
  const kept = await store.materialize([doc]);
  await assert.rejects(wrapper.send({ type: "prompt", message: "reject", files: [doc] }), /fixture rejected/);
  await assert.rejects(stat(rejectedPath), { code: "ENOENT" });
  assert.ok((await stat(kept.paths[0])).isFile());
  assert.equal((await readdir(dirname(dirname(kept.paths[0])))).length, 1);
});

test("failure after acceptance retains files referenced by the accepted message", async (t) => {
  let path;
  let fail;
  const { wrapper } = await fixture(t, {
    prompt: (message, options) => {
      path = JSON.parse(message.match(/^1\. (".*?")/m)[1]);
      options.preflightResult(true);
      return new Promise((_, reject) => { fail = reject; });
    },
  });
  await wrapper.send({ type: "prompt", message: "accepted", files: [doc] });
  fail(new Error("fixture provider failure"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((await stat(path)).isFile());
});

test("text-only prompts are unchanged and allocate no files", async (t) => {
  let received;
  const { wrapper, root } = await fixture(t, { prompt: async (message, options) => {
    received = message;
    assert.equal(options.images, undefined);
    options.preflightResult(true);
  } });
  await wrapper.send({ type: "prompt", message: "/command" });
  assert.equal(received, "/command");
  await assert.rejects(readdir(join(root, "files")), { code: "ENOENT" });
});

test("oversized and malformed file attachments are rejected before any write", async (t) => {
  const { wrapper, root } = await fixture(t);
  await assert.rejects(wrapper.send({ type: "prompt", message: "x", files: [{ name: "a.bin", data: "!!!" }] }), /valid base64/);
  await assert.rejects(wrapper.send({ type: "prompt", message: "x", files: Array.from({ length: 11 }, () => doc) }), /at most 10 files/);
  await assert.rejects(readdir(join(root, "files")), { code: "ENOENT" });
});
