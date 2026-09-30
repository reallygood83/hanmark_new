import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PREVIEW_ZOOM_STEPS } from "../src/ui/previewIndex";

const hwpx = readFileSync("src/ui/QuickHwpxPreviewView.ts", "utf8");
const docx = readFileSync("src/ui/DocxPreviewView.ts", "utf8");
const main = readFileSync("src/main.ts", "utf8");
const tab = readFileSync("src/ui/HanmarkSettingTab.ts", "utf8");
const css = readFileSync("styles.css", "utf8");

describe("previews without flicker, with pages, zoom, and follow (R-028)", () => {
  it("keeps the HWPX picture while redrawing and swaps the new one in at once", () => {
    assert.match(hwpx, /if \(entry && shown\?\.key === this\.shownKey\(key, file\.path\) && shown\.paper\.isConnected\) \{/u);
    assert.match(hwpx, /if \(!keep\) \{\s*stage\.empty\(\);\s*loading = stage\.createDiv/u, "the loading box is only for the first picture");
    assert.match(hwpx, /stage\.replaceChildren\(\.\.\.Array\.from\(next\.childNodes\)\);/u);
    assert.match(hwpx, /if \(anchor\) this\.scrollToCanvas\(offsetFor\(index, anchor\)\);/u);
    assert.match(hwpx, /t\("preview\.quick\.keptPrevious", \{ detail \}\)/u);
    assert.doesNotMatch(hwpx, /this\.previewEl\.empty\(\);\s*if \(this\.autoPausedPath/u, "no blank frame before drawing");
  });

  it("keeps zoom per pane and follows the cursor unless the preview was just scrolled", () => {
    for (const view of [hwpx, docx]) {
      assert.match(view, /return \{ \.\.\.super\.getState\(\), zoom: this\.zoom \};/u);
      assert.match(view, /Date\.now\(\) - this\.lastUserScroll < FOLLOW_PAUSE/u);
      assert.match(view, /this\.registerDomEvent\(\w+, "wheel", touched, \{ passive: true \}\);/u);
    }
    assert.match(hwpx, /followTarget\(editor\.getCursor\("head"\)\.line, shown\.aligned, shown\.lineCount, shown\.index\.height\)/u);
    assert.equal(main.match(/subscribeActivity: \(listener, delay\) => this\.activity\.subscribe\(listener, delay\),/gu)?.length, 2);
    assert.equal(main.match(/followCursor: \(\) => this\.settings\.previewFollowCursor,/gu)?.length, 2);
    assert.match(tab, /this\.host\.settings\.previewFollowCursor = enabled;/u);
  });

  it("keeps the DOCX scroll position, zooms by hand, and pages the real DOCX", () => {
    assert.equal(docx.match(/this\.schedulePreviewFit\(restore\);/gu)?.length, 2);
    assert.match(docx, /if \(this\.zoom !== null\) \{\s*preview\.dataset\.fit = String\(this\.zoom\);\s*return;\s*\}/u);
    assert.match(docx, /elements\(this\.previewEl, "\.docx-preview-docx section\.docx"\)/u);
    assert.match(docx, /new ResizeObserver\(\(\) => this\.updatePreviewFit\(\)\)/u);
    for (const step of PREVIEW_ZOOM_STEPS) assert.ok(css.includes(`.hanmark-docx-preview-content[data-fit="${step}"]`), String(step));
    assert.match(css, /\.hanmark-preview-paper\.is-zoomed \{\s*width: max-content;\s*max-width: none;/u);
  });
});
