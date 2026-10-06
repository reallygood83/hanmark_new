import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_HANMARK_SETTINGS, normalizeHanmarkSettings } from "../src/legacy-port/settings";
import {
  FORM_MEMORY_LIMIT,
  forgetNotePaths,
  movedPath,
  normalizeFormMemory,
  rememberNoteForm,
  rememberedNoteForm,
  renameNotePaths
} from "../src/io/formMemory";
import {
  RECENT_EXPORT_LIMIT,
  forgetRecentExports,
  normalizeRecentExports,
  recordRecentExport,
  renameRecentExports
} from "../src/io/recentExports";
import { freeVaultPath, gongmunVaultStem, safeFileLabel, sourceContractGongmunName } from "../src/io/exportFileNames";
import { runGongmunBatch } from "../src/io/gongmunBatch";
import { markdownTable } from "../src/utils/markdownTable";
import { t } from "../src/i18n";

describe("quality-of-life settings (R-028)", () => {
  it("adds the new keys to settings v12 with their defaults", () => {
    const settings = normalizeHanmarkSettings({});
    assert.equal(settings.settingsVersion, 13);
    assert.deepEqual(settings.companyTemplateByNote, {});
    assert.equal(settings.toolbarCollapsed, false);
    assert.equal(settings.toolbarPeek, false);
    assert.equal(settings.toolbarLook, "classic");
    assert.equal(settings.toolbarFoldFormatInReading, true);
    assert.equal(settings.toolbarTextColor, "#1A73E8");
    assert.equal(settings.toolbarHighlightColor, "#FFF59D");
    assert.equal(settings.showStartPanel, true);
    assert.deepEqual(settings.recentExports, []);
    assert.equal(settings.previewFollowCursor, true);
    assert.equal(settings.statusCharCount, true);
    assert.equal(settings.statusGongmunForm, true);
    assert.deepEqual(settings.gongmunFormByNote, {});
    assert.notEqual(settings.recentExports, DEFAULT_HANMARK_SETTINGS.recentExports, "defaults are never shared");
  });

  it("repairs invalid values and stays idempotent", () => {
    const settings = normalizeHanmarkSettings({
      toolbarCollapsed: "yes",
      toolbarLook: "flat",
      toolbarTextColor: "12ab34",
      toolbarHighlightColor: "red",
      recentExports: [{ path: "a.hwpx", format: "hwpx", at: 5 }, { path: "b.pdf", format: "pdf" }, "x"],
      gongmunFormByNote: { "노트.md": "preset:report", "빈.md": "", "": "preset:plan", "숫자.md": 3 }
    });
    assert.equal(settings.toolbarCollapsed, false);
    assert.equal(settings.toolbarLook, "classic");
    assert.equal(settings.toolbarTextColor, "#12AB34");
    assert.equal(settings.toolbarHighlightColor, "#FFF59D");
    assert.deepEqual(settings.recentExports, [{ path: "a.hwpx", format: "hwpx", at: 5 }]);
    assert.deepEqual(settings.gongmunFormByNote, { "노트.md": "preset:report" });
    assert.deepEqual(normalizeHanmarkSettings(JSON.parse(JSON.stringify(settings))), settings);
  });
});

describe("remembered forms and recent exports (R-028)", () => {
  it("remembers the last form per note, most recent last, within the limit", () => {
    let memory = rememberNoteForm({}, "a.md", "preset:report");
    memory = rememberNoteForm(memory, "b.md", "builtin:hallym-aicr");
    memory = rememberNoteForm(memory, "a.md", "preset:plan");
    assert.deepEqual(Object.entries(memory), [["b.md", "builtin:hallym-aicr"], ["a.md", "preset:plan"]]);
    const full = Array.from({ length: FORM_MEMORY_LIMIT + 3 }, (_value, index) => index).reduce(
      (current, index) => rememberNoteForm(current, `${index}.md`, "preset:report"),
      {} as Record<string, string>
    );
    assert.equal(Object.keys(full).length, FORM_MEMORY_LIMIT);
    assert.equal(Object.keys(full)[0], "3.md");
    assert.equal(Object.keys(normalizeFormMemory(full, 2)).join(), `${FORM_MEMORY_LIMIT + 1}.md,${FORM_MEMORY_LIMIT + 2}.md`);
    assert.equal(rememberedNoteForm(memory, "a.md", (id) => id === "preset:plan"), "preset:plan");
    assert.equal(rememberedNoteForm(memory, "b.md", (id) => id === "preset:plan"), undefined, "a deleted form is not offered");
  });

  it("follows renamed and deleted notes and folders", () => {
    assert.equal(movedPath("dir/a.md", "dir", "new"), "new/a.md");
    assert.equal(movedPath("directory/a.md", "dir", "new"), null);
    const memory = { "dir/a.md": "preset:report", "dir/sub/b.md": "preset:plan", "c.md": "preset:notice" };
    assert.deepEqual(renameNotePaths(memory, "dir", "moved"), {
      "moved/a.md": "preset:report",
      "moved/sub/b.md": "preset:plan",
      "c.md": "preset:notice"
    });
    assert.deepEqual(renameNotePaths(memory, "c.md", "d.md")["d.md"], "preset:notice");
    assert.deepEqual(forgetNotePaths(memory, "dir"), { "c.md": "preset:notice" });

    let recent = recordRecentExport([], { path: "dir/a.hwpx", format: "hwpx", at: 1 });
    recent = recordRecentExport(recent, { path: "b.docx", format: "docx", at: 2 });
    recent = recordRecentExport(recent, { path: "dir/a.hwpx", format: "hwpx", at: 3 });
    assert.deepEqual(recent.map((item) => [item.path, item.at]), [["dir/a.hwpx", 3], ["b.docx", 2]]);
    assert.deepEqual(renameRecentExports(recent, "dir", "moved").map((item) => item.path), ["moved/a.hwpx", "b.docx"]);
    assert.deepEqual(forgetRecentExports(recent, "b.docx").map((item) => item.path), ["dir/a.hwpx"]);
    const many = Array.from({ length: RECENT_EXPORT_LIMIT + 2 }, (_value, index) => ({ path: `${index}.html`, format: "html", at: index }));
    assert.equal(normalizeRecentExports(many).length, RECENT_EXPORT_LIMIT);
  });
});

describe("official-document file names (R-028)", () => {
  it("cleans labels and finds a free vault path", () => {
    assert.equal(safeFileLabel(' 우리 "학과"/보고서: [초안] #1 '), "우리 학과 보고서 초안 1");
    assert.equal(safeFileLabel("가".repeat(60)).length, 40);
    assert.equal(gongmunVaultStem("무제", "업무보고"), "무제 - 업무보고");
    assert.equal(gongmunVaultStem("무제", ""), "무제");
    assert.equal(sourceContractGongmunName("원본", "보고서", "20260930_101500"), "원본_보고서_20260930_101500.hwpx");
    const taken = new Set(["notes/무제 - 업무보고.hwpx", "notes/무제 - 업무보고 (1).hwpx"].map((path) => path.toLowerCase()));
    assert.equal(
      freeVaultPath("notes/", "무제 - 업무보고", ".hwpx", (path) => taken.has(path.toLowerCase())),
      "notes/무제 - 업무보고 (2).hwpx"
    );
    assert.equal(freeVaultPath("", "A", ".hwpx", (path) => path === "a.hwpx"), "A.hwpx");
  });
});

describe("several forms at once (R-028)", () => {
  it("runs forms in order, keeps going after a failure, and stops between forms", async () => {
    let stop = false;
    const progress: string[] = [];
    const entries = await runGongmunBatch(
      ["보고서", "실패", "계획서", "공고"],
      async (form) => {
        if (form === "실패") throw new Error("깨짐");
        if (form === "계획서") stop = true;
        return `${form}.hwpx`;
      },
      { onProgress: (index, total, form) => progress.push(`${index + 1}/${total} ${form}`), isCancelled: () => stop }
    );
    assert.deepEqual(entries.map((entry) => entry.status), ["saved", "failed", "saved", "cancelled"]);
    assert.equal(entries[1].error, "깨짐");
    assert.deepEqual(progress, ["1/4 보고서", "2/4 실패", "3/4 계획서"]);
  });

  it("asks about missing images once and reuses the answer", async () => {
    const missing = new Error("images");
    const calls: Array<[string, boolean]> = [];
    let asked = 0;
    const entries = await runGongmunBatch(
      ["a", "b"],
      async (form, allow) => {
        calls.push([form, allow]);
        if (!allow) throw missing;
        return form;
      },
      { isImageFailure: (error) => error === missing, decideImageFailures: async () => (asked++, "continue") }
    );
    assert.equal(asked, 1);
    assert.deepEqual(calls, [["a", false], ["a", true], ["b", true]]);
    assert.deepEqual(entries.map((entry) => entry.status), ["saved", "saved"]);

    const cancelled = await runGongmunBatch(["a", "b"], async () => Promise.reject(missing), {
      isImageFailure: () => true,
      decideImageFailures: async () => "cancel"
    });
    assert.deepEqual(cancelled.map((entry) => entry.status), ["cancelled", "cancelled"]);
  });
});

describe("table skeletons (R-028)", () => {
  it("keeps the insert-table command's 3 × 3 table byte-identical", () => {
    const labels = {
      header: (index: number) => t("editor.insert.tableHeader", { number: index }),
      cell: (index: number) => t("editor.insert.tableCell", { number: index })
    };
    assert.equal(
      markdownTable(3, 3, labels),
      "\n| 제목 1 | 제목 2 | 제목 3 |\n|--------|--------|--------|\n| 내용 1 | 내용 2 | 내용 3 |\n| 내용 4 | 내용 5 | 내용 6 |\n"
    );
    assert.equal(markdownTable(1, 2, labels), "\n| 제목 1 | 제목 2 |\n|--------|--------|\n");
    assert.equal(markdownTable(99, 0, labels).split("\n").length, 20 + 3);
  });
});
