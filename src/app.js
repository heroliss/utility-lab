import "./style.css";
import { makePlan } from "./rename-core.js";
import { encodeCharacter, PAGE_SIZE } from "./unicode-core.js";
import { scanDirectory, renameFiles, createArchive } from "./file-ops.js";
const $ = (id) => document.getElementById(id),
  escape = (s) =>
    String(s).replace(
      /[&<>"']/gu,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const categories = {
  L: "字母与汉字",
  M: "组合标记",
  N: "数字",
  P: "标点",
  S: "符号",
  Z: "分隔符",
  C: "控制与其他",
};
$("app").innerHTML =
  `<div class="app-shell"><header><a class="brand" href="#unicode"><span class="brand-mark">∴</span>Liss Utilities</a><div class="header-links"><span class="local-dot">文件仅在本机处理</span><a href="https://heroliss.github.io/liss-works/" target="_blank" rel="noopener">Liss Works</a><a href="https://github.com/heroliss/utility-lab" target="_blank" rel="noopener">源码</a></div></header><nav class="tool-tabs" role="tablist" aria-label="选择工具"><button id="tab-unicode" role="tab" aria-controls="unicode-tool">Unicode 字符表</button><button id="tab-rename" role="tab" aria-controls="rename-tool">汉字数字重命名</button></nav>
<main><section id="unicode-tool" role="tabpanel" aria-labelledby="tab-unicode"><div class="tool-heading"><div><h1>找到字符，读懂编码</h1><p>从字符本身、码点或英文名称开始，查看 Unicode 标量与不同编码的对应关系。</p></div><span class="badge" id="unicode-version">加载字符数据库…</span></div><div class="search-bar"><div class="search-wrap"><input id="unicode-query" type="search" placeholder="输入字符、U+1F680、#128640 或英文名称" aria-label="搜索 Unicode 字符"></div><select id="unicode-category" aria-label="字符类别"><option value="">全部类别</option>${Object.entries(
    categories,
  )
    .map(([v, n]) => `<option value="${v}">${n}</option>`)
    .join(
      "",
    )}</select><select id="unicode-block" aria-label="Unicode 区块"><option value="symbols">常用符号</option><option value="">全部 Unicode 区块</option></select></div><div class="unicode-workspace"><div><div class="character-panel"><div class="result-summary"><span id="result-count">正在索引字符…</span><span id="result-category">点击字符查看详情</span></div><div class="character-grid" id="character-grid" aria-label="字符搜索结果"><p class="empty">正在加载本地字符数据库…</p></div><div class="pager"><span id="page-label"></span><div class="pagination-buttons"><button id="previous-page" disabled>上一页</button><button id="next-page" disabled>下一页</button></div></div></div><div class="unicode-tips"><span>试一试</span><button class="quick" data-query="ARROW">箭头</button><button class="quick" data-query="SNOWFLAKE">雪花</button><button class="quick" data-query="你好">汉字</button><button class="quick" data-query="U+1F680">补充平面</button><button class="quick" data-query="U+0301">组合字符</button></div></div><aside class="inspector" id="inspector" aria-label="字符编码详情"></aside></div></section>
<section id="rename-tool" role="tabpanel" aria-labelledby="tab-rename" hidden><div class="tool-heading"><div><h1>先看清变化，再统一命名</h1><p>将文件名中的汉字数字转成阿拉伯数字。保留扩展名与目录结构，逐项选择需要处理的文件。</p></div><span class="badge">本地文件工具</span></div><div class="rename-layout"><aside class="rename-settings"><h3>命名规则</h3><label class="stacked">处理方式<select id="rename-mode"><option value="replace">替换汉字数字</option><option value="prepend">提取数字，放到前方</option></select></label><label class="stacked">最多处理段数<select id="rename-limit"><option value="200">全部数字段</option><option value="1">前 1 段</option><option value="2">前 2 段</option><option value="3">前 3 段</option></select></label><label class="stacked">数字最少位数<select id="rename-pad"><option value="0">保留原位数</option><option value="2">2 位：01、02</option><option value="3">3 位：001、002</option><option value="4">4 位：0001、0002</option></select></label><label class="stacked">文件名前缀<input id="rename-prefix" maxlength="60" placeholder="可选，如：素材_"></label><p class="setting-help">支持普通与大写数字、位值单位和逐位数字。只改文件名，不更改目录名称。</p><div class="rule-preview">转换示例<code>第十二章 → 第12章</code><code>二〇二六 → 2026</code><code>壹佰零捌 → 108</code></div></aside><div><div class="rename-toolbar"><button id="choose-folder" class="primary">选择文件夹</button><button id="choose-files">选择文件</button><button id="load-examples" class="quiet">载入示例</button><span id="folder-label" class="folder-label"></span></div><div class="rename-stats"><div class="stat"><strong id="files-total">0</strong><span>已载入文件</span></div><div class="stat changed"><strong id="files-changed">0</strong><span>可执行更名</span></div><div class="stat conflict"><strong id="files-conflicts">0</strong><span>需要处理</span></div></div><div class="table-wrap"><table><thead><tr><th><input id="select-all" type="checkbox" aria-label="选择全部可处理文件"></th><th>原文件名</th><th>预览名称</th><th>状态</th></tr></thead><tbody id="rename-rows"></tbody></table></div><div class="rename-actions"><button id="download-zip" class="primary" disabled>下载改名副本 ZIP</button><button id="apply-rename" disabled>在目录中执行</button><button id="cancel-operation" class="danger" hidden>停止操作</button><p id="total-size"></p></div><div class="statusbar" id="rename-status" role="status"></div><progress id="operation-progress" value="0" max="1" hidden></progress><div class="rename-bottom"><p id="rename-support">ZIP 导出保留原件。直接改名需要桌面版 Chrome / Edge 的目录写入能力；执行前会再次校验文件，已完成部分可撤销。</p><div class="tiny-actions"><button id="undo-rename" disabled>撤销上一批</button><button id="export-journal" disabled>保存操作记录</button><button id="import-journal">载入记录</button></div></div></div></div><input id="file-input" type="file" multiple hidden><input id="folder-input" type="file" webkitdirectory multiple hidden><input id="journal-input" type="file" accept="application/json,.json" hidden></section></main><footer><span>字符查询与文件命名，在浏览器里完成。</span><span>Unicode 数据来自 Unicode Consortium；字符显示取决于设备字体。</span></footer></div><dialog id="rename-confirm"><h2>确认目录中的改名</h2><p id="confirm-description"></p><p>文件先复制并校验 SHA-256，验证通过后移除原名称。请保持页面打开，并避免其他程序同时改动这些文件。</p><div class="dialog-actions"><button id="dismiss-confirm">返回预览</button><button id="confirm-rename" class="primary">确认执行</button></div></dialog><div class="toast" id="toast" role="status" hidden></div>`;
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2200);
}
function switchTool(tool) {
  for (const key of ["unicode", "rename"]) {
    $(`tab-${key}`).setAttribute("aria-selected", String(key === tool));
    $(`tab-${key}`).tabIndex = key === tool ? 0 : -1;
    $(`${key}-tool`).hidden = key !== tool;
  }
  history.replaceState(null, "", `#${tool}`);
}
for (const key of ["unicode", "rename"])
  $(`tab-${key}`).onclick = () => switchTool(key);
switchTool(location.hash === "#rename" ? "rename" : "unicode");
document.querySelector(".brand").onclick = (event) => {
  event.preventDefault();
  switchTool("unicode");
};
document.querySelector(".tool-tabs").onkeydown = (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const key =
      event.key === "Home"
        ? "unicode"
        : event.key === "End"
          ? "rename"
          : $("tab-unicode").getAttribute("aria-selected") === "true"
            ? "rename"
            : "unicode";
    switchTool(key);
    $(`tab-${key}`).focus();
  }
};
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
  } catch {
    toast("复制不可用，请从详情中手动选择文本");
  }
}
let currentCharacter = { cp: 0x2192, name: "RIGHTWARDS ARROW", cat: "Sm" };
function glyph(row) {
  if (row.cat.startsWith("M")) return "◌" + String.fromCodePoint(row.cp);
  if (["Cc", "Cf", "Zl", "Zp", "Zs"].includes(row.cat)) return "◻";
  return String.fromCodePoint(row.cp);
}
function inspect(row) {
  currentCharacter = row;
  const enc = encodeCharacter(row.cp),
    details = [
      ["UTF-8", enc.utf8],
      ["UTF-16", enc.utf16],
      ["十进制", enc.decimal],
      ["HTML", enc.html],
      ["JavaScript", enc.javascript],
      ["CSS", enc.css],
    ];
  $("inspector").innerHTML =
    `<div class="big-glyph">${escape(glyph(row))}</div><h2 class="inspector-title mono">${enc.code}</h2><p class="character-name">${escape(row.name)}</p><button class="primary copy-glyph" id="copy-character">复制字符</button><dl class="encoding-list">${details.map(([key, value], i) => `<div class="encoding-row"><dt>${key}</dt><dd class="mono">${escape(value)}</dd><button class="copy-icon" data-copy-index="${i}" aria-label="复制 ${key}" title="复制 ${key}">⧉</button></div>`).join("")}</dl><p class="inspector-foot">类别 ${row.cat} · ${categories[row.cat[0]] || "其他"}<br>组合标记前的虚线圆仅用于展示，复制内容不含虚线圆。空白与控制字符用占位符展示。</p>`;
  $("copy-character").onclick = () => copy(enc.char);
  document
    .querySelectorAll("[data-copy-index]")
    .forEach(
      (b) => (b.onclick = () => copy(details[Number(b.dataset.copyIndex)][1])),
    );
  document
    .querySelectorAll("[data-cp]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.cp) === row.cp)),
    );
}
inspect(currentCharacter);
const worker = new Worker(new URL("./unicode-worker.js", import.meta.url), {
  type: "module",
});
let ready = false,
  page = 0,
  requestId = 0,
  total = 0,
  blockData = [],
  debounce;
function queryUnicode() {
  if (!ready) return;
  const val = $("unicode-block").value,
    block =
      val === "symbols"
        ? [0x2190, 0x2bff]
        : val
          ? blockData[Number(val)]
          : null;
  worker.postMessage({
    type: "query",
    id: ++requestId,
    query: $("unicode-query").value,
    category: $("unicode-category").value,
    block: block ? block.slice(0, 2) : null,
    page,
  });
}
worker.onmessage = ({ data }) => {
  if (data.type === "ready") {
    ready = true;
    blockData = data.blocks;
    $("unicode-version").textContent = `Unicode ${data.version}`;
    $("unicode-block").insertAdjacentHTML(
      "beforeend",
      data.blocks
        .map((b, i) => `<option value="${i}">${escape(b[2])}</option>`)
        .join(""),
    );
    queryUnicode();
  } else if (data.type === "result" && data.id === requestId) {
    total = data.total;
    $("result-count").textContent = `${total.toLocaleString("zh-CN")} 个字符`;
    $("page-label").textContent = total
      ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total.toLocaleString("zh-CN")}`
      : "没有匹配字符";
    $("previous-page").disabled = page === 0;
    $("next-page").disabled = (page + 1) * PAGE_SIZE >= total;
    $("character-grid").innerHTML = data.rows.length
      ? data.rows
          .map(
            (row) =>
              `<button class="character" data-cp="${row.cp}" aria-pressed="${row.cp === currentCharacter.cp}" title="${escape(row.name)}"><span class="glyph">${escape(glyph(row))}</span><code>${row.cp.toString(16).toUpperCase().padStart(4, "0")}</code></button>`,
          )
          .join("")
      : '<p class="empty">没有匹配结果。试试直接粘贴字符，或用 U+ 码点搜索。</p>';
    const byCp = new Map(data.rows.map((r) => [r.cp, r]));
    document
      .querySelectorAll("[data-cp]")
      .forEach(
        (b) => (b.onclick = () => inspect(byCp.get(Number(b.dataset.cp)))),
      );
    if (data.rows.length === 1) inspect(data.rows[0]);
  } else if (data.type === "error") {
    $("result-count").textContent = "数据库加载失败";
    $("character-grid").innerHTML =
      `<p class="empty">${escape(data.message)}。请刷新页面重试。</p>`;
  }
};
worker.postMessage({
  type: "init",
  url: new URL("data/unicode.json", document.baseURI).href,
});
$("unicode-query").oninput = () => {
  page = 0;
  if ($("unicode-query").value) $("unicode-block").value = "";
  clearTimeout(debounce);
  debounce = setTimeout(queryUnicode, 100);
};
for (const id of ["unicode-category", "unicode-block"])
  $(id).onchange = () => {
    page = 0;
    queryUnicode();
  };
$("previous-page").onclick = () => {
  page--;
  queryUnicode();
};
$("next-page").onclick = () => {
  page++;
  queryUnicode();
};
document.querySelectorAll("[data-query]").forEach(
  (b) =>
    (b.onclick = () => {
      $("unicode-query").value = b.dataset.query;
      $("unicode-block").value = "";
      $("unicode-category").value = "";
      page = 0;
      queryUnicode();
    }),
);
let files = [],
  rows = [],
  rootHandle = null,
  rootName = "",
  busy = false,
  controller = null,
  journal = [];
const readableSize = (size) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : size < 1073741824
        ? `${(size / 1048576).toFixed(1)} MB`
        : `${(size / 1073741824).toFixed(2)} GB`;
function status(text, error = false) {
  $("rename-status").textContent = text;
  $("rename-status").classList.toggle("error", error);
}
function selectedRows() {
  return rows.filter((r) => r.selected && r.changed && !r.error);
}
function refreshButtons() {
  const count = selectedRows().length;
  $("download-zip").disabled = busy || !count;
  $("apply-rename").disabled = busy || !count || !rootHandle;
  $("undo-rename").disabled = busy || !journal.length || !rootHandle;
  $("export-journal").disabled = busy || !journal.length;
  $("choose-folder").disabled = busy;
  $("choose-files").disabled = busy;
  $("load-examples").disabled = busy;
  $("rename-pad").disabled = busy;
  $("rename-prefix").disabled = busy;
  $("rename-mode").disabled = busy;
  $("rename-limit").disabled = busy;
  $("select-all").disabled = busy;
  $("import-journal").disabled = busy;
  document
    .querySelectorAll("[data-row]")
    .forEach(
      (b) =>
        (b.disabled =
          busy ||
          !!rows[Number(b.dataset.row)].error ||
          !rows[Number(b.dataset.row)].changed),
    );
  $("cancel-operation").hidden = !busy;
  $("files-changed").textContent = count;
  $("total-size").textContent =
    `选中 ${count} 项 · ${readableSize(selectedRows().reduce((s, r) => s + r.size, 0))}`;
}
function preview() {
  rows = makePlan(files, {
    pad: $("rename-pad").value,
    prefix: $("rename-prefix").value,
    mode: $("rename-mode").value,
    maxMatches: $("rename-limit").value,
  });
  $("files-total").textContent = rows.length;
  $("files-conflicts").textContent = rows.filter((r) => r.error).length;
  $("folder-label").textContent = rootName || "尚未选择目录";
  $("rename-rows").innerHTML = rows.length
    ? rows
        .map(
          (r, i) =>
            `<tr class="${r.error ? "conflict-row" : ""}"><td><input type="checkbox" data-row="${i}" aria-label="选择 ${escape(r.before)}" ${r.selected && !r.error ? "checked" : ""} ${r.error || !r.changed ? "disabled" : ""}></td><td>${escape(r.before)}${r.path.includes("/") ? `<small class="file-parent">${escape(r.path.slice(0, r.path.lastIndexOf("/")))}</small>` : ""}</td><td>${escape(r.afterName)}</td><td><span class="status-label ${r.error ? "error" : r.changed ? "ready" : ""}">${escape(r.error || (r.changed ? "可处理" : "无需更改"))}</span></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">选择文件或文件夹，查看逐项改名预览。也可以先载入示例。</td></tr>';
  for (const row of rows) if (row.error) row.selected = false;
  document.querySelectorAll("[data-row]").forEach(
    (b) =>
      (b.onchange = () => {
        rows[Number(b.dataset.row)].selected = b.checked;
        refreshButtons();
      }),
  );
  $("select-all").checked = selectedRows().length > 0;
  $("select-all").onchange = () => {
    for (const r of rows)
      r.selected = $("select-all").checked && r.changed && !r.error;
    document
      .querySelectorAll("[data-row]")
      .forEach((b) => (b.checked = rows[Number(b.dataset.row)].selected));
    refreshButtons();
  };
  refreshButtons();
}
function loadExamples() {
  rootHandle = null;
  rootName = "示例文件 · 原件不会写入磁盘";
  files = [
    "旅行笔记/第十二章 初到海边.txt",
    "旅行笔记/第二十一章 夜航.txt",
    "照片/二〇二六年五月的风.jpg",
    "练习/壹佰零捌式.md",
    "音乐/曲目九.flac",
    "记录/已是数字_12.txt",
  ].map((path, i) => {
    const file = new File(
      [`Liss Utilities 示例内容 ${i}\n`],
      path.split("/").pop(),
      { type: "text/plain" },
    );
    return { path, size: file.size, file };
  });
  preview();
  status("示例已载入。选择文件夹后可处理自己的文件。");
}
$("load-examples").onclick = loadExamples;
$("choose-files").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => {
  if (e.target.files.length > 10000) {
    status("单次最多载入 10,000 个文件。", true);
    e.target.value = "";
    return;
  }
  rootHandle = null;
  rootName = "已选择文件 · 导出副本模式";
  files = [...e.target.files].map((file) => ({
    file,
    path: file.name,
    size: file.size,
  }));
  preview();
  status("文件已载入，尚未进行任何修改。");
  e.target.value = "";
};
$("choose-folder").onclick = async () => {
  if (!window.showDirectoryPicker) {
    $("folder-input").click();
    return;
  }
  try {
    const chosen = await showDirectoryPicker({ mode: "read" });
    await operation(async (signal) => {
      $("operation-progress").removeAttribute("value");
      status(`正在扫描「${chosen.name}」…`);
      const loaded = await scanDirectory(chosen, {
        signal,
        onProgress: (progress) =>
          status(
            `扫描中 · ${progress.files} 个文件 / ${progress.directories} 个目录 · ${progress.path}`,
          ),
      });
      rootHandle = chosen;
      rootName = chosen.name;
      files = loaded;
      preview();
      status(`已载入 ${files.length} 个文件，尚未进行任何修改。`);
    });
  } catch (e) {
    if (e.name !== "AbortError") status(e.message, true);
  }
};
$("folder-input").onchange = (e) => {
  if (e.target.files.length > 10000) {
    status("单次最多载入 10,000 个文件，请选择更小的目录。", true);
    e.target.value = "";
    return;
  }
  rootHandle = null;
  rootName = "已选择目录 · 导出副本模式";
  files = [...e.target.files].map((file) => ({
    file,
    path: file.webkitRelativePath.split("/").slice(1).join("/"),
    size: file.size,
  }));
  preview();
  status("当前浏览器仅支持导出副本；目录结构会保留。");
  e.target.value = "";
};
for (const id of ["rename-pad", "rename-prefix", "rename-mode", "rename-limit"])
  $(id).oninput = () => {
    preview();
    status("预览已更新。");
  };
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function progress(done, total, path) {
  $("operation-progress").max = total || 1;
  $("operation-progress").value = done;
  status(`${done} / ${total} · ${path}`);
}
async function operation(run) {
  busy = true;
  controller = new AbortController();
  $("operation-progress").hidden = false;
  refreshButtons();
  try {
    await run(controller.signal);
  } catch (e) {
    status(
      e.name === "AbortError"
        ? `操作已停止。未完成项没有更改；已完成的目录改名可撤销。`
        : e.message,
      true,
    );
  } finally {
    busy = false;
    $("operation-progress").hidden = true;
    refreshButtons();
  }
}
$("cancel-operation").onclick = () => {
  controller?.abort();
  status("正在停止…");
};
$("download-zip").onclick = () => {
  const chosen = selectedRows();
  if (chosen.reduce((s, r) => s + r.size, 0) > 200 * 1024 * 1024) {
    status(
      "ZIP 导出单次上限 200 MB，请减少选中项，或在支持的浏览器中直接改名。",
      true,
    );
    return;
  }
  operation(async (signal) => {
    const blob = await createArchive(chosen, { signal, onProgress: progress });
    download(blob, "Liss-重命名副本.zip");
    status(
      `已生成 ${chosen.length} 个改名副本 · ${readableSize(blob.size)}，原件未变。`,
    );
  });
};
$("apply-rename").onclick = () => {
  $("confirm-description").textContent =
    `将更改「${rootName}」中的 ${selectedRows().length} 个文件名。遇到已存在的目标会停止，不会覆盖。`;
  $("rename-confirm").showModal();
};
$("dismiss-confirm").onclick = () => $("rename-confirm").close();
$("confirm-rename").onclick = async () => {
  $("rename-confirm").close();
  try {
    if (
      (await rootHandle.requestPermission({ mode: "readwrite" })) !== "granted"
    ) {
      status("未获得目录写入权限，仍可导出 ZIP 副本。", true);
      return;
    }
    const chosen = selectedRows();
    await operation(async (signal) => {
      await renameFiles(rootHandle, chosen, {
        signal,
        onProgress: progress,
        journal,
      });
      status(`已改名 ${journal.length} 项，可撤销或保存操作记录。`);
    });
    files = await scanDirectory(rootHandle);
    preview();
  } catch (e) {
    status(e.message, true);
    refreshButtons();
  }
};
$("undo-rename").onclick = () =>
  operation(async (signal) => {
    const completed = [];
    const lastBatch = journal.at(-1)?.batchId;
    const batch = journal.filter((row) => row.batchId === lastBatch);
    try {
      await renameFiles(rootHandle, [...batch].reverse(), {
        signal,
        onProgress: progress,
        journal: completed,
        undo: true,
      });
    } finally {
      for (const item of completed)
        journal = journal.filter(
          (j) =>
            !(
              j.after === item.after &&
              j.path === item.path &&
              j.batchId === item.batchId
            ),
        );
      files = await scanDirectory(rootHandle);
      preview();
    }
    status(
      journal.length
        ? `已撤销部分，剩余 ${journal.length} 项。`
        : "记录中的改名已全部撤销。",
    );
  });
$("export-journal").onclick = () =>
  download(
    new Blob(
      [
        JSON.stringify(
          {
            format: "liss-rename-journal-v1",
            rootName,
            createdAt: new Date().toISOString(),
            entries: journal,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "Liss-重命名操作记录.json",
  );
$("import-journal").onclick = () => $("journal-input").click();
$("journal-input").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error("记录文件过大");
    const data = JSON.parse(await file.text());
    if (
      data.format !== "liss-rename-journal-v1" ||
      !Array.isArray(data.entries) ||
      data.entries.length > 10000
    )
      throw new Error("不支持的操作记录");
    for (const row of data.entries)
      for (const key of ["path", "after"])
        if (
          typeof row[key] !== "string" ||
          row[key].split("/").some((p) => !p || p === "." || p === "..") ||
          /[\\\x00]/u.test(row[key])
        )
          throw new Error("记录中存在不安全的路径");
    if (
      data.entries.some(
        (r) =>
          !Number.isSafeInteger(r.size) ||
          r.size < 0 ||
          !/^[a-f0-9]{64}$/u.test(r.sha256),
      )
    )
      throw new Error("记录校验不完整");
    journal = data.entries;
    status(
      `已载入 ${journal.length} 项操作记录。请选择原目录「${data.rootName}」后撤销；内容变化的文件会保留。`,
    );
    refreshButtons();
  } catch (err) {
    status(err.message, true);
  } finally {
    e.target.value = "";
  }
};
loadExamples();
