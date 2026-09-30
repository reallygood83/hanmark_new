import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import JSZip from "jszip";
import type { App, TFile } from "obsidian";
import { presetFromName, readGongmunProperties } from "../src/io/gongmunProperties";
import { applyTypeFrame, resolveGongmunOptions, withCoverDate } from "../src/io/gongmunStyle";
import { prepareGongmunMarkdown } from "../src/io/gongmunOutline";
import { generateValidatedHwpx, type GenerateHwpxOptions } from "../src/io/kordocEngine";
import { GONGMUN_PRESETS, planGongmunExport } from "../src/io/gongmunExport";
import { builtinGongmunStyle } from "../src/io/institutionStyles";
import { setActiveGongmunTemplateInMemory, type TemplateLibraryHost } from "../src/io/templateLibrary";
import type { GongmunPreset } from "kordoc";

const DAY = new Date(2026, 8, 29);
const NOTE = "## 배경\n\n### 현황\n\n현황을 설명하는 문단입니다.\n\n- 첫째\n\t- 둘째\n\n## 계획\n\n- 추진\n";
const MARKER = /<hp:run charPrIDRef="\d+"><hp:t>([^<]{1,6})<hp:tab /g;

function host(): TemplateLibraryHost {
  return { settings: {}, saveSettings: async () => {} };
}

function noteApp(frontmatter: Record<string, unknown>): App {
  return { metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
}

const FILE = { basename: "노트", path: "노트.md" } as TFile;

async function parts(data: ArrayBuffer): Promise<{ section: string; header: string }> {
  const zip = await JSZip.loadAsync(data);
  return {
    section: await zip.file("Contents/section0.xml")!.async("string"),
    header: await zip.file("Contents/header.xml")!.async("string")
  };
}

function element(header: string, kind: "paraPr" | "charPr", id: string | undefined): string {
  return new RegExp(`<hh:${kind} id="${id}"[\\s\\S]*?</hh:${kind}>`).exec(header)?.[0] ?? "";
}

/** Paragraph shape and first character shape of the paragraph that contains `text`. */
function shapesOf(section: string, header: string, text: string): { para: string; char: string } {
  const at = section.indexOf(text);
  assert.ok(at >= 0, text);
  const open = section.lastIndexOf("<hp:p ", at);
  const head = section.slice(open, at);
  return {
    para: element(header, "paraPr", /paraPrIDRef="(\d+)"/.exec(head)?.[1]),
    char: element(header, "charPr", [...head.matchAll(/charPrIDRef="(\d+)"/g)].at(-1)?.[1])
  };
}

async function generateType(preset: GongmunPreset): Promise<{ data: ArrayBuffer; section: string; header: string }> {
  const frame = applyTypeFrame(resolveGongmunOptions({ preset }), { today: DAY });
  const generated = await generateValidatedHwpx(NOTE, {
    gongmun: withCoverDate(frame.options, DAY),
    gongmunTitle: "문서",
    gongmunOutline: frame.closing ? { closing: frame.closing } : undefined
  });
  assert.equal(generated.validation.ok, true, preset);
  return { data: generated.data, ...(await parts(generated.data)) };
}

describe("note properties left blank or named by menu labels (R-025)", () => {
  it("treats values left blank by insert-properties as unset", () => {
    const result = readGongmunProperties({ 공문_종류: "", 공문_기관: "", 공문_결재: [], 공문_표지: "", 공문_요약: " ", 공문_날짜: null });
    assert.deepEqual(result.issues, []);
    assert.equal(result.preset, undefined);
    assert.deepEqual(result.options, {});
  });

  it("reads type names shown in HanMark and reports unknown ones instead of guessing", () => {
    assert.equal(presetFromName("보고서"), "report");
    assert.equal(presetFromName("통지·안내"), "notice");
    assert.equal(presetFromName("공고"), "notice");
    assert.equal(presetFromName("기안문·시행문"), "official");
    assert.equal(presetFromName("정부 표준 개조식"), "gaejosik");
    assert.equal(presetFromName("Draft letter (기안문·시행문)"), "official");
    assert.equal(presetFromName("Ministry briefing (업무보고)"), "ministry");
    assert.equal(presetFromName("Minutes"), "minutes");
    assert.equal(presetFromName("회의 자료"), undefined);
    const unknown = readGongmunProperties({ 공문_종류: "회의 자료" });
    assert.equal(unknown.preset, undefined);
    assert.deepEqual(unknown.issues, [{ code: "invalid", key: "공문_종류" }]);
  });
});

describe("per-type frames (R-025)", () => {
  it("adds the draft-letter head and foot and keeps what the note set", () => {
    const frame = applyTypeFrame(resolveGongmunOptions({ preset: "official", note: { docHead: { to: "각 부서장" } } }), { today: DAY });
    assert.deepEqual(frame.options.docHead, { to: "각 부서장" });
    assert.deepEqual(frame.options.docFoot, {});
    assert.equal(frame.closing, undefined);
  });

  it("gives notices Kordoc's documented size and a closing with the date and sender", () => {
    const frame = applyTypeFrame(resolveGongmunOptions({ preset: "notice", note: { cover: { org: "한림대학교" } } }), { today: DAY });
    assert.equal(frame.options.bodyPt, 15);
    assert.equal(frame.options.lineSpacing, 160);
    assert.equal(frame.options.cover, undefined);
    assert.equal(frame.options.noticeHead, undefined);
    assert.deepEqual(frame.closing, { date: "2026. 9. 29.", sender: "한림대학교" });

    const numbered = applyTypeFrame(
      { preset: "notice", bodyPt: 13, noticeHead: { no: "제2026-1호", date: "2026. 10. 1.", sender: "총장" } },
      { today: DAY, org: "기관" }
    );
    assert.deepEqual(numbered.options.noticeHead, { no: "제2026-1호" });
    assert.equal(numbered.options.bodyPt, 13);
    assert.deepEqual(numbered.closing, { date: "2026. 10. 1.", sender: "총장" });
  });

  it("gives minutes 14 pt at 130 % and plans the policy cover", () => {
    const minutes = applyTypeFrame({ preset: "minutes" }, { today: DAY }).options;
    assert.equal(minutes.bodyPt, 14);
    assert.equal(minutes.lineSpacing, 130);
    assert.equal(applyTypeFrame({ preset: "plan" }, { today: DAY }).options.cover, true);
    assert.equal(applyTypeFrame({ preset: "plan", cover: false }, { today: DAY }).options.cover, false);
    assert.equal(applyTypeFrame({ preset: "report" }, { today: DAY }).options.cover, undefined);
    assert.deepEqual(withCoverDate(applyTypeFrame({ preset: "plan" }, { today: DAY }).options, DAY).cover, { date: "2026. 9." });
  });

  it("writes the notice closing and bold sub-headings into the Markdown", () => {
    const closing = prepareGongmunMarkdown("# 안내\n\n본문\n", { preset: "notice", closing: { date: "2026. 9. 29.", sender: "한림대학교" } });
    assert.match(closing.markdown, /본문\n\n<right>2026\. 9\. 29\.<\/right>\n\n<right>\*\*한림대학교\*\*<\/right>\n$/u);
    const bold = prepareGongmunMarkdown("# 회의\n\n## 개요\n\n### 1) 추진 방향\n\n### **이미 굵게**\n", { preset: "minutes", boldSubHeadings: true });
    assert.match(bold.markdown, /^#### \*\*추진 방향\*\*$/mu);
    assert.match(bold.markdown, /^#### \*\*이미 굵게\*\*$/mu);
  });

  it("makes eight different documents from one note", async () => {
    const hashes = new Set<string>();
    for (const { value } of GONGMUN_PRESETS) {
      const { data } = await generateType(value);
      hashes.add(createHash("sha256").update(new Uint8Array(data)).digest("hex"));
    }
    assert.equal(hashes.size, GONGMUN_PRESETS.length);
  });

  it("draws each type's own frame", async () => {
    const official = await generateType("official");
    assert.match(official.section, /수신/u);
    assert.match(official.section, /시행/u);
    assert.match(official.section, /<hp:t>끝\.<\/hp:t>|끝\./u);

    const notice = await generateType("notice");
    const closing = shapesOf(notice.section, notice.header, "2026.");
    assert.match(closing.para, /<hh:align horizontal="RIGHT"/u);
    assert.ok(Number(/<hc:prev value="(\d+)"/u.exec(closing.para)?.[1]) > 0, "a blank line before the date");
    assert.match(shapesOf(notice.section, notice.header, "현황을 설명하는 문단입니다.").char, /height="1500"/u);

    const minutes = await generateType("minutes");
    const body = shapesOf(minutes.section, minutes.header, "현황을 설명하는 문단입니다.");
    assert.match(body.char, /height="1400"/u);
    assert.match(body.para, /<hh:lineSpacing type="PERCENT" value="130"/u);

    const plan = await generateType("plan");
    assert.match(plan.section, /방침번호/u);
    assert.match(plan.section, /pageBreak="1"/u);
    const report = await generateType("report");
    assert.doesNotMatch(report.section, /방침번호/u);
  });
});

describe("built-in styles fix the document type (R-025)", () => {
  it("uses the style's type over the note's 공문_종류 and says so", () => {
    const plugin = host();
    setActiveGongmunTemplateInMemory(plugin, "builtin:hallym-ilsong");
    const app = noteApp({ 공문_종류: "보고서", 공문_결재: [] });
    const plan = planGongmunExport(app, FILE, plugin);
    assert.equal(plan.preset, "minutes");
    const warnings = plan.warnings.filter((warning) => warning.code === "gongmun-property");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /회의록/u);

    assert.equal(planGongmunExport(app, FILE, host()).preset, "report");
    const notice = planGongmunExport(noteApp({ 공문_기관: "한림대학교" }), FILE, host(), "notice");
    assert.equal(notice.outline?.closing?.sender, "한림대학교");
    assert.match(notice.outline?.closing?.date ?? "", /^\d{4}\. \d{1,2}\. \d{1,2}\.$/u);
  });

  it("draws the Ilsong minutes with bold sub-headings and bullets at every depth", async () => {
    const style = builtinGongmunStyle("builtin:hallym-ilsong");
    assert.ok(style);
    const frame = applyTypeFrame(resolveGongmunOptions({ preset: style.preset, style: style.options }), { today: DAY });
    const options: GenerateHwpxOptions = {
      gongmun: frame.options,
      gongmunFinish: style.finish,
      gongmunOutline: { ...style.outline, closing: frame.closing },
      gongmunTitle: "회의록"
    };
    const deep = "## 배경\n\n### 현황\n\n- 첫째\n\t- 둘째\n\t\t- 셋째\n\t\t\t- 넷째\n";
    const generated = await generateValidatedHwpx(deep, options);
    assert.equal(generated.validation.ok, true);
    const { section, header } = await parts(generated.data);
    const markers = [...section.matchAll(MARKER)].map((match) => match[1]);
    // 1. → • (###) → - → · and deeper levels keep · instead of (1) (가).
    assert.deepEqual(markers, ["1.", "•", "-", "·", "·", "·"]);
    assert.match(shapesOf(section, header, "<hp:t>현황</hp:t>").char, /bold="1"/u);
  });
});
