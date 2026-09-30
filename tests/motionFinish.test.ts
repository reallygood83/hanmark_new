import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { JobTracker, type JobState } from "../src/ui/jobTracker";

const css = readFileSync("styles.css", "utf8");
const source = (path: string): string => readFileSync(path, "utf8");

function block(selector: string, text = css): string {
  const at = text.indexOf(selector);
  assert.ok(at >= 0, `missing ${selector}`);
  return text.slice(at, text.indexOf("}", at) + 1);
}

describe("motion and finish layer (R-028)", () => {
  it("defines the tokens, the orbiting ring, and the flowing line", () => {
    assert.match(css, /--hanmark-motion-fast: 120ms;/u);
    assert.match(css, /--hanmark-ease-out: cubic-bezier\(0\.2, 0\.8, 0\.2, 1\);/u);
    assert.match(css, /@property --hanmark-orbit-angle \{\s*syntax: "<angle>";/u);
    const ring = block('.hanmark-orbit-host[data-phase="waiting"]::before,');
    assert.ok(ring.length > 0);
    assert.match(css, /animation: hanmark-orbit 1\.8s linear infinite;/u);
    assert.match(css, /-webkit-mask-composite: xor;\s*mask:[\s\S]*?mask-composite: exclude;/u);
    assert.match(css, /\.hanmark-flow-line\[data-active="true"\]::before \{\s*animation: hanmark-flow/u);
  });

  it("stops every movement for reduced motion and draws an outline in forced colors", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .hanmark-orbit-host"));
    assert.ok(reduced.length > 0);
    const body = reduced.slice(0, reduced.indexOf("@media (forced-colors: active)"));
    for (const selector of [
      '.hanmark-orbit-host[data-phase="waiting"]::before',
      ".hanmark-arrive",
      ".hanmark-done-mark::before",
      '.hanmark-flow-line[data-active="true"]::before'
    ]) {
      assert.ok(body.includes(selector), selector);
    }
    assert.match(body, /animation: none;/u);
    assert.match(css, /@media \(forced-colors: active\) \{\s*\.hanmark-orbit-host\[data-phase="waiting"\]/u);
    assert.ok(!/!important|:has\(/u.test(css.slice(css.indexOf("Motion and finish (R-028)"))));
  });

  it("rings the waiting states and marks finished results", () => {
    const modal = source("src/ui/HanmarkExportModal.ts");
    assert.match(modal, /setPhase\(execute, this\.busy \? "waiting" : null\);/u);
    assert.match(modal, /cls: "hanmark-export-result hanmark-arrive"/u);
    assert.match(modal, /cls: "hanmark-done-mark"/u);
    assert.match(modal, /this\.busy = true;\s*this\.render\(\);/u);
    const importer = source("src/ui/ImportModal.ts");
    assert.match(importer, /setPhase\(this\.progressEl, this\.running \? "waiting" : null\);/u);
    assert.match(importer, /const endJob = this\.host\.trackJob\?\.\(\);/u);
    assert.match(css, /\.hanmark-docx-preview-status\[data-state="building"\]::before/u);
  });

  it("registers one editor listener and tracks user-started jobs", () => {
    const main = source("src/main.ts");
    assert.match(main, /this\.registerEditorExtension\(this\.activity\.extension\);/u);
    assert.match(main, /exportKordoc: \(mode, preset, formId\) =>\s*this\.jobs\.run\(/u);
    assert.match(main, /runOther: \(mode\) =>\s*this\.jobs\.run\(async \(\) => \{\s*const outcome = await this\.runOtherExport\(mode\);/u);
    assert.match(main, /trackJob: \(\) => this\.jobs\.begin\(\)/u);
    assert.match(source("src/ui/editorActivity.ts"), /EditorView\.updateListener\.of\(/u);
  });
});

describe("job tracker (R-028)", () => {
  it("reports when jobs start and when the last one ends", async () => {
    const jobs = new JobTracker();
    const states: JobState[] = [];
    jobs.subscribe((state) => states.push(state));
    const first = jobs.begin();
    const second = jobs.begin();
    first();
    first();
    assert.equal(jobs.active, true);
    second(false);
    assert.deepEqual(states, [{ active: true }, { active: false, finished: false }]);
    await jobs.run(async () => ({ status: "saved" }));
    await jobs.run(async () => ({ status: "cancelled" }));
    await assert.rejects(jobs.run(async () => Promise.reject(new Error("x"))));
    assert.deepEqual(
      states.slice(2).filter((state) => !state.active).map((state) => state.finished),
      [true, false, false]
    );
  });
});
