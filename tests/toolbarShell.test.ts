import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const toolbar = readFileSync("src/ui/ToolbarController.ts", "utf8");
const main = readFileSync("src/main.ts", "utf8");
const css = readFileSync("styles.css", "utf8");
const settingsTab = readFileSync("src/ui/HanmarkSettingTab.ts", "utf8");

describe("toolbar shell (R-028)", () => {
  it("keeps one toolbar per Markdown pane instead of moving one toolbar around", () => {
    assert.match(toolbar, /private readonly toolbars = new Map<WorkspaceLeaf, ToolbarInstance>\(\);/u);
    assert.doesNotMatch(toolbar, /document\.querySelectorAll\("\.hwp-toolbar-container"\)/u);
    assert.match(toolbar, /setActiveLeaf\(toolbar\.leaf, \{ focus: false \}\)/u);
    assert.match(toolbar, /toggleClass\("is-inactive"/u);
    assert.match(toolbar, /workspace\.on\("window-open"/u);
  });

  it("folds to a strip with an accessible handle and a remembered state", () => {
    assert.match(toolbar, /toolbar\.handle\.setAttribute\("aria-controls", rowsId\);/u);
    assert.match(toolbar, /setAttribute\("aria-expanded", String\(!collapsed\)\)/u);
    assert.match(toolbar, /toggleAttribute\("inert", collapsed && !root\.hasClass\("is-peeking"\)\)/u);
    assert.match(toolbar, /settings\.toolbarCollapsed = !settings\.toolbarCollapsed;/u);
    assert.match(main, /id: "toggle-toolbar-collapse",\s*name: t\("command\.toggleToolbarCollapse"\),/u);
    assert.match(main, /id: "toggle-toolbar",/u, "the full hide stays");
    assert.match(css, /\.hwp-toolbar-container\.is-collapsed \.hwp-toolbar-rows \{\s*grid-template-rows: 0fr;/u);
    assert.match(css, /\.hwp-toolbar-container\.is-collapsed\.is-peeking \.hwp-toolbar-rows \{\s*position: absolute;/u);
  });

  it("keeps rows on one line and lists hidden groups in a ⋯ menu", () => {
    for (const id of ["files", "exports", "history", "inserts", "previews", "templates", "style", "headings", "inline", "blocks", "tools", "indent"]) {
      assert.ok(toolbar.includes(`"${id}")`), `group ${id} is registered`);
    }
    assert.match(toolbar, /chooseHiddenGroups\(measured, rowElement\.clientWidth - 4, moreWidth\)/u);
    assert.match(css, /\.hwp-toolbar-rows \.hwp-toolbar-main,\s*\.hwp-toolbar-rows \.hwp-toolbar-format \{\s*flex-wrap: nowrap;/u);
  });

  it("follows the cursor, remembers colors, and offers a table grid", () => {
    assert.match(main, /activity: this\.activity,\s*jobs: this\.jobs/u);
    assert.match(toolbar, /button\.setAttribute\("aria-pressed", String\(on\)\);/u);
    assert.doesNotMatch(toolbar, /style\.value = "p";/u, "the style box no longer snaps back to body text");
    assert.match(toolbar, /this\.rememberColor\(options\.kind, picker\.value\);/u);
    assert.match(toolbar, /openTableGrid\(visible, \(size\) =>/u);
    assert.match(css, /\.hwp-toolbar-btn-label\.hwp-glyph-bold \{\s*font-weight: 800;/u);
  });

  it("offers the look, peek, and reading-view settings", () => {
    assert.match(settingsTab, /changeToolbarDisplay\("toolbarLook"/u);
    assert.match(settingsTab, /changeToolbarDisplay\("toolbarPeek"/u);
    assert.match(settingsTab, /changeToolbarDisplay\("toolbarFoldFormatInReading"/u);
    assert.match(css, /\.hwp-toolbar-container\.hwp-toolbar-look-minimal::before,/u);
  });
});
