import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const bar = readFileSync("src/ui/statusBar.ts", "utf8");
const start = readFileSync("src/ui/startPanel.ts", "utf8");
const main = readFileSync("src/main.ts", "utf8");
const tab = readFileSync("src/ui/HanmarkSettingTab.ts", "utf8");

describe("status bar (R-028)", () => {
  it("counts the note, or the selection while text is selected, and recounts only after edits", () => {
    assert.match(bar, /const selection = view\.editor\.getSelection\(\);/u);
    assert.match(bar, /countText\(visibleMarkdownText\(selection, \{ frontmatter: false \}\)\)/u);
    assert.match(bar, /if \(textChanged\) this\.noteCount = null;/u);
    assert.match(main, /this\.statusBar\?\.refresh\(activity\.docChanged\);/u);
  });

  it("shows the form only for notes with an official-document context, as a menu button", () => {
    assert.match(main, /if \(!remembered && !notePresetHint\(this\.app, file\) && !previewing\) return null;/u);
    assert.match(bar, /this\.formEl\.setAttribute\("role", "button"\);/u);
    assert.match(bar, /this\.formEl\.setAttribute\("tabindex", "0"\);/u);
    assert.match(bar, /\.setChecked\(form\.id === current\)/u);
    assert.match(tab, /void this\.changeStatusBar\("statusCharCount", enabled\);/u);
    assert.match(tab, /void this\.changeStatusBar\("statusGongmunForm", enabled\);/u);
  });
});

describe("empty-tab section (R-028)", () => {
  it("joins empty tabs outside the sidebars and leaves with HanMark", () => {
    assert.match(start, /workspace\.getLeavesOfType\("empty"\)/u);
    assert.match(start, /if \(root === workspace\.leftSplit \|\| root === workspace\.rightSplit\) continue;/u);
    assert.match(start, /if \(file instanceof TFile\) found\.push\(\{ item, file \}\);/u, "only files that still exist");
    assert.match(main, /this\.register\(\(\) => panels\.removeAll\(\)\);/u);
    assert.match(main, /enabled: \(\) => this\.settings\.showStartPanel,/u);
    assert.match(main, /type: HANMARK_DOCUMENT_VIEW, state: \{ file: file\.path \}/u);
    assert.match(tab, /this\.host\.settings\.showStartPanel = enabled;/u);
  });
});
