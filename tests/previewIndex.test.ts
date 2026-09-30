import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { App, TFile } from "obsidian";
import { DOMParser } from "@xmldom/xmldom";
import { renderQuickHwpxPreview, type GenerateHwpxOptions } from "../src/io/kordocEngine";
import { gongmunGenerateOptions, planGongmunExport } from "../src/io/gongmunExport";
import {
  alignHeadings,
  anchorAt,
  followTarget,
  headingKey,
  indexKordocSvg,
  noteHeadings,
  offsetFor,
  pageAt,
  stepZoom,
  type PreviewIndex,
  type SvgElementLike
} from "../src/ui/previewIndex";

const FRONT = ["---", "공문_종류: 보고서", "---"];
const BODY = [
  "# 2027년 업무 추진 계획",
  "",
  "## 추진 배경",
  "",
  "배경 설명 문단입니다.",
  "",
  "### 현황",
  "",
  "- 첫째 항목",
  "- 둘째 항목",
  "",
  "```md",
  "## 코드 속 제목",
  "```",
  "",
  "## 추진 내용",
  "",
  "내용 문단입니다. ".repeat(400),
  "",
  "### 세부 과제",
  "",
  "| 과제 | 담당 |",
  "|---|---|",
  "| 가 | 나 |",
  "",
  "## 기대 효과",
  "",
  "효과 설명."
];
const NOTE = [...FRONT, ...BODY].join("\n");
const line = (text: string): number => [...FRONT, ...BODY].indexOf(text);

const FILE = { basename: "노트", path: "노트.md" } as TFile;
const APP = { metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } as unknown as App;

async function render(formId?: string): Promise<PreviewIndex> {
  const options: GenerateHwpxOptions = formId
    ? gongmunGenerateOptions(planGongmunExport(APP, FILE, { settings: {}, saveSettings: async () => {} }, undefined, formId))
    : {};
  const result = await renderQuickHwpxPreview(BODY.join("\n"), options);
  const svg = new DOMParser().parseFromString(result.render.svg, "image/svg+xml").documentElement;
  const index = indexKordocSvg(svg as unknown as SvgElementLike);
  assert.equal(index.pages.length, result.render.pageCount);
  assert.ok(Math.abs(index.height - result.render.height) < 0.01);
  return index;
}

describe("preview page index (R-028)", () => {
  it("lists the note's headings with their editor lines, outside code and front matter", () => {
    const headings = noteHeadings(NOTE);
    assert.deepEqual(
      headings.map((heading) => [heading.line, heading.level, heading.text]),
      [
        [line("# 2027년 업무 추진 계획"), 1, "2027년 업무 추진 계획"],
        [line("## 추진 배경"), 2, "추진 배경"],
        [line("### 현황"), 3, "현황"],
        [line("## 추진 내용"), 2, "추진 내용"],
        [line("### 세부 과제"), 3, "세부 과제"],
        [line("## 기대 효과"), 2, "기대 효과"]
      ]
    );
    assert.deepEqual(
      noteHeadings("%%\n# 숨긴 제목\n%%\n<!--\n# 주석\n-->\n$$\n# 수식\n$$\n# 보이는 제목 ##").map((item) => item.text),
      ["보이는 제목"]
    );
    assert.equal(headingKey("**굵은** [링크](https://example.com) [[노트|별칭]] `코드` ==표시== ^abc-1"), "굵은링크별칭코드표시");
  });

  it("reads pages and paragraphs of a quick HWPX render and finds every heading", async () => {
    const index = await render();
    assert.ok(index.pages.length >= 2, "the long paragraph fills more than one page");
    assert.ok(index.pages.every((page, at) => page.height > 0 && (at === 0 || page.top > index.pages[at - 1].top)));
    const aligned = alignHeadings(noteHeadings(NOTE), index.paragraphs);
    assert.equal(aligned.length, 6);
    assert.ok(aligned.every((item, at) => at === 0 || item.top >= aligned[at - 1].top));
  });

  it("matches the body copy of a heading, not the cover or the table of contents", async () => {
    for (const [form, expected] of [
      ["preset:plan", { title: 2, background: 2 }],
      ["preset:ministry", { title: 1, background: 3 }],
      ["preset:gaejosik", { title: 3, background: 3 }]
    ] as const) {
      const index = await render(form);
      const aligned = alignHeadings(noteHeadings(NOTE), index.paragraphs);
      const at = (text: string): number => {
        const found = aligned.find((item) => item.line === line(text));
        assert.ok(found, `${form}: ${text}`);
        return pageAt(index, found.top);
      };
      assert.equal(at("# 2027년 업무 추진 계획"), expected.title, `${form} title`);
      assert.equal(at("## 추진 배경"), expected.background, `${form} background`);
      assert.equal(aligned.length, 6, form);
    }
  });

  it("follows a line between the headings around it", async () => {
    const index = await render("preset:ministry");
    const aligned = alignHeadings(noteHeadings(NOTE), index.paragraphs);
    const content = aligned.find((item) => item.line === line("## 추진 내용"));
    const task = aligned.find((item) => item.line === line("### 세부 과제"));
    assert.ok(content && task);
    const middle = followTarget(line("내용 문단입니다. ".repeat(400)), aligned, NOTE.split("\n").length, index.height);
    assert.ok(middle > content.top && middle < task.top);
    assert.equal(followTarget(line("## 추진 내용"), aligned, 40, index.height), content.top);
    assert.equal(followTarget(10, [], 20, 1000), 500, "without headings the position is proportional");
    assert.equal(followTarget(99, [], 20, 1000), 1000);
  });

  it("keeps the reading position across redraws and steps the zoom", async () => {
    const index = await render("preset:ministry");
    const third = index.pages[2];
    const y = third.top + third.height * 0.4;
    assert.equal(pageAt(index, y), 3);
    const anchor = anchorAt(index, y);
    assert.equal(anchor.page, 3);
    assert.ok(Math.abs(offsetFor(index, anchor) - y) < 0.001);
    const last = index.pages[index.pages.length - 1];
    assert.equal(offsetFor(index, { page: 99, ratio: 0.5 }), last.top + last.height, "a page that is gone ends at the last page");
    assert.equal(pageAt(index, -50), 1);

    assert.equal(stepZoom(100, 1), 110);
    assert.equal(stepZoom(100, -1), 90);
    assert.equal(stepZoom(83, 1), 90);
    assert.equal(stepZoom(83, -1), 75);
    assert.equal(stepZoom(200, 1), 200);
    assert.equal(stepZoom(50, -1), 50);
  });

  it("accepts numbering and bullets before a heading but not other words", () => {
    const match = (paragraph: string): number =>
      alignHeadings([{ line: 0, level: 2, text: "개요", key: "개요" }], [{ key: paragraph, top: 1 }]).length;
    for (const paragraph of ["개요", "ⅰ.개요", "1.개요", "1)개요", "(가)개요", "가.개요", "□개요", "①개요", "제1장개요", "1.2.개요", "iv.개요"]) {
      assert.equal(match(paragraph), 1, paragraph);
    }
    for (const paragraph of ["요약개요", "개요와전망", "한눈에보는개요"]) assert.equal(match(paragraph), 0, paragraph);
  });
});
