const digits = new Map(
  [
    ...[
      "零〇○",
      "一壹",
      "二两兩贰貳",
      "三叁參",
      "四肆",
      "五伍",
      "六陆陸",
      "七柒",
      "八捌",
      "九玖",
    ],
  ].flatMap((group, n) => [...group].map((c) => [c, BigInt(n)])),
);
const units = new Map([
  ["十", 10n],
  ["拾", 10n],
  ["百", 100n],
  ["佰", 100n],
  ["千", 1000n],
  ["仟", 1000n],
]);
const large = new Map([
  ["万", 10000n],
  ["萬", 10000n],
  ["亿", 100000000n],
  ["億", 100000000n],
  ["兆", 1000000000000n],
]);
export function chineseNumber(text) {
  if (
    !text ||
    [...text].some((c) => !digits.has(c) && !units.has(c) && !large.has(c))
  )
    throw new Error("不是可识别的汉字数字");
  if ([...text].every((c) => digits.has(c)))
    return [...text].map((c) => digits.get(c).toString()).join("");
  // Split at the largest unit, recurse on each side; supports 万亿 without floating point.
  let max = 0n,
    at = -1;
  for (let i = 0; i < text.length; i++) {
    const value = large.get(text[i]);
    if (value && value >= max) {
      max = value;
      at = i;
    }
  }
  if (at >= 0) {
    const left = text.slice(0, at),
      right = text.slice(at + 1);
    const l = left ? BigInt(chineseNumber(left)) : 1n;
    const r = right ? BigInt(chineseNumber(right)) : 0n;
    if (r >= max) throw new Error("大数单位顺序不明确");
    return (l * max + r).toString();
  }
  let value = 0n,
    number = null,
    lastUnit = 10000n;
  for (const c of text) {
    if (digits.has(c)) {
      const n = digits.get(c);
      if (number !== null && number !== 0n) throw new Error("位值数字缺少单位");
      number = n;
    } else {
      const unit = units.get(c);
      if (unit >= lastUnit) throw new Error("单位顺序不明确");
      if (number === 0n) throw new Error("零不能直接作为单位的系数");
      value += (number ?? 1n) * unit;
      number = null;
      lastUnit = unit;
    }
  }
  return (value + (number ?? 0n)).toString();
}
const pattern =
  /[零〇○一二两兩三四五六七八九十百千万亿兆壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬億]+/gu;
export function convertName(
  name,
  { pad = 0, prefix = "", mode = "replace", maxMatches = 200 } = {},
) {
  const dot = name.lastIndexOf("."),
    hasExt = dot > 0;
  const stem = hasExt ? name.slice(0, dot) : name;
  const extension = hasExt ? name.slice(dot) : "";
  const errors = [];
  const found = [];
  let seen = 0;
  const limit = Math.max(1, Math.min(200, Number(maxMatches) || 200));
  const converted = stem.replace(pattern, (token) => {
    if (seen++ >= limit) return token;
    try {
      const number = chineseNumber(token).padStart(
        Math.min(12, Math.max(0, Number(pad) || 0)),
        "0",
      );
      found.push(number);
      return number;
    } catch (e) {
      errors.push(`${token}：${e.message}`);
      return token;
    }
  });
  return {
    name:
      prefix +
      (mode === "prepend"
        ? found.length
          ? found.join("-") + " " + stem
          : stem
        : converted) +
      extension,
    errors,
  };
}
export const pathKey = (path) =>
  path.normalize("NFC").toLocaleLowerCase("en-US");
export function invalidName(name) {
  if (!name || /[<>:"/\\|?*\x00-\x1f]/u.test(name) || /[. ]$/u.test(name))
    return "文件名含不支持的字符、末尾空格或点";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name))
    return "Windows 保留文件名";
  if (name.length > 240) return "文件名过长";
  return "";
}
export function makePlan(files, options = {}) {
  const originals = new Set(files.map((f) => pathKey(f.path)));
  const rows = files.map((file, index) => {
    const parts = file.path.split("/"),
      before = parts.pop();
    const { name, errors } = convertName(before, options);
    const parent = parts.join("/"),
      after = parent ? `${parent}/${name}` : name;
    return {
      ...file,
      id: index,
      before,
      afterName: name,
      after,
      changed: after !== file.path,
      selected: after !== file.path,
      error: errors.join("；") || invalidName(name),
    };
  });
  const targets = new Map();
  for (const row of rows) {
    if (!row.changed) continue;
    const key = pathKey(row.after);
    if (originals.has(key) && key !== pathKey(row.path))
      row.error = "目标名称已存在";
    if (targets.has(key)) {
      row.error = "多个文件使用同一目标名称";
      targets.get(key).error = row.error;
    } else targets.set(key, row);
  }
  return rows;
}
