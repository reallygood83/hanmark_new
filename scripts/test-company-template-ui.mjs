import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";

const host = `
const proto = HTMLElement.prototype;
proto.createEl = function(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.text) node.textContent = options.text;
  if (options.cls) node.className = options.cls;
  for (const [key, value] of Object.entries(options.attr || {})) node.setAttribute(key, value);
  this.append(node);
  return node;
};
proto.createDiv = function(options) { return this.createEl("div", options); };
proto.empty = function() { this.replaceChildren(); };
proto.setText = function(text) { this.textContent = text; };
proto.addClass = function(name) { this.classList.add(name); };
export class Modal {
  constructor(app) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.modalEl.className = "modal";
    this.titleEl = this.modalEl.createEl("h2");
    this.contentEl = this.modalEl.createDiv();
  }
  open() { document.body.append(this.modalEl); this.onOpen(); }
  close() { this.onClose(); this.modalEl.remove(); }
}
export class Setting {
  constructor(root) {
    this.settingEl = root.createDiv({ cls: "setting-item" });
    this.info = this.settingEl.createDiv();
    this.control = this.settingEl.createDiv();
  }
  setName(name) { this.info.createEl("label", { text: name }); return this; }
  setDesc(text) { this.info.createEl("small", { text }); return this; }
  addText(callback) {
    const inputEl = this.control.createEl("input", { attr: { type: "text" } });
    callback({
      inputEl,
      setValue(value) { inputEl.value = value; return this; },
      onChange(run) { inputEl.addEventListener("input", () => run(inputEl.value)); return this; }
    });
    return this;
  }
  addDropdown(callback) {
    const select = this.control.createEl("select");
    callback({
      addOption(value, label) { select.createEl("option", { text: label, attr: { value } }); return this; },
      setValue(value) { select.value = value; return this; },
      onChange(run) { select.addEventListener("change", () => run(select.value)); return this; }
    });
    return this;
  }
}
`;

const bundle = await build({
  stdin: {
    contents: "export { CompanyTemplateStartModal, promptCompanyTemplateRegistration } from './src/ui/CompanyTemplateModal';",
    resolveDir: process.cwd(),
    loader: "ts"
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "CompanyUi",
  plugins: [{
    name: "obsidian-fixture",
    setup(engine) {
      engine.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "fixture" }));
      engine.onResolve({ filter: /\/io\/gongmunExport$/ }, () => ({ path: "gongmun", namespace: "fixture" }));
      engine.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "obsidian" ? host : 'export const GONGMUN_PRESETS = [{value:"report",label:"gongmun.preset.report"}];'
      }));
    }
  }]
});

const shots = "test-artifacts/company-template-ui";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.HANMARK_BROWSER_EXECUTABLE || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 680, height: 720 } });
  await page.setContent('<!doctype html><html><body class="theme-light"></body></html>');
  await page.addStyleTag({ content: readFileSync("styles.css", "utf8") });
  await page.addStyleTag({ content: "*,*::before,*::after{box-sizing:border-box}body{--background-primary:#fff;--background-secondary:#f4f4f5;--background-modifier-border:#d4d4d8;--background-modifier-hover:#e4e4e7;--interactive-accent:#2563eb;--text-normal:#18181b;--text-muted:#52525b;--text-error:#b91c1c;--font-ui-small:13px;color:var(--text-normal);background:var(--background-primary);font-family:system-ui}.modal{width:min(520px,calc(100vw - 32px));margin:32px auto;padding:20px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px;box-shadow:0 12px 40px #0002}.setting-item{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--background-modifier-border)}.setting-item label{display:block}button,input,select{font:inherit}button:focus-visible,input:focus-visible{outline:2px solid var(--interactive-accent)}" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.evaluate(() => {
    globalThis.calls = [];
    globalThis.actions = {
      importHwpx: () => calls.push("import"),
      registerDraft: () => calls.push("register"),
      newDocument: (id) => calls.push(id)
    };
    new CompanyUi.CompanyTemplateStartModal({}, [], undefined, actions).open();
  });
  assert.equal(await page.getByRole("button", { name: /기관 HWPX 가져오기/u }).count(), 1);
  assert.match(await page.locator(".hanmark-company-start").innerText(), /등록된 기관 양식이 없습니다/u);
  await page.screenshot({ path: `${shots}/1-empty.png` });
  await page.getByRole("button", { name: /기관 HWPX 가져오기/u }).click();
  assert.deepEqual(await page.evaluate(() => calls), ["import"]);

  await page.evaluate(() => {
    new CompanyUi.CompanyTemplateStartModal({}, [{ id: "company:1", name: "업무보고", detail: "교육청 · 보고서" }], "초안", actions).open();
  });
  await page.screenshot({ path: `${shots}/2-draft-and-template.png` });
  await page.getByRole("button", { name: /업무보고/u }).click();
  assert.deepEqual(await page.evaluate(() => calls), ["import", "company:1"]);
  await page.evaluate(() => {
    new CompanyUi.CompanyTemplateStartModal({}, [], "초안", actions).open();
  });
  await page.getByRole("button", { name: "기관 양식 등록" }).click();
  assert.deepEqual(await page.evaluate(() => calls), ["import", "company:1", "register"]);

  await page.evaluate(() => {
    globalThis.registration = CompanyUi.promptCompanyTemplateRegistration({}, {
      name: "", preset: "report", org: "교육청", approval: ""
    });
  });
  await page.getByRole("button", { name: "확인" }).click();
  const name = page.locator(".hanmark-company-name-setting input");
  assert.equal(await name.getAttribute("aria-invalid"), "true");
  assert.equal(await name.evaluate((input) => input === document.activeElement), true);
  assert.match(await page.locator(".hanmark-company-field-error").innerText(), /이름을 입력하세요/u);
  await page.screenshot({ path: `${shots}/3-name-error.png` });
  await name.fill("기관 업무보고");
  assert.equal(await name.getAttribute("aria-invalid"), null);
  await page.getByRole("button", { name: "확인" }).click();
  assert.deepEqual(await page.evaluate(async () => registration), {
    name: "기관 업무보고", preset: "report", org: "교육청", approval: ""
  });

  await page.setViewportSize({ width: 420, height: 720 });
  await page.evaluate(() => {
    new CompanyUi.CompanyTemplateStartModal({}, [{ id: "company:1", name: "업무보고", detail: "교육청 · 보고서" }], undefined, actions).open();
  });
  const bounds = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflow: [...document.querySelectorAll("body *")]
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth)
      .slice(0, 8)
      .map((node) => [node.tagName, node.className, Math.round(node.getBoundingClientRect().right)])
  }));
  assert.ok(bounds.page <= bounds.viewport, JSON.stringify(bounds));
  await page.screenshot({ path: `${shots}/4-narrow.png` });
  await page.setViewportSize({ width: 680, height: 720 });
  await page.evaluate(() => {
    document.body.classList.replace("theme-light", "theme-dark");
    for (const [key, value] of Object.entries({
      "--background-primary": "#202127",
      "--background-secondary": "#2d2e34",
      "--background-modifier-border": "#4a4b54",
      "--background-modifier-hover": "#393b44",
      "--text-normal": "#eeeef0",
      "--text-muted": "#b4b5bf",
      "--interactive-accent": "#8faeff"
    })) document.body.style.setProperty(key, value);
  });
  await page.screenshot({ path: `${shots}/5-dark.png` });
  console.log("Company template UI: empty state, import, draft registration, saved template, inline validation, and narrow layout passed.");
} finally {
  await browser.close();
}
