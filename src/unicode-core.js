export const PAGE_SIZE = 60;
const l = [
  "G",
  "GG",
  "N",
  "D",
  "DD",
  "R",
  "M",
  "B",
  "BB",
  "S",
  "SS",
  "",
  "J",
  "JJ",
  "C",
  "K",
  "T",
  "P",
  "H",
];
const v = [
  "A",
  "AE",
  "YA",
  "YAE",
  "EO",
  "E",
  "YEO",
  "YE",
  "O",
  "WA",
  "WAE",
  "OE",
  "YO",
  "U",
  "WEO",
  "WE",
  "WI",
  "YU",
  "EU",
  "YI",
  "I",
];
const t = [
  "",
  "G",
  "GG",
  "GS",
  "N",
  "NJ",
  "NH",
  "D",
  "L",
  "LG",
  "LM",
  "LB",
  "LS",
  "LT",
  "LP",
  "LH",
  "M",
  "B",
  "BS",
  "S",
  "SS",
  "NG",
  "J",
  "C",
  "K",
  "T",
  "P",
  "H",
];
export function rangeName(cp, source) {
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    const s = cp - 0xac00;
    return (
      "HANGUL SYLLABLE " +
      l[Math.floor(s / 588)] +
      v[Math.floor((s % 588) / 28)] +
      t[s % 28]
    );
  }
  if (source.includes("CJK"))
    return "CJK UNIFIED IDEOGRAPH-" + cp.toString(16).toUpperCase();
  if (source.includes("Tangut"))
    return "TANGUT IDEOGRAPH-" + cp.toString(16).toUpperCase();
  return source.replace(/[<>]/g, "") + "-" + cp.toString(16).toUpperCase();
}
export function expandUnicode(data) {
  const rows = data.records.map((r) => ({
    cp: r[0],
    name: r[1] === "<control>" && r[3]?.length ? r[3][0] : r[1],
    cat: r[2],
    aliases: r[3] || [],
  }));
  for (const [start, name, cat, end] of data.ranges)
    for (let cp = start; cp <= end; cp++)
      rows.push({ cp, name: rangeName(cp, name), cat });
  return rows.sort((a, b) => a.cp - b.cp);
}
export function parseCodePoint(query) {
  const q = query.trim();
  let number;
  if (/^U\+[0-9a-f]{1,6}$/iu.test(q)) number = parseInt(q.slice(2), 16);
  else if (/^0x[0-9a-f]{1,6}$/iu.test(q)) number = parseInt(q.slice(2), 16);
  else if (/^#[0-9]+$/u.test(q)) number = Number(q.slice(1));
  else if (/^[0-9a-f]{4,6}$/iu.test(q)) number = parseInt(q, 16);
  return Number.isInteger(number) &&
    number >= 0 &&
    number <= 0x10ffff &&
    !(number >= 0xd800 && number <= 0xdfff)
    ? number
    : null;
}
export function encodeCharacter(cp) {
  if (
    !Number.isInteger(cp) ||
    cp < 0 ||
    cp > 0x10ffff ||
    (cp >= 0xd800 && cp <= 0xdfff)
  )
    throw new Error("无效 Unicode 标量");
  const char = String.fromCodePoint(cp),
    hex = cp.toString(16).toUpperCase();
  return {
    char,
    code: `U+${hex.padStart(4, "0")}`,
    decimal: String(cp),
    utf8: [...new TextEncoder().encode(char)]
      .map((n) => n.toString(16).toUpperCase().padStart(2, "0"))
      .join(" "),
    utf16: Array.from({ length: char.length }, (_, i) =>
      char.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0"),
    ).join(" "),
    html: `&#x${hex};`,
    javascript: cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`,
    css: `\\${hex} `,
  };
}
export function filterUnicode(
  rows,
  { query = "", category = "", block = null } = {},
) {
  const q = query.trim(),
    cp = parseCodePoint(q),
    direct = [...q],
    literal = /[^\x20-\x7e]/u.test(q)
      ? new Set(direct.map((c) => c.codePointAt(0)))
      : null;
  return rows.filter((row) => {
    if (category && !row.cat.startsWith(category)) return false;
    if (block && (row.cp < block[0] || row.cp > block[1])) return false;
    if (!q) return true;
    if (cp !== null) return row.cp === cp;
    if (literal) return literal.has(row.cp);
    if (direct.length === 1) return row.cp === q.codePointAt(0);
    const name = row.name + " " + (row.aliases || []).join(" ");
    return q
      .toUpperCase()
      .split(/\s+/u)
      .every((token) => name.includes(token));
  });
}
