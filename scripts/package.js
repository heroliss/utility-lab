import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { zipSync, strToU8 } from "fflate";
const dest = path.resolve(
  process.argv[2] || "../../releases/utility-lab-v1.0.0",
);
await fs.mkdir(dest, { recursive: false });
const files = {},
  manifest = [];
async function walk(dir, prefix = "") {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name,
      full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, rel + "/");
    else {
      const data = await fs.readFile(full);
      files[rel] = new Uint8Array(data);
      manifest.push({
        path: rel,
        size: data.length,
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
await walk("dist");
files["README.txt"] = strToU8(
  "Liss Utilities v1.0.0\nStatic web app. Serve this directory with HTTP(S), for example: python -m http.server 8765\nOpen http://127.0.0.1:8765/ . Worker modules do not support file:// .\nAll user files remain in the browser; no file upload API. See source README for directory-write/undo limitations.\nSource: https://github.com/heroliss/utility-lab\n",
);
files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
const filename = "Liss-Utilities-v1.0.0-Web.zip",
  bytes = zipSync(files, { level: 6 }),
  hash = crypto.createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(path.join(dest, filename), bytes);
await fs.writeFile(path.join(dest, "SHA256SUMS.txt"), `${hash}  ${filename}\n`);
await fs.writeFile(
  path.join(dest, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  JSON.stringify({
    dest,
    filename,
    bytes: bytes.length,
    sha256: hash,
    files: manifest.length,
  }),
);
