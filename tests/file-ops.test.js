import test from "node:test";
import assert from "node:assert/strict";
import {
  renameFiles,
  scanDirectory,
  createArchive,
  fingerprint,
} from "../src/file-ops.js";
import { makePlan } from "../src/rename-core.js";
import { unzipSync, strFromU8 } from "fflate";
const error = (name) => new DOMException(name, name);
class Handle {
  kind = "file";
  constructor(name, text) {
    this.name = name;
    this.bytes = new TextEncoder().encode(text);
    this.time = 1000;
  }
  async getFile() {
    return new File([this.bytes], this.name, { lastModified: this.time });
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => {
        chunks.push(data.slice());
        this.onWrite?.();
      },
      close: async () => {
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let n = 0;
        for (const c of chunks) {
          all.set(c, n);
          n += c.length;
        }
        this.bytes = all;
        this.time++;
      },
      abort: async () => {},
    };
  }
}
class Dir {
  kind = "directory";
  constructor(name = "test") {
    this.name = name;
    this.items = new Map();
  }
  async getFileHandle(name, { create = false } = {}) {
    if (this.items.has(name)) {
      const h = this.items.get(name);
      if (h.kind !== "file") throw error("TypeMismatchError");
      return h;
    }
    if (!create) throw error("NotFoundError");
    const h = new Handle(name, "");
    this.items.set(name, h);
    this.onCreate?.(h);
    return h;
  }
  async getDirectoryHandle(name) {
    const h = this.items.get(name);
    if (!h) throw error("NotFoundError");
    if (h.kind !== "directory") throw error("TypeMismatchError");
    return h;
  }
  async removeEntry(name) {
    if (!this.items.delete(name)) throw error("NotFoundError");
  }
  async *entries() {
    yield* this.items.entries();
  }
  add(name, text) {
    this.items.set(name, new Handle(name, text));
    return this.items.get(name);
  }
}
async function fixture() {
  const root = new Dir();
  root.add("第十二章.txt", "Unicode 内容 🌈");
  root.add("第二十一章.txt", "second\n");
  return root;
}
test("Streams files, verifies contents, records completed names, then restores from journal", async () => {
  const root = await fixture(),
    original = (await root.getFileHandle("第十二章.txt")).bytes.slice(),
    rows = makePlan(await scanDirectory(root)),
    journal = [];
  await renameFiles(root, rows, { journal });
  assert.equal(root.items.has("第十二章.txt"), false);
  assert.deepEqual(root.items.get("第12章.txt").bytes, original);
  assert.equal(journal.length, 2);
  await renameFiles(root, [...journal].reverse(), { undo: true });
  assert.equal(root.items.has("第十二章.txt"), true);
  assert.equal(root.items.has("第12章.txt"), false);
});
test("Existing destination aborts before any write", async () => {
  const root = await fixture(),
    rows = makePlan(await scanDirectory(root));
  root.add("第21章.txt", "do not overwrite");
  await assert.rejects(renameFiles(root, rows), /目标已存在/);
  assert.ok(root.items.has("第十二章.txt"));
  assert.equal(root.items.has("第12章.txt"), false);
  assert.equal(
    new TextDecoder().decode(root.items.get("第21章.txt").bytes),
    "do not overwrite",
  );
});
test("Changed source metadata is refused", async () => {
  const root = await fixture(),
    rows = makePlan(await scanDirectory(root));
  root.items.get("第十二章.txt").time++;
  await assert.rejects(renameFiles(root, rows), /文件已变化/);
  assert.equal(root.items.has("第12章.txt"), false);
});
test("Cancellation removes incomplete copy and retains original", async () => {
  const root = await fixture(),
    controller = new AbortController(),
    rows = makePlan(await scanDirectory(root));
  root.onCreate = (h) => (h.onWrite = () => controller.abort());
  await assert.rejects(renameFiles(root, rows, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(root.items.has("第12章.txt"), false);
  assert.ok(root.items.has("第十二章.txt"));
});
test("Cancellation after one completion leaves an undoable journal", async () => {
  const root = await fixture(),
    controller = new AbortController(),
    rows = makePlan(await scanDirectory(root)),
    journal = [];
  await renameFiles(root, rows, {
    signal: controller.signal,
    journal,
    onProgress: (n) => {
      if (n === 1) controller.abort();
    },
  });
  assert.equal(journal.length, 1);
  assert.ok(root.items.has(rows[1].path));
  assert.equal(root.items.has(journal[0].path), false);
  await renameFiles(root, journal, { undo: true });
  assert.equal(root.items.size, 2);
  assert.ok(root.items.has(rows[0].path));
});
test("Undo refuses externally modified result and preserves it", async () => {
  const root = await fixture(),
    journal = [];
  await renameFiles(root, makePlan(await scanDirectory(root)), { journal });
  const changed = root.items.get(journal[0].after);
  changed.bytes = new TextEncoder().encode("edited later");
  changed.time++;
  await assert.rejects(
    renameFiles(root, [journal[0]], { undo: true }),
    /内容已变化/,
  );
  assert.ok(root.items.has(journal[0].after));
  assert.equal(root.items.has(journal[0].path), false);
});
test("ZIP has UTF-8 transformed paths and byte-identical content, leaving source unchanged", async () => {
  const root = await fixture(),
    sub = new Dir("照片");
  sub.add("第九张.txt", "original utf8 你好");
  root.items.set("照片", sub);
  const rows = makePlan(await scanDirectory(root)),
    blob = await createArchive(rows),
    zip = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(strFromU8(zip["照片/第9张.txt"]), "original utf8 你好");
  assert.equal(strFromU8(zip["第12章.txt"]), "Unicode 内容 🌈");
  assert.ok(root.items.has("第十二章.txt"));
});
test("ZIP cancellation rejects and checksum accepts empty files", async () => {
  const root = await fixture(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createArchive(makePlan(await scanDirectory(root)), {
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(
    await fingerprint(new File([], "empty")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
test("Directory scan can stop before files and budgets also count empty directories", async () => {
  const root = new Dir();
  for (let i = 0; i < 8; i++) root.items.set("empty" + i, new Dir());
  await assert.rejects(scanDirectory(root, { maxDirectories: 3 }), /子目录/);
  await assert.rejects(scanDirectory(root, { maxEntries: 3 }), /条目/);
  const abort = new AbortController();
  await assert.rejects(
    scanDirectory(root, {
      signal: abort.signal,
      onProgress: () => abort.abort(),
    }),
    { name: "AbortError" },
  );
});
test("Directory scan has explicit depth and file-count budgets", async () => {
  const root = new Dir(),
    one = new Dir(),
    two = new Dir();
  root.items.set("one", one);
  one.items.set("two", two);
  await assert.rejects(scanDirectory(root, { maxDepth: 1 }), /深度/);
  root.add("a", "a");
  root.add("b", "b");
  await assert.rejects(scanDirectory(root, { maxFiles: 1 }), /文件/);
});
test("Successive batches retain undo order rather than preflight nonexistent intermediate names", async () => {
  const root = await fixture(),
    journal = [];
  await renameFiles(root, makePlan(await scanDirectory(root)), {
    journal,
    batchId: "one",
  });
  await renameFiles(
    root,
    makePlan(await scanDirectory(root), { prefix: "资料_" }),
    { journal, batchId: "two" },
  );
  await renameFiles(
    root,
    journal.filter((r) => r.batchId === "two").reverse(),
    { undo: true },
  );
  assert.ok(root.items.has("第12章.txt"));
  assert.equal(root.items.has("资料_第12章.txt"), false);
  await renameFiles(
    root,
    journal.filter((r) => r.batchId === "one").reverse(),
    { undo: true },
  );
  assert.ok(root.items.has("第十二章.txt"));
});
