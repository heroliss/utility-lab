import {
  expandUnicode,
  filterUnicode,
  parseCodePoint,
  PAGE_SIZE,
} from "./unicode-core.js";
let rows = [],
  meta = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const r = await fetch(data.url);
      if (!r.ok) throw new Error("字符数据库无法加载");
      meta = await r.json();
      rows = expandUnicode(meta);
      postMessage({
        type: "ready",
        count: rows.length,
        blocks: meta.blocks,
        version: meta.version,
      });
      return;
    }
    if (data.type === "query") {
      const found = filterUnicode(rows, data),
        cp = parseCodePoint(data.query);
      if (!found.length && cp !== null && !data.category && !data.block)
        found.push({
          cp,
          cat: "Cn",
          name:
            (cp & 0xffff) >= 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef)
              ? "NONCHARACTER"
              : "UNASSIGNED",
        });
      postMessage({
        type: "result",
        id: data.id,
        total: found.length,
        page: data.page,
        rows: found.slice(data.page * PAGE_SIZE, (data.page + 1) * PAGE_SIZE),
      });
    }
  } catch (e) {
    postMessage({ type: "error", message: e.message });
  }
};
