import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

// The real toolbar and styles.css in Chromium; only Obsidian's host primitives are
// replaced (R-028). Screenshots land in test-artifacts/toolbar-ui for review.
const host = `
const proto = HTMLElement.prototype;
proto.createEl = function(tag, options = {}) {
  const node = this.ownerDocument.createElement(tag);
  if (typeof options === "string") options = { cls: options };
  if (options.text) node.textContent = options.text;
  if (options.cls) node.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, String(value));
  for (const key of ["type", "value", "href"]) if (options[key] !== undefined) node.setAttribute(key, options[key]);
  if (options.type && tag === "input") node.type = options.type;
  this.append(node); return node;
};
proto.createDiv = function(options) { return this.createEl("div", options); };
proto.createSpan = function(options) { return this.createEl("span", options); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text) { this.textContent = text; };
proto.setCssProps = function(props) { for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value); };
proto.isShown = function() { return !!(this.offsetWidth || this.offsetHeight || this.getClientRects().length); };
Element.prototype.addClass = function(...values) { this.classList.add(...values); };
Element.prototype.removeClass = function(...values) { this.classList.remove(...values); };
Element.prototype.hasClass = function(value) { return this.classList.contains(value); };
Element.prototype.toggleClass = function(value, on) { this.classList.toggle(value, on); };
Object.defineProperty(Node.prototype, "doc", { get() { return this.ownerDocument || this; } });
Object.defineProperty(Node.prototype, "win", { get() { return (this.ownerDocument || this).defaultView; } });
globalThis.createDiv = (options) => document.createElement("div").createDiv(options);
globalThis.createSpan = (options) => document.createElement("div").createSpan(options);
export function setIcon(element, name) {
  element.querySelector("svg")?.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16"); svg.setAttribute("height", "16"); svg.setAttribute("data-icon", name);
  element.prepend(svg);
}
export class MarkdownView {
  constructor(leaf, containerEl, editor) { this.leaf = leaf; this.containerEl = containerEl; this.editor = editor; this.mode = "source"; }
  getMode() { return this.mode; }
}
class MenuItem {
  constructor() { this.title = ""; this.label = false; }
  setTitle(title) { this.title = title; return this; }
  setIcon(icon) { this.icon = icon; return this; }
  setIsLabel(label) { this.label = label; return this; }
  setChecked(checked) { this.checked = checked; return this; }
  setSection() { return this; }
  onClick(run) { this.run = run; return this; }
}
export class Menu {
  constructor() { this.items = []; }
  addItem(build) { const item = new MenuItem(); build(item); this.items.push(item); return this; }
  addSeparator() { this.items.push({ separator: true }); return this; }
  showAtMouseEvent() { globalThis.lastMenu = this; }
  showAtPosition() { globalThis.lastMenu = this; }
}
export class Notice { constructor(message) { (globalThis.notices ||= []).push(message); } }
export class TFile {
  constructor(path) {
    const folder = path.split("/").slice(0, -1).join("/");
    this.path = path; this.name = path.split("/").pop();
    this.parent = { path: folder || "/", isRoot: () => !folder };
  }
}
export class Plugin {}
export class Modal { constructor(app) { this.app = app; } open() {} close() {} }
export class Setting { constructor() {} }
`;

const bundle = await build({
  stdin: {
    contents: [
      "export { ToolbarController } from './src/ui/ToolbarController';",
      "export { JobTracker } from './src/ui/jobTracker';",
      "export { HanmarkStatusBar } from './src/ui/statusBar';",
      "export { StartPanels } from './src/ui/startPanel';",
      "export { MarkdownView, TFile } from 'obsidian';"
    ].join(" "),
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ToolbarUi",
  plugins: [{
    name: "host-fixture",
    setup(build) {
      build.onResolve({ filter: /^(obsidian|kordoc)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "obsidian" ? host : "export const VERSION = \"4.15.7\";"
      }));
    }
  }]
});

const css = readFileSync("styles.css", "utf8");
const shots = "test-artifacts/toolbar-ui";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light">
    <div class="workspace" style="display:flex;gap:12px;padding:12px;background:#f3f4f6">
      <div id="pane-a" class="pane" style="width:1200px;height:320px;overflow:hidden;background:#fff;border:1px solid #ddd"></div>
      <div id="pane-b" class="pane" style="width:400px;height:320px;overflow:hidden;background:#fff;border:1px solid #ddd"></div>
    </div></body></html>`);
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: "body{--interactive-accent:#7c3aed;--interactive-accent-hover:#8b5cf6;--background-primary:#fff;--background-secondary:#f6f6f7;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--text-muted:#666;--text-normal:#222;--font-ui-small:12px;font-family:system-ui,sans-serif}" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const makePane = (id, lines) => {
      const pane = document.getElementById(id);
      const container = pane.createDiv({ cls: "workspace-leaf-content", attr: { "data-type": "markdown" } });
      container.createDiv({ cls: "view-header", text: `${id} header` }).setAttribute("style", "height:40px;border-bottom:1px solid #eee");
      const content = container.createDiv({ cls: "view-content" });
      content.createDiv({ cls: "markdown-source-view", text: "source" });
      const reading = content.createDiv({ cls: "markdown-reading-view", text: "reading" });
      reading.setAttribute("style", "display:none");
      const editor = {
        lines, cursor: { line: 0, ch: 0 }, inserted: [],
        getCursor() { return this.cursor; }, getLine(n) { return this.lines[n] ?? ""; },
        replaceRange(text) { this.inserted.push(text); }, focus() {}, getSelection() { return ""; },
        replaceSelection(text) { this.inserted.push(text); }, setLine() {}, setCursor() {}
      };
      const leaf = { isDeferred: false, id };
      leaf.view = new ToolbarUi.MarkdownView(leaf, container, editor);
      leaf.view.file = { path: `${id}.md` };
      return leaf;
    };
    globalThis.calls = [];
    globalThis.draft = false;
    globalThis.events = {};
    globalThis.settings = {
      toolbarSkinMode: "auto", toolbarCollapsed: false, toolbarPeek: false, toolbarLook: "classic",
      toolbarFoldFormatInReading: true, toolbarTextColor: "#1A73E8", toolbarHighlightColor: "#FFF59D"
    };
    globalThis.makePane = makePane;
  });
  await page.evaluate(() => {
    globalThis.leafA = makePane("pane-a", ["## 제목", "앞 **굵게** 뒤"]);
    globalThis.leafB = makePane("pane-b", ["본문"]);
  });
  await page.evaluate(() => {
    const workspace = {
      on(name, callback) { (events[name] ||= []).push(callback); return { name }; },
      onLayoutReady(callback) { callback(); },
      getLeavesOfType(type) { return type === "markdown" ? [leafA, leafB] : []; },
      getActiveViewOfType() { return globalThis.activeView; },
      setActiveLeaf(leaf) { globalThis.activeView = leaf.view; for (const callback of events["active-leaf-change"] || []) callback(leaf); }
    };
    const plugin = {
      app: { workspace, commands: { executeCommandById(id) { calls.push(id); return true; } } },
      manifest: { id: "hanmark" },
      registerEvent() {},
      registerDomEvent(target, type, callback) { target.addEventListener(type, callback); }
    };
    globalThis.activityListener = null;
    const activity = { subscribe(listener) { globalThis.activityListener = listener; return () => {}; } };
    globalThis.jobs = new ToolbarUi.JobTracker();
    globalThis.persisted = 0;
    globalThis.activeView = leafA.view;
    globalThis.controller = new ToolbarUi.ToolbarController(
      plugin,
      { importDocument() {}, openCompanyDocument() { calls.push("company-start"); }, companyDraftName(file) { return draft && file?.path === "pane-a.md" ? "초안" : undefined; }, registerCompanyDraft(file) { calls.push(`register:${file?.path}`); }, openHwpxExport() {}, openDocxExport() {}, openHtmlExport() {}, openPdfExport() {}, toggleHwpxPreview() {}, openTemplateManager() {}, openSettings() {} },
      true,
      () => settings,
      { persist: async () => { persisted += 1; }, currentMarkdownView: () => globalThis.activeView, activity, jobs }
    );
    controller.initialize();
  });
  await page.waitForTimeout(150);

  const probe = () => page.evaluate(() => {
    const report = {};
    for (const [name, pane] of [["a", "pane-a"], ["b", "pane-b"]]) {
      const root = document.querySelector(`#${pane} .hwp-toolbar-container`);
      if (!root) { report[name] = null; continue; }
      const rows = [...root.querySelectorAll(".hwp-toolbar-main, .hwp-toolbar-format")].map((row) => ({
        fits: row.scrollWidth <= row.clientWidth + 1,
        height: Math.round(row.getBoundingClientRect().height),
        hidden: row.querySelectorAll(".hwp-toolbar-group.is-overflowed").length,
        more: row.querySelector(".hwp-toolbar-more")?.classList.contains("is-needed") ?? false
      }));
      report[name] = {
        height: Math.round(root.getBoundingClientRect().height),
        classes: root.className,
        rows,
        contentTop: Math.round(document.querySelector(`#${pane} .view-content`).getBoundingClientRect().top),
        before: getComputedStyle(root, "::before").display
      };
    }
    return report;
  });

  let state = await probe();
  assert.ok(state.a && state.b, "every visible Markdown pane has its own toolbar");
  assert.ok(state.a.rows.every((row) => row.fits && row.height <= 40), `wide rows stay on one line: ${JSON.stringify(state.a.rows)}`);
  assert.ok(state.b.rows.every((row) => row.fits && row.height <= 40), `narrow rows stay on one line: ${JSON.stringify(state.b.rows)}`);
  assert.ok(state.b.rows.some((row) => row.hidden > 0 && row.more), "a narrow pane moves groups into the ⋯ menu");
  assert.match(state.b.classes, /is-inactive/u, "the other pane's toolbar rests dimmed");
  assert.doesNotMatch(state.a.classes, /is-inactive/u);
  await page.locator('#pane-a [aria-label="기관 공문 작성"]').click();
  assert.ok(await page.evaluate(() => calls.includes("company-start")));
  await page.evaluate(() => { draft = true; for (const callback of events["file-open"] || []) callback(); });
  await page.locator('#pane-a [aria-label="기관 양식 등록"]').click();
  assert.ok(await page.evaluate(() => calls.includes("register:pane-a.md")));
  assert.equal(await page.locator('#pane-b [aria-label="기관 양식 등록"]').isVisible(), false);
  await page.evaluate(() => { draft = false; for (const callback of events["file-open"] || []) callback(); });
  assert.equal(await page.locator('#pane-a [aria-label="기관 양식 등록"]').isVisible(), false);
  await page.screenshot({ path: `${shots}/1-expanded.png` });

  // Switching panes must not move either note.
  const before = [state.a.contentTop, state.b.contentTop];
  await page.evaluate(() => { globalThis.activeView = leafB.view; for (const callback of events["active-leaf-change"] || []) callback(leafB); });
  await page.waitForTimeout(100);
  state = await probe();
  assert.deepEqual([state.a.contentTop, state.b.contentTop], before, "no jump when the active pane changes");
  assert.match(state.a.classes, /is-inactive/u);
  await page.evaluate(() => { globalThis.activeView = leafA.view; for (const callback of events["active-leaf-change"] || []) callback(leafA); });

  // The ⋯ menu lists the hidden groups as sections.
  await page.locator("#pane-b .hwp-toolbar-more.is-needed").first().click();
  const menu = await page.evaluate(() => (globalThis.lastMenu?.items ?? []).map((item) => (item.separator ? "—" : `${item.label ? "#" : ""}${item.title}`)));
  assert.ok(menu.some((title) => title.startsWith("#")), `menu has section titles: ${menu.join(" | ")}`);

  // Live state: heading level and pressed marks follow the cursor.
  await page.evaluate(() => {
    leafA.view.editor.cursor = { line: 0, ch: 3 };
    activityListener({ view: leafA.view, path: "a.md", docChanged: false, selectionSet: true, focusChanged: false });
  });
  assert.equal(await page.locator("#pane-a .hwp-style-dropdown").inputValue(), "h2");
  await page.evaluate(() => {
    leafA.view.editor.cursor = { line: 1, ch: 6 };
    activityListener({ view: leafA.view, path: "a.md", docChanged: false, selectionSet: true, focusChanged: false });
  });
  assert.equal(await page.locator('#pane-a .hwp-toolbar-btn[aria-pressed="true"]').count(), 1, "only B is pressed inside **굵게**");
  assert.equal(await page.locator("#pane-a .hwp-glyph-bold").count(), 1);

  // Table grid: 3 rows × 4 columns inserts that table.
  await page.locator('#pane-a .hwp-toolbar-btn[aria-haspopup="dialog"]').click();
  await page.locator(".hanmark-table-grid-cell").nth(2 * 8 + 3).hover();
  assert.match(await page.locator(".hanmark-table-grid-status").innerText(), /3.+4/u);
  await page.keyboard.press("Enter");
  const inserted = await page.evaluate(() => leafA.view.editor.inserted.at(-1));
  assert.equal(inserted.split("\n").filter((line) => line.startsWith("|")).length, 4, "header, separator, and 2 body rows");
  assert.equal(inserted.split("\n")[1].split("|").length - 2, 4, "4 columns");

  // Remembered colors: choosing one updates every toolbar's swatch and saves.
  await page.evaluate(() => {
    const picker = document.querySelector('#pane-a input[type="color"]');
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("change"));
  });
  assert.equal(await page.evaluate(() => settings.toolbarTextColor), "#FF0000");
  assert.equal(
    await page.evaluate(() => document.querySelector("#pane-b .hwp-toolbar-color").style.getPropertyValue("--hwp-swatch")),
    "#FF0000"
  );

  // Fold: a slim strip; the note moves up by the toolbar's height, then stays put while peeking.
  await page.evaluate(() => controller.toggleCollapsed());
  await page.waitForTimeout(400);
  state = await probe();
  assert.ok(state.a.height >= 4 && state.a.height <= 8, `folded strip height ${state.a.height}`);
  assert.equal(await page.locator("#pane-a .hwp-toolbar-rows").getAttribute("inert"), "");
  assert.equal(await page.locator("#pane-a .hwp-toolbar-handle").getAttribute("aria-expanded"), "false");
  await page.screenshot({ path: `${shots}/2-collapsed.png` });
  await page.evaluate(() => { settings.toolbarPeek = true; });
  await page.locator("#pane-a .hwp-toolbar-container").hover({ position: { x: 300, y: 2 } });
  await page.waitForTimeout(450);
  const peek = await page.evaluate(() => {
    const root = document.querySelector("#pane-a .hwp-toolbar-container");
    return { peeking: root.classList.contains("is-peeking"), height: Math.round(root.getBoundingClientRect().height), position: getComputedStyle(root.querySelector(".hwp-toolbar-rows")).position };
  });
  assert.deepEqual(peek, { peeking: true, height: state.a.height, position: "absolute" });
  await page.screenshot({ path: `${shots}/3-peek.png` });
  await page.mouse.move(600, 650);
  await page.waitForTimeout(550);
  assert.equal(await page.evaluate(() => document.querySelector("#pane-a .hwp-toolbar-container").classList.contains("is-peeking")), false);
  await page.evaluate(() => controller.toggleCollapsed());
  assert.ok((await page.evaluate(() => persisted)) >= 3, "fold state and colors are saved");

  // Minimal look: no logos, theme colors.
  await page.evaluate(() => { settings.toolbarLook = "minimal"; controller.refreshSettings(); });
  await page.waitForTimeout(250);
  state = await probe();
  assert.equal(state.a.before, "none", "the minimal look has no logos");
  await page.screenshot({ path: `${shots}/4-minimal.png` });

  // Reading view folds the formatting row.
  await page.evaluate(() => {
    leafA.view.mode = "preview";
    document.querySelector("#pane-a .markdown-reading-view").setAttribute("style", "display:block");
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#pane-a .hwp-toolbar-format").isVisible(), false);

  // A running job flows along the bottom edge; reduced motion stops it.
  await page.evaluate(() => { globalThis.endJob = jobs.begin(); });
  assert.equal(await page.locator("#pane-a .hanmark-flow-line").getAttribute("data-active"), "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.querySelector("#pane-a .hanmark-flow-line"), "::before").animationName),
    "none"
  );
  await page.evaluate(() => endJob());
  assert.equal(await page.locator("#pane-a .hanmark-flow-line").getAttribute("data-flash"), "true");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Status bar: the note's characters (without front matter, marks, link targets, or
  // comments), the selection's, and the form as a menu button.
  await page.evaluate(() => {
    const bar = document.body.createDiv({ cls: "status-bar" });
    bar.setAttribute("style", "display:flex;gap:14px;margin:12px;padding:4px 10px;font-size:12px;border:1px solid #ddd;width:max-content");
    globalThis.statusBarEl = bar;
    const file = new ToolbarUi.TFile("보고서/주간 보고.md");
    globalThis.statusView = {
      file,
      editor: {
        value: "---\nkey: 1\n---\n# 제목\n\n본문 **굵게** [링크](https://example.com) %%주석%%",
        selection: "",
        getValue() { return this.value; },
        getSelection() { return this.selection; }
      }
    };
    globalThis.chosenForm = null;
    globalThis.statusBar = new ToolbarUi.HanmarkStatusBar({
      addItem: () => bar.createDiv({ cls: "status-bar-item" }),
      currentView: () => statusView,
      showCount: () => true,
      showForm: () => true,
      forms: () => [
        { id: "builtin:hallym-ilsong", name: "일송 회의록", group: "기관 양식", preset: "minutes" },
        { id: "preset:report", name: "보고서", group: "표준 양식", preset: "report" },
        { id: "preset:ministry", name: "업무보고", group: "표준 양식", preset: "ministry" }
      ],
      formFor: () => chosenForm ?? "preset:ministry",
      selectForm: async (id) => { chosenForm = id; }
    });
  });
  const statusItems = () => page.evaluate(() => [...statusBarEl.children].filter((item) => !item.classList.contains("hanmark-is-hidden")).map((item) => item.textContent));
  let items = await statusItems();
  assert.match(items[0], /^공백 포함 \d+자 · 공백 제외 8자 · 원고지 약 [\d.]+매$/u, items[0]);
  assert.equal(items[1], "양식: 업무보고");
  await page.evaluate(() => { statusView.editor.selection = "본문 **굵게**"; statusBar.refresh(false); });
  items = await statusItems();
  assert.equal(items[0], "선택 5자 · 공백 제외 4자");
  await page.evaluate(() => { statusView.editor.selection = ""; statusBar.refresh(false); });
  await page.locator(".hanmark-status-form").focus();
  await page.keyboard.press("Enter");
  const formMenu = await page.evaluate(() => globalThis.lastMenu.items.map((item) => `${item.label ? "#" : ""}${item.checked ? "✓" : ""}${item.title}`));
  assert.deepEqual(formMenu, ["#기관 양식", "일송 회의록", "#표준 양식", "보고서", "✓업무보고"]);
  await page.evaluate(() => globalThis.lastMenu.items.find((item) => item.title === "보고서").run());
  await page.waitForTimeout(50);
  assert.equal((await statusItems())[1], "양식: 보고서");

  // Empty tabs: HanMark's section in the main area only, recent files that still exist,
  // no rebuild while nothing changed, and gone when turned off.
  await page.evaluate(() => {
    const host = document.body.createDiv({ cls: "workspace-leaf-content" });
    host.setAttribute("style", "width:520px;height:430px;margin:12px;border:1px solid #ddd;background:#f6f6f7");
    const empty = host.createDiv({ cls: "view-content" }).createDiv({ cls: "empty-state" }).createDiv({ cls: "empty-state-container" });
    empty.setAttribute("style", "display:flex;flex-direction:column;align-items:center;padding-top:36px;text-align:center");
    empty.createDiv({ cls: "empty-state-title", text: "열린 파일이 없습니다" }).setAttribute("style", "font-size:20px;font-weight:600");
    empty.createDiv({ cls: "empty-state-action", text: "새 노트 만들기 (Ctrl + N)" }).setAttribute("style", "color:#7c3aed;margin-top:8px");
    const side = document.body.createDiv();
    side.createDiv({ cls: "view-content" }).createDiv({ cls: "empty-state-container" });
    const rootSplit = {};
    const leftSplit = {};
    const rightSplit = {};
    const files = Object.fromEntries(
      ["보고서/주간 보고 - 업무보고.hwpx", "보고서/주간 보고.docx", "홈.html"].map((path) => [path, new ToolbarUi.TFile(path)])
    );
    globalThis.startHost = host;
    globalThis.sideHost = side;
    globalThis.startCalls = [];
    globalThis.startSettings = {
      on: true,
      recent: [
        { path: "보고서/주간 보고 - 업무보고.hwpx", format: "hwpx", at: 3 },
        { path: "사라진 파일.hwpx", format: "hwpx", at: 2 },
        { path: "보고서/주간 보고.docx", format: "docx", at: 1 },
        { path: "홈.html", format: "html", at: 0 }
      ]
    };
    const mainLeaf = { view: { containerEl: host }, getRoot: () => rootSplit };
    const sideLeaf = { view: { containerEl: side }, getRoot: () => rightSplit };
    globalThis.startPanels = new ToolbarUi.StartPanels({
      app: {
        workspace: { leftSplit, rightSplit, getLeavesOfType: (type) => (type === "empty" ? [mainLeaf, sideLeaf] : []) },
        vault: { getAbstractFileByPath: (path) => files[path] ?? null }
      },
      enabled: () => startSettings.on,
      recentExports: () => startSettings.recent,
      importDocument: () => startCalls.push("import"),
      newNote: () => startCalls.push("new"),
      openHwpx: (file) => startCalls.push(`open:${file.path}`),
      reveal: (path) => startCalls.push(`reveal:${path}`)
    });
    startPanels.sync();
  });
  const start = await page.evaluate(() => ({
    main: startHost.querySelectorAll(".hanmark-start-panel").length,
    side: sideHost.querySelectorAll(".hanmark-start-panel").length,
    rows: [...startHost.querySelectorAll(".hanmark-start-file")].map((row) => row.querySelector(".hanmark-start-format").textContent)
  }));
  assert.deepEqual(start, { main: 1, side: 0, rows: ["HWPX", "DOCX", "HTML"] });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/5-status-and-start.png`, clip: await page.evaluate(() => {
    const box = statusBarEl.getBoundingClientRect();
    const tab = startHost.getBoundingClientRect();
    return { x: 0, y: box.top + window.scrollY - 8, width: 560, height: tab.bottom - box.top + 16 };
  }) });
  await page.locator(".hanmark-start-file").nth(0).click();
  await page.locator(".hanmark-start-file").nth(1).click();
  await page.locator(".hanmark-start-action").nth(0).click();
  assert.deepEqual(await page.evaluate(() => startCalls), ["open:보고서/주간 보고 - 업무보고.hwpx", "reveal:보고서/주간 보고.docx", "import"]);
  assert.equal(
    await page.evaluate(() => {
      const row = startHost.querySelector(".hanmark-start-file");
      startPanels.sync();
      return row.isConnected;
    }),
    true,
    "an unchanged list is not rebuilt"
  );
  await page.evaluate(() => { startSettings.on = false; startPanels.sync(); });
  assert.equal(await page.evaluate(() => startHost.querySelectorAll(".hanmark-start-panel").length), 0);
  console.log("Toolbar UI: per-pane toolbars, one-line rows with ⋯, no jump between panes, live state, table grid, remembered colors, fold and peek, minimal look, reading fold, job line, status bar count and form menu, and the empty-tab section passed.");
} finally {
  await browser.close();
}
