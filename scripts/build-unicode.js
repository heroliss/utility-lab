import fs from "node:fs/promises";
import path from "node:path";
const dir = path.resolve("public/data");
await fs.mkdir(dir, { recursive: true });
const base = "https://www.unicode.org/Public/17.0.0/ucd/";
async function get(name) {
  const response = await fetch(base + name);
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return response.text();
}
const [raw, blocks, aliasText, license] = await Promise.all([
  get("UnicodeData.txt"),
  get("Blocks.txt"),
  get("NameAliases.txt"),
  fetch("https://www.unicode.org/license.txt").then((r) => {
    if (!r.ok) throw new Error("license");
    return r.text();
  }),
]);
const aliases = new Map();
for (const line of aliasText.split(/\r?\n/)) {
  const clean = line.split("#")[0].trim();
  if (!clean) continue;
  const [hex, name] = clean.split(";");
  const cp = parseInt(hex, 16);
  if (!aliases.has(cp)) aliases.set(cp, []);
  aliases.get(cp).push(name);
}
const records = [],
  ranges = [];
let pending = null;
for (const line of raw.trim().split(/\r?\n/)) {
  const [hex, name, category] = line.split(";"),
    cp = parseInt(hex, 16);
  if (name.endsWith(", First>")) {
    pending = [cp, name.replace(", First>", ">"), category];
    continue;
  }
  if (name.endsWith(", Last>")) {
    if (!pending) throw new Error("Unmatched range");
    ranges.push([...pending, cp]);
    pending = null;
    continue;
  }
  if (category !== "Cs")
    records.push([
      cp,
      name,
      category,
      ...(aliases.has(cp) ? [aliases.get(cp)] : []),
    ]);
}
const parsedBlocks = blocks
  .split(/\r?\n/)
  .map((l) => l.split("#")[0].trim())
  .filter(Boolean)
  .map((l) => {
    const [range, name] = l.split(";").map((s) => s.trim());
    const [a, b] = range.split("..").map((s) => parseInt(s, 16));
    return [a, b, name];
  });
await fs.writeFile(
  path.join(dir, "unicode.json"),
  JSON.stringify({
    version: "17.0.0",
    source: base,
    records,
    ranges: ranges.filter((r) => r[2] !== "Cs"),
    blocks: parsedBlocks,
  }),
);
await fs.mkdir("third-party", { recursive: true });
await fs.writeFile("third-party/UNICODE-LICENSE.txt", license);
console.log(
  `Unicode 17.0.0: ${records.length} records, ${ranges.length} ranges, ${parsedBlocks.length} blocks`,
);
