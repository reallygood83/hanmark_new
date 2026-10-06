import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("unified export modal exposes four accessible format cards", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  for (const format of ["hwpx", "docx", "html", "pdf"]) {
    assert.match(source, new RegExp(`id: "${format}"`, "u"));
  }
  assert.match(source, /role: "group"/u);
  assert.match(source, /"aria-pressed": String\(selected\)/u);
  assert.match(source, /"aria-describedby": descriptionId/u);
  assert.match(source, /type: "button"/u);
  assert.doesNotMatch(source, /hanmark-export-tabs|renderOther\(/u);
  assert.doesNotMatch(source, /\.innerHTML|\.outerHTML/u);
});

test("official export keeps the linked institution visible and lets users change formats", async () => {
  const modal = await readFile("src/ui/HanmarkExportModal.ts", "utf8");
  const host = await readFile("src/main.ts", "utf8");
  assert.match(modal, /this\.actions\.companyTemplateContext\?\.\(\)/u);
  assert.match(modal, /linked\.formId === this\.gongmunForm/u);
  assert.match(modal, /t\("companyTemplate\.exportOtherForm"/u);
  assert.match(modal, /createEl\("details", \{ cls: "hanmark-export-formats-collapsed" \}\)/u);
  assert.match(host, /companyTemplateForNote\(this, this\.currentMarkdownView\(\)\?\.file\?\.path\)/u);
});

test("unified export modal keeps format-specific options and one active footer", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  assert.match(source, /"quick"/u);
  assert.match(source, /"gongmun"/u);
  assert.doesNotMatch(source, /"source-patch"|sourcePatchAvailable|patchSource/u);
  assert.match(source, /cls: "hanmark-export-variant-grid"/u);
  assert.match(source, /"aria-pressed": String\(selected\)/u);
  assert.match(source, /this\.actions\.openPreview\(\)/u);
  assert.match(source, /this\.actions\.openDocxPreview/u);
  assert.match(source, /this\.actions\.openPandocSettings/u);
  assert.match(source, /this\.actions\.exportPdf/u);
  assert.match(
    source,
    /if \(this\.result\) \{\s*this\.renderResult\(contentEl, this\.result\);\s*\} else \{\s*this\.renderFooter\(contentEl\);/u
  );
  assert.match(
    source,
    /this\.result = result\.status !== "cancelled" \? result : null;/u
  );
  assert.match(source, /result !== false && result !== null/u);
  assert.doesNotMatch(source, /text: "템플릿 관리"/u);
});

test("official documents are chosen from one form list in the export window and the preview (R-026)", async () => {
  const modal = await readFile("src/ui/HanmarkExportModal.ts", "utf8");
  // One select holds the institutions' forms, the eight standard types, and the user's forms.
  assert.match(modal, /attr: \{ id: "hanmark-export-gongmun-form" \}/u);
  assert.match(modal, /fillGongmunFormSelect\(select, forms\);/u);
  assert.match(modal, /this\.actions\.selectGongmunForm\?\.\(select\.value\)/u);
  assert.doesNotMatch(modal, /hanmark-export-gongmun-preset|hanmark-export-gongmun-style/u);
  // The chosen form's description, and where the choice came from.
  assert.match(modal, /current\?\.description \?\? t\("gongmun\.form\.help"\)/u);
  assert.match(modal, /t\("gongmun\.form\.fromNote"/u);
  assert.match(modal, /t\("gongmun\.form\.noteDiffers"/u);

  const preview = await readFile("src/ui/QuickHwpxPreviewView.ts", "utf8");
  // The preview switches between quick HWPX and every form, refreshes, and saves.
  assert.match(preview, /general\.createEl\("option", \{ value: QUICK_VALUE, text: t\("preview\.hwpx\.quick"\) \}\);/u);
  assert.match(preview, /fillGongmunFormSelect\(select, this\.options\.gongmunForms\?\.\(\) \?\? \[\]\);/u);
  assert.match(preview, /t\("preview\.hwpx\.save"\)/u);
  assert.match(preview, /await this\.options\.exportHwpx\?\.\(this\.effectiveMode\(file\)\);/u);
  assert.match(preview, /await this\.options\.rememberMode\?\.\(this\.mode\.kind\);/u);
});

test("export cards form a responsive skin-aware two-by-two grid", async () => {
  const css = await readFile("styles.css", "utf8");

  assert.match(
    css,
    /\.hanmark-export-format-grid \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/u
  );
  assert.match(css, /@container \(max-width: 700px\)/u);
  assert.match(
    css,
    /@container \(max-width: 700px\) \{[\s\S]*?\.hanmark-export-format-grid \{\s*grid-template-columns: 1fr;/u
  );
  assert.match(css, /--hanmark-export-key-color/u);
  assert.match(css, /--hwp-toolbar-light-logo-hwp/u);
  assert.match(css, /--hwp-toolbar-dark-logo-word/u);
  assert.match(css, /\.hanmark-export-format-card:focus-visible/u);
  assert.match(css, /\.hanmark-export-format-card\.is-selected/u);
});

test("long exports lock the whole modal and restore focus afterwards", async () => {
  const source = await readFile("src/ui/HanmarkExportModal.ts", "utf8");

  assert.match(source, /this\.busy = true;\s*this\.render\(\);/u);
  assert.match(source, /button\.disabled = this\.busy/u);
  assert.match(source, /select\.disabled = this\.busy/u);
  assert.match(source, /close\(\): void \{\s*if \(this\.busy\) return;/u);
  assert.match(
    source,
    /querySelector<HTMLButtonElement>\(\s*"\.hanmark-export-result button"\s*\)\s*\?\.focus\(\)/u
  );
});
