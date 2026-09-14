import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, extname, basename } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { FileAttachmentStore, FILE_IDLE_TTL_MS, appendFilePaths } = await jiti.import("./file-materialization.ts");
const { validateAgentFiles, MAX_ATTACHED_FILE_BYTES } = await jiti.import("./file-attachments.ts");
const pdfBytes = Buffer.from("%PDF-1.7\nfixture\ntrailer\n%%EOF\n");
const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 0xff, 0xfe]);
const pdf = { name: "report.pdf", mimeType: "application/pdf", data: pdfBytes.toString("base64") };

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-web-file-test-"));
  const store = new FileAttachmentStore({ root, ...options });
  t.after(async () => { store.disposeSync(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store };
}

test("materializes any file bytes with name extensions, private permissions and unique batches", async (t) => {
  const { store } = await fixture(t);
  const batches = await Promise.all([
    store.materialize([pdf, { name: "notes.md", data: docxBytes.toString("base64") }]),
    store.materialize([pdf]),
  ]);
  const paths = batches.flatMap(batch => batch.paths);
  assert.equal(new Set(paths).size, 3);
  assert.deepEqual(paths.map(extname), [".pdf", ".md", ".pdf"]);
  assert.notEqual(dirname(paths[0]), dirname(paths[2]));
  for (const path of paths) {
    assert.ok(basename(path).startsWith("pi-web-attach-"));
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(dirname(path))).mode & 0o777, 0o700);
    }
  }
  assert.deepEqual(await fs.readFile(paths[0]), pdfBytes);
  assert.deepEqual(await fs.readFile(paths[1]), docxBytes);
  await batches[0].rollback();
  await assert.rejects(fs.stat(paths[0]), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile(paths[2]), pdfBytes);
});

test("derives safe extensions without trusting client paths", async (t) => {
  const { store, root } = await fixture(t);
  const names = ["../../etc/passwd", "..\\..\\windows\\evil.exe", "UPPER.PDF", "no-extension", "trailing.", "a.verylongextension"];
  const batch = await store.materialize(names.map(name => ({ name, data: pdfBytes.toString("base64") })));
  assert.deepEqual(batch.paths.map(extname), [".bin", ".exe", ".pdf", ".bin", ".bin", ".bin"]);
  assert.deepEqual(batch.names, ["passwd", "evil.exe", "UPPER.PDF", "no-extension", "trailing.", "a.verylongextension"]);
  for (const path of batch.paths) {
    assert.equal(dirname(dirname(path)), join(root, (await fs.readdir(root))[0]));
    assert.ok(basename(path).startsWith("pi-web-attach-"));
  }
});

test("rejects invalid inputs before creating files", async (t) => {
  const { store, root } = await fixture(t);
  for (const files of [
    [{ name: "a.pdf", data: "broken!" }],
    [{ name: "", data: pdfBytes.toString("base64") }],
    [pdf, { data: pdfBytes.toString("base64") }],
    Array.from({ length: 11 }, () => pdf),
    [{ name: "big.bin", data: Buffer.alloc(MAX_ATTACHED_FILE_BYTES + 1).toString("base64") }],
  ]) await assert.rejects(store.materialize(files));
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(validateAgentFiles([pdf]), null);
  assert.match(validateAgentFiles([{ name: "a", data: "x" }]), /valid base64/);
});

test("a failed batch removes partial files without deleting another batch", async (t) => {
  const { store } = await fixture(t);
  const kept = await store.materialize([pdf]);
  const write = fs.writeFile;
  let calls = 0;
  const mocked = t.mock.method(fs, "writeFile", async (...args) => {
    await write(...args);
    if (++calls === 2) throw new Error("fixture disk full");
  });
  await assert.rejects(store.materialize([pdf, { name: "b.docx", data: docxBytes.toString("base64") }]), /fixture disk full/);
  mocked.mock.restore();
  assert.deepEqual(await fs.readFile(kept.paths[0]), pdfBytes);
  assert.equal((await fs.readdir(dirname(dirname(kept.paths[0])))).length, 1);
});

test("idle cleanup expires file batches but leaves another store's directories alone", async (t) => {
  let now = Date.now();
  const { root, store } = await fixture(t, { now: () => now });
  const imageDirectory = join(root, `pi-web-clipboard-v1-${process.pid}-ABCdef`);
  await fs.mkdir(imageDirectory, { mode: 0o700 });
  const batch = await store.materialize([pdf]);
  assert.equal((await fs.readdir(root)).length, 2);
  now += FILE_IDLE_TTL_MS + 1;
  const old = new Date(now - FILE_IDLE_TTL_MS - 1);
  await fs.utimes(imageDirectory, old, old);
  await store.collect();
  await assert.rejects(fs.stat(batch.paths[0]), { code: "ENOENT" });
  assert.ok((await fs.stat(imageDirectory)).isDirectory());
});

test("path annotation keeps the display name, slash command token and JSON quoting", () => {
  assert.equal(appendFilePaths("hello", []), "hello");
  const annotated = appendFilePaths("/command", [
    { path: "/tmp/a b.pdf", name: "quarterly report.pdf" },
    { path: "/tmp/c\nd.docx", name: "c\nd.docx" },
  ]);
  assert.equal(annotated.split(" ")[0], "/command");
  assert.ok(annotated.includes(JSON.stringify("/tmp/a b.pdf")));
  assert.ok(annotated.includes(JSON.stringify("quarterly report.pdf")));
  assert.ok(annotated.includes(JSON.stringify("/tmp/c\nd.docx")));
});

test("normal process exit cleans its files without being kept alive by the GC timer", async (t) => {
  const { root } = await fixture(t);
  const code = `
    const { createJiti } = require("jiti");
    const jiti = createJiti(process.cwd() + "/file-exit-test.mjs");
    (async () => {
      const { getFileAttachmentStore } = await jiti.import("./lib/file-materialization.ts");
      const batch = await getFileAttachmentStore(() => false).materialize(${JSON.stringify([pdf])});
      console.log(JSON.stringify(batch.paths));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["-e", code], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
    timeout: 15_000,
  });
  const paths = JSON.parse(stdout);
  assert.equal(paths.length, 1);
  await assert.rejects(fs.stat(paths[0]), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(root), []);
});
