import test from "node:test";
import assert from "node:assert/strict";
import {
  chineseNumber,
  convertName,
  makePlan,
  invalidName,
} from "../src/rename-core.js";
import {
  encodeCharacter,
  parseCodePoint,
  filterUnicode,
  rangeName,
  expandUnicode,
} from "../src/unicode-core.js";
import fs from "node:fs/promises";
test("Chinese values, financial forms, literal year and BigInt precision", () => {
  for (const [a, b] of [
    ["十", "10"],
    ["十二", "12"],
    ["一百零二", "102"],
    ["一千零一十", "1010"],
    ["一万零三十", "10030"],
    ["两亿三千万", "230000000"],
    ["一万亿", "1000000000000"],
    ["壹佰零捌", "108"],
    ["貳仟零陸", "2006"],
    ["二〇二六", "2026"],
    ["〇〇一", "001"],
    ["九千兆", "9000000000000000"],
  ])
    assert.equal(chineseNumber(a), b, a);
});
test("Rejects malformed unit sequence rather than silent output", () => {
  for (const s of [
    "十十",
    "百千",
    "一千二三",
    "三〇一百",
    "三零一百",
    "二零十",
    "零十",
    "abc",
  ])
    assert.throws(() => chineseNumber(s));
  const unchanged = convertName("记录三〇一百.txt");
  assert.equal(unchanged.name, "记录三〇一百.txt");
  assert.equal(unchanged.errors.length, 1);
});
test("Original extract-to-front mode and segment limit preserve unmatched text", () => {
  const name = "第一章第二节第三小节五题.txt";
  assert.equal(
    convertName(name, { maxMatches: 2 }).name,
    "第1章第2节第三小节五题.txt",
  );
  assert.equal(
    convertName(name, { mode: "prepend", maxMatches: 2 }).name,
    "1-2 第一章第二节第三小节五题.txt",
  );
  assert.equal(
    convertName("文件十二.txt", { mode: "prepend", pad: 3, prefix: "资料_" })
      .name,
    "资料_012 文件十二.txt",
  );
});
test("Extension, parent directory and optional padding stay separate", () => {
  assert.equal(convertName("第十二章.三").name, "第12章.三");
  assert.equal(
    convertName("文件九.txt", { pad: 3, prefix: "素材_" }).name,
    "素材_文件009.txt",
  );
  const [r] = makePlan([{ path: "第一章/文件十二.txt", size: 0 }]);
  assert.equal(r.after, "第一章/文件12.txt");
});
test("Conflicts include Windows case-folded existing paths and repeated targets", () => {
  const rows = makePlan([
    { path: "文件一.TXT" },
    { path: "文件1.txt" },
    { path: "第十.txt" },
    { path: "第壹拾.txt" },
  ]);
  assert.match(rows[0].error, /已存在/);
  assert.match(rows[2].error, /多个/);
  assert.match(rows[3].error, /多个/);
});
test("Windows reserved and invalid file names are blocked", () => {
  for (const s of ["CON.txt", "lpt1", "name.", "name ", "a/b", "a\\b", "bad?"])
    assert.ok(invalidName(s));
  assert.equal(invalidName("正常_12.txt"), "");
});
test("BMP and supplementary character encodings are scalar-correct", () => {
  const bmp = encodeCharacter(0x4f60),
    rocket = encodeCharacter(0x1f680);
  assert.equal(bmp.char, "你");
  assert.equal(bmp.utf8, "E4 BD A0");
  assert.equal(rocket.char, "🚀");
  assert.equal(rocket.utf16, "D83D DE80");
  assert.equal(rocket.utf8, "F0 9F 9A 80");
  assert.equal(rocket.javascript, "\\u{1F680}");
  assert.equal(rocket.html, "&#x1F680;");
  for (const cp of [-1, 0xd800, 0xdfff, 0x110000])
    assert.throws(() => encodeCharacter(cp));
});
test("Code point syntax and literal strings work without splitting surrogate pairs", () => {
  for (const q of ["U+1F680", "0x1f680", "#128640", "1F680"])
    assert.equal(parseCodePoint(q), 0x1f680);
  assert.equal(parseCodePoint("U+D800"), null);
  const rows = [
    { cp: 0x1f680, name: "ROCKET", cat: "So" },
    { cp: 0x4f60, name: "CJK UNIFIED IDEOGRAPH-4F60", cat: "Lo" },
    { cp: 0x597d, name: "CJK UNIFIED IDEOGRAPH-597D", cat: "Lo" },
  ];
  assert.equal(filterUnicode(rows, { query: "🚀" })[0].cp, 0x1f680);
  assert.equal(filterUnicode(rows, { query: "你好" }).length, 2);
  assert.equal(
    filterUnicode(rows, { query: "rocket", category: "S" }).length,
    1,
  );
});
test("Algorithmic CJK and Hangul names reflect range positions", () => {
  assert.equal(rangeName(0xac00, "<Hangul>"), "HANGUL SYLLABLE GA");
  assert.equal(rangeName(0xd7a3, "<Hangul>"), "HANGUL SYLLABLE HIH");
  assert.equal(
    rangeName(0x20000, "<CJK Ideograph Extension B>"),
    "CJK UNIFIED IDEOGRAPH-20000",
  );
});
test("Official aliases name controls and can also be searched", () => {
  const rows = expandUnicode({
    records: [[0, "<control>", "Cc", ["NULL", "NUL"]]],
    ranges: [],
  });
  assert.equal(rows[0].name, "NULL");
  assert.equal(filterUnicode(rows, { query: "NUL" }).length, 1);
});
test("Bundled official database includes supplementary planes, blocks and sorted scalars", async () => {
  const data = JSON.parse(
    await fs.readFile(
      new URL("../public/data/unicode.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(data.version, "17.0.0");
  const rows = expandUnicode(data);
  assert.ok(rows.length > 200000);
  assert.ok(rows.some((r) => r.cp === 0x1f680 && r.name === "ROCKET"));
  assert.ok(rows.some((r) => r.cp === 0x20000));
  assert.ok(rows.every((r, i) => i === 0 || r.cp > rows[i - 1].cp));
  assert.ok(rows.every((r) => r.cp < 0xd800 || r.cp > 0xdfff));
  assert.ok(data.blocks.length > 300);
});
