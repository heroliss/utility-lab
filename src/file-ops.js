import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Zip, ZipPassThrough } from "fflate";
export async function fingerprint(file, signal) {
  const hash = sha256.create(),
    reader = file.stream().getReader();
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("操作已停止", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return bytesToHex(hash.digest());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function getParent(root, path) {
  const parts = path.split("/");
  const name = parts.pop();
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  return { dir, name };
}
async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if (e.name === "TypeMismatchError") return true;
    if (e.name === "NotFoundError") return false;
    throw e;
  }
}
export async function scanDirectory(
  root,
  {
    signal,
    onProgress = () => {},
    maxFiles = 10000,
    maxEntries = 20000,
    maxDirectories = 2000,
    maxDepth = 32,
  } = {},
) {
  const files = [],
    queue = [{ dir: root, prefix: "", depth: 0 }];
  let entries = 0,
    directories = 1;
  while (queue.length) {
    if (signal?.aborted) throw new DOMException("扫描已停止", "AbortError");
    const { dir, prefix, depth } = queue.shift();
    for await (const [name, handle] of dir.entries()) {
      if (signal?.aborted) throw new DOMException("扫描已停止", "AbortError");
      if (++entries > maxEntries)
        throw new Error(
          `目录条目超过 ${maxEntries.toLocaleString()} 项，请选择更小的目录`,
        );
      const path = prefix + name;
      if (handle.kind === "directory") {
        if (depth >= maxDepth)
          throw new Error(`目录深度超过 ${maxDepth} 层，请选择更小的目录`);
        if (++directories > maxDirectories)
          throw new Error(
            `子目录超过 ${maxDirectories.toLocaleString()} 个，请选择更小的目录`,
          );
        queue.push({ dir: handle, prefix: path + "/", depth: depth + 1 });
      } else {
        const file = await handle.getFile();
        files.push({ path, size: file.size, file, handle });
      }
      if (files.length > maxFiles)
        throw new Error(
          `单次最多载入 ${maxFiles.toLocaleString()} 个文件，请选择更小的目录`,
        );
      onProgress({ files: files.length, entries, directories, path });
    }
  }
  if (signal?.aborted) throw new DOMException("扫描已停止", "AbortError");
  return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
}
export async function preflight(root, rows, { undo = false, signal } = {}) {
  for (const row of rows) {
    if (signal?.aborted) throw new DOMException("操作已停止", "AbortError");
    const source = undo ? row.after : row.path,
      target = undo ? row.path : row.after;
    const { dir, name } = await getParent(root, target);
    if (await exists(dir, name)) throw new Error(`目标已存在：${target}`);
    const current = await getParent(root, source),
      handle = await current.dir.getFileHandle(current.name),
      file = await handle.getFile();
    if (
      !undo &&
      (file.size !== row.size || file.lastModified !== row.file.lastModified)
    )
      throw new Error(`文件已变化，请重新载入：${source}`);
    if (undo && (await fingerprint(file, signal)) !== row.sha256)
      throw new Error(`内容已变化，保留文件：${source}`);
  }
}
export async function renameFiles(
  root,
  rows,
  {
    signal,
    onProgress = () => {},
    journal = [],
    undo = false,
    batchId = crypto.randomUUID(),
  } = {},
) {
  await preflight(root, rows, { undo, signal });
  const result = [];
  for (let index = 0; index < rows.length; index++) {
    if (signal?.aborted) break;
    const row = rows[index],
      from = undo ? row.after : row.path,
      to = undo ? row.path : row.after;
    onProgress(index, rows.length, from);
    const { dir: sourceDir, name: sourceName } = await getParent(root, from),
      { dir: destDir, name: destName } = await getParent(root, to);
    const sourceHandle = await sourceDir.getFileHandle(sourceName),
      source = await sourceHandle.getFile();
    if (
      !undo &&
      (source.size !== row.size ||
        source.lastModified !== row.file.lastModified)
    )
      throw new Error(`文件已变化，请重新载入：${from}`);
    if (await exists(destDir, destName)) throw new Error(`目标已存在：${to}`);
    let created = false,
      removed = false;
    try {
      const target = await destDir.getFileHandle(destName, { create: true });
      created = true;
      const writer = await target.createWritable(),
        reader = source.stream().getReader(),
        hash = sha256.create();
      try {
        while (true) {
          if (signal?.aborted)
            throw new DOMException("操作已停止", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          hash.update(value);
          await writer.write(value);
        }
        await writer.close();
      } catch (e) {
        await writer.abort().catch(() => {});
        throw e;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const digest = bytesToHex(hash.digest()),
        after = await target.getFile(),
        current = await sourceHandle.getFile();
      if (
        current.size !== source.size ||
        current.lastModified !== source.lastModified
      )
        throw new Error(`源文件已变化：${from}`);
      if (
        after.size !== source.size ||
        (await fingerprint(after, signal)) !== digest
      )
        throw new Error(`写入校验失败：${to}`);
      if (undo && digest !== row.sha256) throw new Error(`内容已变化：${from}`);
      if (signal?.aborted) throw new DOMException("操作已停止", "AbortError");
      await sourceDir.removeEntry(sourceName);
      removed = true;
      const entry = {
        path: undo ? row.path : from,
        after: undo ? row.after : to,
        size: source.size,
        sha256: digest,
        batchId: undo ? row.batchId : batchId,
      };
      result.push(entry);
      journal.push(entry);
      onProgress(index + 1, rows.length, to);
    } catch (e) {
      if (created && !removed)
        try {
          await destDir.removeEntry(destName);
        } catch (cleanup) {
          throw new Error(
            `${e.message}；原名称保留，但副本清理失败：${to}（${cleanup.message}）`,
          );
        }
      throw e;
    }
  }
  return result;
}
export async function createArchive(
  rows,
  { signal, onProgress = () => {} } = {},
) {
  const chunks = [];
  let rejectZip;
  const finished = new Promise((resolve, reject) => {
    rejectZip = reject;
    const zip = new Zip((error, data, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(data);
      if (final) resolve(new Blob(chunks, { type: "application/zip" }));
    });
    (async () => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i],
          entry = new ZipPassThrough(row.changed ? row.after : row.path);
        zip.add(entry);
        const reader = row.file.stream().getReader();
        try {
          while (true) {
            if (signal?.aborted)
              throw new DOMException("操作已停止", "AbortError");
            const { done, value } = await reader.read();
            if (done) break;
            entry.push(value, false);
          }
          entry.push(new Uint8Array(), true);
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        onProgress(i + 1, rows.length, row.after);
      }
      zip.end();
    })().catch((e) => {
      zip.terminate();
      reject(e);
    });
  });
  return finished.catch((e) => {
    rejectZip?.(e);
    throw e;
  });
}
