import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { simulateWrap } from "kordoc";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";
import { prepareGongmunMarkdown } from "../src/io/gongmunOutline";
import { finishGongmunXml } from "../src/io/hwpxFinish";
import { generateValidatedHwpx } from "../src/io/kordocEngine";
import { applyTypeFrame, resolveGongmunOptions } from "../src/io/gongmunStyle";
import type { GongmunPreset } from "kordoc";

async function sectionAndHeader(data: ArrayBuffer): Promise<{ section: string; header: string }> {
  const zip = await JSZip.loadAsync(data);
  return {
    section: await zip.file("Contents/section0.xml")!.async("string"),
    header: await zip.file("Contents/header.xml")!.async("string")
  };
}

async function generate(note: string, preset: GongmunPreset): Promise<{ section: string; header: string; warnings: { code: string; message: string; count: number }[] }> {
  // As the export plans it: the type's own frame (the plan cover, the draft's head and foot).
  const gongmun = applyTypeFrame(resolveGongmunOptions({ preset }), { today: new Date(2026, 8, 30) }).options;
  const generated = await generateValidatedHwpx(note, { gongmun, gongmunTitle: "문서" });
  assert.equal(generated.validation.ok, true);
  return { ...(await sectionAndHeader(generated.data)), warnings: generated.warnings };
}

function tables(section: string): string[] {
  return section.match(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g) ?? [];
}

function cellsOf(xml: string): string[] {
  return xml.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) ?? [];
}

function cellText(cell: string): string {
  return [...cell.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((match) => match[1]).join("");
}

/** Size of a table (its hp:sz) or of a cell or row (its first cell). */
function size(xml: string): { width: number; height: number } {
  const match = xml.startsWith("<hp:tbl")
    ? /<hp:sz width="(\d+)" widthRelTo="\w+" height="(\d+)"/.exec(xml)
    : /<hp:cellSz width="(\d+)" height="(\d+)"/.exec(xml);
  assert.ok(match);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The frame table whose named cell holds `text`, with that row's cells. */
function frameWith(section: string, name: string, text: string): { table: string; row: string[]; cell: string } {
  for (const table of tables(section)) {
    for (const row of table.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) ?? []) {
      const cells = cellsOf(row);
      const cell = cells.find((item) => item.startsWith(`<hp:tc name="${name}"`) && cellText(item).includes(text));
      if (cell) return { table, row: cells, cell };
    }
  }
  assert.fail(`no ${name} frame with ${text}`);
}

function ratioOf(header: string, cell: string): number {
  const id = /<hp:run charPrIDRef="(\d+)"/.exec(cell)?.[1];
  const element = new RegExp(`<hh:charPr id="${id}"[\\s\\S]*?</hh:charPr>`).exec(header)?.[0] ?? "";
  return Number(/<hh:ratio hangul="(\d+)"/.exec(element)?.[1]);
}

describe("Markdown that prints the same in every official-document style (R-027)", () => {
  it("drops comments outside code and keeps them in code", () => {
    const { markdown } = adaptMarkdownForKordoc(
      [
        "<!-- 메모 -->",
        "",
        "본문 <!-- 숨김 --> 이어짐",
        "",
        "%% 옵시디언 주석 %%",
        "",
        "여러 줄 <!-- 시작",
        "끝 --> 다음",
        "",
        "`<!-- 코드 -->` 그대로",
        "",
        "```",
        "<!-- 펜스 속 -->",
        "```"
      ].join("\n")
    );
    assert.ok(!/메모|숨김|옵시디언 주석|시작|끝/u.test(markdown));
    assert.match(markdown, /^본문 이어짐$/mu);
    assert.match(markdown, /^여러 줄 다음$/mu);
    assert.match(markdown, /`<!-- 코드 -->` 그대로/u);
    assert.match(markdown, /^<!-- 펜스 속 -->$/mu);
  });

  it("escapes brackets inside link text so the whole link survives", () => {
    const { markdown } = adaptMarkdownForKordoc("### 4. [[AIC 2026] 임석진 교수](https://example.com/a)\n\n`[[a] b](c)` 코드\n\n![그림 [1]](x.png)\n");
    assert.match(markdown, /^### 4\. \[\\\[AIC 2026\\\] 임석진 교수\]\(https:\/\/example\.com\/a\)$/mu);
    assert.match(markdown, /`\[\[a\] b\]\(c\)` 코드/u);
    assert.match(markdown, /!\[그림 \[1\]\]\(x\.png\)/u);
  });

  it("prints plain words in frames that print raw text", () => {
    const ministry = prepareGongmunMarkdown(
      "# [제목](https://t)\n\n## [장](https://a) **굵게**\n\n### 절 [\\[AIC 2026\\] 링크](https://b)\n\n#### `코드` 상자\n",
      { preset: "ministry" }
    ).markdown;
    assert.match(ministry, /^# 제목$/mu);
    assert.match(ministry, /^## 장 굵게$/mu);
    assert.match(ministry, /^### 절 \[AIC 2026\] 링크$/mu);
    assert.match(ministry, /^#### 코드 상자$/mu);

    const note = "# 제목\n\n## [장](https://a)\n\n### [항목](https://b)\n";
    assert.match(prepareGongmunMarkdown(note, { preset: "report" }).markdown, /^## 장\n\n### \[항목\]\(https:\/\/b\)$/mu);
    assert.match(prepareGongmunMarkdown(note, { preset: "gaejosik" }).markdown, /^## 장$/mu);
    assert.match(prepareGongmunMarkdown(note, { preset: "report", h2Marker: "roman" }).markdown, /^## \[장\]\(https:\/\/a\)$/mu);
  });

  it("bolds sub-headings around link text so links stay links", () => {
    const bold = prepareGongmunMarkdown("# 제목\n\n## 장\n\n### [링크](https://a) 설명\n\n### **이미 굵게**\n", {
      preset: "minutes",
      boldSubHeadings: true
    }).markdown;
    assert.match(bold, /\[\*\*링크\*\*\]\(https:\/\/a\) \*\*설명\*\*/u);
    assert.match(bold, /^#+ \*\*이미 굵게\*\*$/mu);
  });

  it("prints the report summary box as plain lines and splits other quotes line by line", () => {
    const report = prepareGongmunMarkdown("# 제목\n\n> **요약** [링크](https://a)\n> 둘째 줄\n\n## 장\n\n> 참고 **굵게**\n", {
      preset: "report"
    }).markdown;
    assert.match(report, /^> 요약 링크\n> 둘째 줄$/mu);
    assert.match(report, /^> 참고 \*\*굵게\*\*$/mu);

    const quote = "# 제목\n\n## 장\n\n> **참고**\n> - 가\n> 1. 나\n";
    assert.match(prepareGongmunMarkdown(quote, { preset: "official" }).markdown, /^> \*\*참고\*\*\n>\n> 가\n>\n> 나$/mu);
    assert.match(prepareGongmunMarkdown(quote, { preset: "ministry" }).markdown, /^> \*\*참고\*\*\n> - 가\n> 1\. 나$/mu);
  });

  it("reports a Kordoc note once per kind with its count", async () => {
    const long = "대학 교육 현장의 평가 방식과 학습 윤리 기준에 미치는 영향을 정리하고 후속 과제를 제안하는 항목입니다";
    const { warnings } = await generate(`# 제목\n\n## 장\n\n### ${long} 첫째\n\n### ${long} 둘째\n`, "report");
    const notes = warnings.filter((warning) => warning.code === "engine-note" && warning.message.startsWith("□ 항목이 한 줄에"));
    assert.equal(notes.length, 1);
    assert.equal(notes[0].count, 2);
  });
});

// A header with one 15 pt HY헤드라인M character shape and one 130 % paragraph shape.
const HEADER = [
  "<hh:head>",
  '<hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="HY헤드라인M" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces>',
  '<hh:charProperties itemCnt="1"><hh:charPr id="0" height="1500" textColor="#000000"><hh:fontRef hangul="0" latin="0"/><hh:ratio hangul="100" latin="100"/><hh:spacing hangul="0" latin="0"/></hh:charPr></hh:charProperties>',
  '<hh:borderFills itemCnt="1"><hh:borderFill id="1"></hh:borderFill></hh:borderFills>',
  '<hh:paraProperties itemCnt="1"><hh:paraPr id="0"><hh:margin><hc:intent value="0"/><hc:left value="0"/><hc:right value="0"/><hc:prev value="0"/><hc:next value="0"/></hh:margin><hh:lineSpacing type="PERCENT" value="130"/></hh:paraPr></hh:paraProperties>',
  "</hh:head>"
].join("");
const LINE = Math.round(1500 * 1.3);
const MARGINS = 280;

function tc(text: string, options: { name?: string; width: number; height: number; row?: number; col?: number; rowSpan?: number }): string {
  return (
    `<hp:tc name="${options.name ?? ""}" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="1">` +
    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
    `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList>` +
    `<hp:cellAddr colAddr="${options.col ?? 0}" rowAddr="${options.row ?? 0}"/><hp:cellSpan colSpan="1" rowSpan="${options.rowSpan ?? 1}"/>` +
    `<hp:cellSz width="${options.width}" height="${options.height}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`
  );
}

function sectionWith(id: number, rows: string[][], width: number, height: number): string {
  const body = rows.map((cells) => `<hp:tr>${cells.join("")}</hp:tr>`).join("");
  return (
    '<hs:sec><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">' +
    `<hp:tbl id="${id}" zOrder="0" rowCnt="${rows.length}" colCnt="${rows[0].length}" cellSpacing="0" borderFillIDRef="1" noAdjust="1">` +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:inMargin left="140" right="140" top="140" bottom="140"/>${body}</hp:tbl></hp:run></hp:p></hs:sec>`
  );
}

function wraps(text: string, room: number, ratio = 100): number {
  return simulateWrap(text, room, room, 1500, ratio, "keep", { faceClass: "font:HY헤드라인M" }).lines;
}

describe("frames sized to their text (R-027)", () => {
  const LONG = "가".repeat(30);

  it("grows a frame row to the lines its text takes, keeping the room below it", () => {
    const section = sectionWith(9_300_501, [[tc("1", { width: 3000, height: 2340 }), tc(LONG, { name: "__kordoc_h3", width: 20000, height: 2340, col: 1 })]], 23000, 2340);
    const finished = finishGongmunXml(section, HEADER, { fitFrames: true });
    const lines = wraps(LONG, 20000 - MARGINS);
    assert.ok(lines > 1);
    const expected = MARGINS + lines * LINE + (2340 - (MARGINS + LINE));
    const cells = cellsOf(finished.section);
    assert.deepEqual(cells.map((cell) => size(cell).height), [expected, expected]);
    assert.equal(size(tables(finished.section)[0]).height, expected);
    assert.deepEqual(finished.missed, []);
  });

  it("condenses a line that runs over a little instead of wrapping it", () => {
    const room = 20000 - MARGINS;
    let text = "가";
    while (wraps(text, room) === 1) text += "가";
    assert.equal(wraps(text, room * 0.98, 85), 1, "the test line fits at 85 %");
    const section = sectionWith(9_300_501, [[tc(text, { name: "__kordoc_h4", width: 20000, height: 2410 })]], 20000, 2410);
    const finished = finishGongmunXml(section, HEADER, { fitFrames: true });
    const [cell] = cellsOf(finished.section);
    assert.equal(size(cell).height, 2410);
    assert.ok([95, 90, 85].includes(ratioOf(finished.header, cell)));
  });

  it("leaves Markdown tables, merged rows, and frames that already hold their text alone", () => {
    const markdown = sectionWith(1001, [[tc(LONG, { width: 20000, height: 2340 })]], 20000, 2340);
    assert.equal(finishGongmunXml(markdown, HEADER, { fitFrames: true }).section, markdown);

    const roomy = sectionWith(9_300_501, [[tc(LONG, { name: "__kordoc_h1", width: 20000, height: 9500 })]], 20000, 9500);
    assert.equal(finishGongmunXml(roomy, HEADER, { fitFrames: true }).section, roomy);

    const merged = sectionWith(
      9_300_502,
      [
        [tc(LONG, { width: 10000, height: 4680, rowSpan: 2 }), tc("가", { width: 10000, height: 2340, col: 1 })],
        [tc("나", { width: 10000, height: 2340, col: 1, row: 1 })]
      ],
      20000,
      4680
    );
    assert.equal(finishGongmunXml(merged, HEADER, { fitFrames: true }).section, merged);

    const off = sectionWith(9_300_501, [[tc(LONG, { name: "__kordoc_h3", width: 20000, height: 2340 })]], 20000, 2340);
    assert.equal(finishGongmunXml(off, HEADER, {}).section, off);
  });

  it("fits the ministry briefing's bands, boxes, and contents", async () => {
    const long = "“완벽한 AI 교육받은 인재는 환상…문제를 정의하고 기술 통제하는 ‘기본기’ 중요”";
    const english = "Impact of Generative Artificial Intelligence (AI) on the English Writing of Korean University Students: Based on Activity Theory";
    const slight = "대학생 생성형 인공지능 활용 실태와 과제—독서와 글쓰기 영역을 중심으로";
    const note = [
      "# 제목",
      "## 기사",
      "### 짧은 절",
      "- 내용",
      `### ${long}`,
      "- 내용",
      "## 연구",
      "### KCI",
      `#### ${english}`,
      "- 내용",
      `#### ${slight}`,
      "- 내용"
    ].join("\n\n");
    const { section, header } = await generate(note, "ministry");

    // Kordoc draws a section band 2 340 high for one line.
    assert.equal(size(frameWith(section, "__kordoc_h3", "짧은 절").cell).height, 2340);
    const band = frameWith(section, "__kordoc_h3", "완벽한 AI");
    const bandHeight = size(band.cell).height;
    assert.ok(bandHeight > 2340);
    assert.deepEqual(band.row.map((cell) => size(cell).height), band.row.map(() => bandHeight), "the number box grows with its title");
    assert.equal(size(band.table).height, bandHeight);

    assert.ok(size(frameWith(section, "__kordoc_h4", "Impact of Generative").cell).height >= MARGINS + 3 * LINE);
    const condensed = frameWith(section, "__kordoc_h4", "대학생 생성형").cell;
    assert.equal(size(condensed).height, 2410);
    assert.ok(ratioOf(header, condensed) < 100);

    // Fitting again finds nothing left to change.
    assert.equal(finishGongmunXml(section, header, { fitFrames: true }).section, section);
  });

  it("gives the plan cover's labels one line and the draft's long title its lines", async () => {
    const plan = await generate("# 제목\n\n## 장\n\n- 내용\n", "plan");
    const info = tables(plan.section).find((table) => table.includes("<hp:t>문서번호</hp:t>"));
    assert.ok(info);
    const [label, value] = cellsOf(info);
    assert.ok(size(label).width >= 5000);
    assert.equal(size(label).width + size(value).width, size(info).width);

    const title = "대학생의 생성형 AI 활용과 사고 외주화에 관한 최근 국내외 언론 보도 및 학술 연구 동향 종합 분석 보고";
    const titleRow = async (text: string): Promise<number> => {
      const { section } = await generate(`# ${text}\n\n## 장\n\n- 내용\n`, "official");
      const head = tables(section)[0];
      const row = (head.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g) ?? []).find((item) => item.includes(text.slice(0, 10)));
      assert.ok(row);
      return size(row).height;
    };
    assert.ok((await titleRow(title)) > (await titleRow("짧은 제목")));
  });
});
