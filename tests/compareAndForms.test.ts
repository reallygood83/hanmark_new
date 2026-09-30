import assert from "node:assert/strict";
import { describe, it } from "node:test";
import MarkdownIt from "markdown-it";
import { markdownToHwpx, parse, validateHwpx, type DiffResult, type IRBlock, type IRTable } from "kordoc";
import { diffWords, escapeMarkdownText, tokenizeWords } from "../src/io/wordDiff";
import { compareNoteBaseName, renderCompareNote, safeBaseName } from "../src/io/compareNote";
import { alignedDiff, blockKey, compareDocuments } from "../src/io/documentDiff";
import {
  BUILTIN_FORM_PREFIX,
  FORM_HASH_KEY,
  FORM_LINK_KEY,
  collectFormValues,
  fillFormHwpx,
  formHash,
  formLinkTarget,
  formNoteBody,
  formNoteProperties,
  headerRowColumns,
  readFormFields,
  type FormFieldSpec
} from "../src/io/formFill";
import { BUILTIN_FORMS, builtinFormBytes, isBuiltinFormId } from "../src/io/builtinForms";
import { bytesAsArrayBuffer } from "../src/io/fileGateway";

const md = new MarkdownIt();

function paragraph(text: string): IRBlock {
  return { type: "paragraph", text };
}

function heading(text: string): IRBlock {
  return { type: "heading", level: 1, text };
}

function tableOf(rows: string[][]): IRTable {
  return {
    rows: rows.length,
    cols: rows[0]?.length ?? 0,
    cells: rows.map((row) => row.map((text) => ({ text, colSpan: 1, rowSpan: 1 }))),
    hasHeader: rows.length > 1
  };
}

function table(rows: string[][]): IRBlock {
  return { type: "table", table: tableOf(rows) };
}

async function hwpx(markdown: string): Promise<Uint8Array> {
  return new Uint8Array(await markdownToHwpx(markdown));
}

async function markdownOf(data: ArrayBuffer | Uint8Array): Promise<string> {
  const parsed = await parse(data instanceof Uint8Array ? bytesAsArrayBuffer(data.slice()) : data);
  assert.ok(parsed.success, "the document parses");
  return parsed.success ? parsed.markdown : "";
}

describe("word-level difference (2.7.0 W7)", () => {
  it("splits Korean words, particles, and punctuation into tokens", () => {
    assert.deepEqual(tokenizeWords("제1조(목적) 이 규정"), ["제1조", "(", "목적", ")", " ", "이", " ", "규정"]);
  });

  it("marks the whole changed word, so emphasis always renders", () => {
    const marked = diffWords("제1조(목적) 이 규정은", "제1조(목표) 이 규정은");
    assert.deepEqual(marked, { before: "**제1조(목적)** 이 규정은", after: "**제1조(목표)** 이 규정은" });
    assert.equal(md.renderInline(marked.after), "<strong>제1조(목표)</strong> 이 규정은");
  });

  it("joins neighbouring changed words into one phrase", () => {
    assert.deepEqual(diffWords("가 나 다", "가 새 규정 다"), { before: "가 **나** 다", after: "가 **새 규정** 다" });
    assert.deepEqual(diffWords("현행 규정을 적용한다", "개정 규정을 즉시 적용한다"), {
      before: "**현행** 규정을 적용한다",
      after: "**개정** 규정을 **즉시** 적용한다"
    });
  });

  it("offers a highlight mark and keeps identical text unmarked", () => {
    assert.equal(diffWords("A안", "B안", "highlight").after, "==B안==");
    assert.deepEqual(diffWords("같은 문장", "같은 문장"), { before: "같은 문장", after: "같은 문장" });
  });

  it("never lets emphasis cross a line break", () => {
    assert.equal(diffWords("첫 줄\n둘째 줄", "첫 줄\n셋째 줄").after, "첫 줄\n**셋째** 줄");
    assert.deepEqual(diffWords("", "새 문장\n둘째 줄"), { before: "", after: "**새 문장**\n**둘째 줄**" });
  });

  it("escapes the documents' own Markdown characters", () => {
    const literal = "a|b $5 *x* _y_ `c` <b> [^1] [[w]] ==h== %%c%% #tag C# 3~5 \\";
    assert.equal(
      escapeMarkdownText(literal),
      "a\\|b \\$5 \\*x\\* \\_y\\_ \\`c\\` \\<b> \\[^1] \\[[w]] \\==h\\== \\%%c\\%% \\#tag C# 3\\~5 \\\\"
    );
    assert.equal(md.renderInline(escapeMarkdownText(literal)), md.utils.escapeHtml(literal));
    assert.deepEqual(diffWords("값 *5*", "값 *6*"), { before: "값 **\\*5\\***", after: "값 **\\*6\\***" });
    assert.equal(md.renderInline("값 **\\*6\\***"), "값 <strong>*6*</strong>");
  });
});

const sampleResult: DiffResult = {
  stats: { added: 1, removed: 1, modified: 2, unchanged: 1 },
  diffs: [
    { type: "unchanged", before: paragraph("제1조(목적)"), after: paragraph("제1조(목적)") },
    { type: "modified", before: paragraph("요금은 \\$5 이고 a|b 이다."), after: paragraph("요금은 \\$7 이고 a|b 이다.") },
    { type: "removed", before: paragraph("삭제될 조문") },
    { type: "added", after: paragraph("첫 줄\n둘째 줄") },
    {
      type: "modified",
      before: table([["항목", "기준"], ["정원", "30명"]]),
      after: table([["항목", "기준"], ["정원", "40명|명"]]),
      cellDiffs: [
        [
          { type: "unchanged", before: "항목", after: "항목" },
          { type: "unchanged", before: "기준", after: "기준" }
        ],
        [
          { type: "unchanged", before: "정원", after: "정원" },
          { type: "modified", before: "30명", after: "40명|명" }
        ]
      ]
    }
  ]
};

describe("old–new comparison note (2.7.0 W7)", () => {
  it("writes a summary, a comparison table, and table cell changes", () => {
    const note = renderCompareNote(sampleResult, { beforeName: "규정 v1.hwpx", afterName: "규정 v2.hwpx", locale: "ko" });
    const lines = note.split("\n");
    assert.equal(lines[0], "# 신구대조표: 규정 v1.hwpx → 규정 v2.hwpx");
    assert.ok(lines.includes("> 추가 1 · 삭제 1 · 수정 2 · 동일 1"));
    assert.ok(lines.includes("| 구분 | 현행 | 개정(안) |"));
    assert.ok(lines.includes("| 수정 | 요금은 **\\$5** 이고 a\\|b 이다. | 요금은 **\\$7** 이고 a\\|b 이다. |"));
    assert.ok(lines.includes("| 삭제 | **삭제될 조문** |  |"));
    assert.ok(lines.includes("| 추가 |  | **첫 줄**<br>**둘째 줄** |"));
    assert.ok(lines.includes("| 수정 | [표 1 · 2행 2열] | [표 1 · 2행 2열] |"));
    assert.ok(lines.includes("- 표 1 · 2행 2열: 30명 → 40명\\|명"));
    assert.ok(!note.includes("| 동일 |"), "unchanged blocks are hidden by default");

    const html = md.render(note);
    assert.ok(html.includes("<td>요금은 <strong>$5</strong> 이고 a|b 이다.</td>"), "pipes and dollars stay literal");
  });

  it("can include unchanged blocks and write English labels", () => {
    const withUnchanged = renderCompareNote(sampleResult, { beforeName: "a", afterName: "b", includeUnchanged: true, locale: "ko" });
    assert.ok(withUnchanged.includes("| 동일 | 제1조(목적) | 제1조(목적) |"));

    const english = renderCompareNote(sampleResult, { beforeName: "a.hwpx", afterName: "b.hwpx", locale: "en" });
    assert.ok(english.startsWith("# Comparison: a.hwpx → b.hwpx\n"));
    assert.ok(english.includes("| Change | Current | Revised |"));
    assert.ok(english.includes("| Removed | **삭제될 조문** |  |"));
    assert.ok(english.includes("- Table 1 · row 2, column 2: 30명 → 40명\\|명"));
  });

  it("says so when nothing changed", () => {
    const same: DiffResult = {
      stats: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      diffs: [{ type: "unchanged", before: paragraph("가"), after: paragraph("가") }]
    };
    const note = renderCompareNote(same, { beforeName: "a", afterName: "b", locale: "ko" });
    assert.ok(note.includes("두 문서의 내용이 같습니다."));
    assert.ok(!note.includes("| 구분 |"));
  });

  it("names the note without characters Obsidian rejects", () => {
    assert.equal(compareNoteBaseName("규정/초안.hwp", "규정:최종#2.hwpx", "ko"), "신구대조표 - 규정_초안 → 규정_최종_2");
    assert.equal(compareNoteBaseName("a.pdf", "b.docx", "en"), "Comparison - a → b");
    assert.equal(safeBaseName("  a  [b] | c  "), "a _b_ _ c");
  });
});

describe("document alignment (2.7.0 W7)", () => {
  const before = [
    heading("운영 규정"),
    paragraph("제1조(목적) 이 규정은 교육 과정 운영에 필요한 사항을 정한다."),
    paragraph("제2조(적용) 이 규정은 모든 학과에 적용한다.")
  ];
  const after = [
    heading("운영 규정"),
    paragraph("제1조(목표) 이 규정은 교육 과정 운영에 필요한 사항을 정한다."),
    paragraph("제2조(적용) 이 규정은 모든 학과에 적용한다."),
    paragraph("제3조(시행) 이 규정은 공포한 날부터 시행한다.")
  ];

  it("anchors identical blocks before pairing similar ones", () => {
    const result = alignedDiff(before, after);
    assert.deepEqual(result.diffs.map((diff) => diff.type), ["unchanged", "modified", "unchanged", "added"]);
    assert.deepEqual(result.stats, { added: 1, removed: 0, modified: 1, unchanged: 2 });
    assert.equal(result.diffs[1].before?.text, before[1].text);
    assert.equal(result.diffs[1].after?.text, after[1].text);
  });

  it("keys blocks by content, ignoring whitespace", () => {
    assert.equal(blockKey(paragraph("a  b")), blockKey(paragraph(" a b ")));
    assert.notEqual(blockKey(heading("a")), blockKey(paragraph("a")));
    assert.notEqual(blockKey(table([["a", "b"]])), blockKey(table([["a", "c"]])));
  });

  it("compares real documents and exports the note to HWPX with the marks intact", async () => {
    const markdown = (article1: string, extra: string, headcount: string): string =>
      `# 운영 규정\n\n제1조(${article1}) 이 규정은 교육 과정 운영에 필요한 사항을 정한다.\n\n` +
      `제2조(적용) 이 규정은 모든 학과에 적용한다.\n\n${extra}| 항목 | 기준 |\n|---|---|\n| 정원 | ${headcount} |\n| 기간 | 3~5일 |\n`;
    const result = await compareDocuments(
      { name: "규정 v1.hwpx", bytes: await hwpx(markdown("목적", "", "30명")) },
      { name: "규정 v2.hwpx", bytes: await hwpx(markdown("목표", "제3조(시행) 이 규정은 공포한 날부터 시행한다.\n\n", "40명")) }
    );
    assert.deepEqual(result.diffs.map((diff) => diff.type), ["unchanged", "modified", "unchanged", "added", "modified"]);
    const note = renderCompareNote(result, { beforeName: "규정 v1.hwpx", afterName: "규정 v2.hwpx", locale: "ko" });
    assert.ok(note.includes("| 수정 | **제1조(목적)** 이 규정은 교육 과정 운영에 필요한 사항을 정한다. | **제1조(목표)** 이 규정은 교육 과정 운영에 필요한 사항을 정한다. |"));
    assert.ok(note.includes("- 표 1 · 2행 2열: 30명 → 40명"));

    const exported = await markdownToHwpx(note);
    assert.equal((await validateHwpx(exported)).ok, true);
    const back = await markdownOf(exported);
    assert.ok(back.includes("**제1조(목표)**"), "bold survives the HWPX round trip");
  });

  it("names the document that could not be read", async () => {
    const good = await hwpx("# 제목\n");
    await assert.rejects(
      compareDocuments({ name: "broken.hwpx", bytes: new Uint8Array([1, 2, 3, 4]) }, { name: "good.hwpx", bytes: good }),
      /^Error: broken\.hwpx: /u
    );
  });
});

describe("form filling (2.7.0 W8)", () => {
  it("reads the form link of a note", () => {
    assert.equal(formLinkTarget("[[서식/신청서.hwpx|신청서]]"), "서식/신청서.hwpx");
    assert.equal(formLinkTarget("서식/신청서.hwpx"), "서식/신청서.hwpx");
    assert.equal(formLinkTarget(`${BUILTIN_FORM_PREFIX}gian`), "builtin:gian");
    assert.equal(formLinkTarget(""), null);
    assert.equal(formLinkTarget(5), null);
  });

  it("reads header-row tables as columns, not label pairs", () => {
    assert.deepEqual(headerRowColumns(tableOf([["번호", "성명", "소속"], ["1", "", ""], ["2", "", ""]])), [
      { name: "성명", rows: 2, rowLabels: [] },
      { name: "소속", rows: 2, rowLabels: [] }
    ]);
    assert.deepEqual(headerRowColumns(tableOf([["성명", "생년월일"], ["", "(    )"]])), [
      { name: "성명", rows: 1, rowLabels: [] },
      { name: "생년월일", rows: 1, rowLabels: [] }
    ]);
    assert.deepEqual(headerRowColumns(tableOf([["항목", "금액", "비고"], ["인건비", "", ""], ["운영비", "", ""]])), [
      { name: "금액", rows: 2, rowLabels: ["인건비", "운영비"] },
      { name: "비고", rows: 2, rowLabels: ["인건비", "운영비"] }
    ]);
    assert.equal(headerRowColumns(tableOf([["성명", ""], ["주소", ""]])), null, "label–value table");
    assert.equal(headerRowColumns(tableOf([["구분", "내용"], ["성명", ""], ["주소", ""]])), null, "named rows, one blank column");
    assert.equal(headerRowColumns(tableOf([["성명", "소속"], ["홍길동", "기획과"]])), null, "already filled");
  });

  it("reads the click-here fields of the built-in draft letters", async () => {
    const gian = await readFormFields(builtinFormBytes("gian"));
    assert.equal(gian.length, 23);
    assert.ok(gian.every((field) => field.source === "clickhere"));
    assert.deepEqual(gian[0], { name: "행정기관명", hint: "행정기관명", type: "text", source: "clickhere", value: "" });
    assert.equal(gian.find((field) => field.name === "전자우편")?.type, "email");

    const simple = await readFormFields(builtinFormBytes("gian-simple"));
    assert.ok(simple.length > 0);
    assert.ok(simple.every((field) => field.source === "clickhere"));
  });

  it("reads label fields and header-row columns of an ordinary HWPX form", async () => {
    const labels = await readFormFields(await hwpx("# 참가 신청서\n\n| 성명 |  |\n|---|---|\n| 생년월일 |  |\n| 연락처 |  |\n| 이메일 |  |\n"));
    assert.deepEqual(labels.map((field) => [field.name, field.type, field.source]), [
      ["성명", "text", "label"],
      ["생년월일", "date", "label"],
      ["연락처", "phone", "label"],
      ["이메일", "email", "label"]
    ]);

    const roster = await readFormFields(await hwpx("# 명단\n\n| 번호 | 성명 | 소속 |\n|---|---|---|\n| 1 |  |  |\n| 2 |  |  |\n"));
    assert.deepEqual(roster.map((field) => [field.name, field.source, field.rows]), [
      ["성명", "column", 2],
      ["소속", "column", 2]
    ]);
  });

  it("fills a copy of the form and reports what did not fit", async () => {
    const form = await hwpx("# 참가 신청서\n\n| 성명 |  |\n|---|---|\n| 생년월일 |  |\n| 연락처 |  |\n");
    const filled = await fillFormHwpx(form, { 성명: "홍길동", 연락처: "010-1234-5678", 없는칸: "x" });
    assert.deepEqual(filled.filled, ["성명", "연락처"]);
    assert.deepEqual(filled.unmatched, ["없는칸"]);
    assert.deepEqual(filled.overflow, []);
    const back = await markdownOf(filled.data);
    assert.ok(back.includes("| 성명 | 홍길동 |"));
    assert.ok(back.includes("| 연락처 | 010-1234-5678 |"));

    const roster = await hwpx("# 명단\n\n| 번호 | 성명 | 소속 |\n|---|---|---|\n| 1 |  |  |\n| 2 |  |  |\n");
    const rows = await fillFormHwpx(roster, { 성명: ["가", "나", "다"], 소속: ["기획과"] });
    assert.deepEqual(rows.overflow, [{ name: "성명", filled: 2, total: 3 }]);
    const rowsBack = await markdownOf(rows.data);
    assert.ok(rowsBack.includes("| 1 | 가 | 기획과 |"));
    assert.ok(rowsBack.includes("| 2 | 나 |  |"));
  });

  it("fills the built-in draft letter's click-here fields", async () => {
    const filled = await fillFormHwpx(builtinFormBytes("gian"), { 행정기관명: "한빛시", 제목: "교육 과정 운영 안내" });
    assert.deepEqual(filled.filled.sort(), ["제목", "행정기관명"]);
    const back = await markdownOf(filled.data);
    assert.ok(back.includes("한빛시"));
    assert.ok(back.includes("교육 과정 운영 안내"));
  });

  it("saves the same bytes for the same values", async () => {
    const values = { 행정기관명: "한빛시" };
    const first = await fillFormHwpx(builtinFormBytes("gian"), values);
    const second = await fillFormHwpx(builtinFormBytes("gian"), values);
    assert.ok(Buffer.from(first.data).equals(Buffer.from(second.data)));
  });

  it("collects note properties as values", () => {
    assert.deepEqual(
      collectFormValues({
        성명: "홍길동",
        나이: 30,
        빈칸: "  ",
        명단: ["가", "", 3, null],
        tags: ["서식"],
        [FORM_LINK_KEY]: "[[a.hwpx]]",
        [FORM_HASH_KEY]: "abc",
        position: { start: 0 }
      }),
      { 성명: "홍길동", 나이: "30", 명단: ["가", "3"] }
    );
    assert.deepEqual(collectFormValues(null), {});
  });

  const fields: FormFieldSpec[] = [
    { name: "성명", type: "text", source: "label", value: "", required: true },
    { name: "주민등록번호", type: "idnum", source: "label", value: "" },
    { name: "금액", type: "amount", source: "column", value: "", rows: 2, rowLabels: ["인건비", "운영비"] }
  ];

  it("keeps existing values when it makes or refreshes properties", () => {
    const fresh = formNoteProperties(fields, "[[서식/신청서.hwpx]]", "hash-1");
    assert.deepEqual(fresh.properties, {
      성명: "",
      주민등록번호: "",
      금액: [],
      [FORM_LINK_KEY]: "[[서식/신청서.hwpx]]",
      [FORM_HASH_KEY]: "hash-1"
    });
    const refreshed = formNoteProperties(fields, "[[서식/신청서.hwpx]]", "hash-2", { 성명: "홍길동", 주민등록번호: "" });
    assert.deepEqual(refreshed.added, ["금액"]);
    assert.equal("성명" in refreshed.properties, false);
    assert.equal(refreshed.properties[FORM_HASH_KEY], "hash-2");
  });

  it("explains each field and warns about personal data", () => {
    const korean = formNoteBody(fields, "신청서", "ko");
    assert.ok(korean.startsWith("# 신청서 입력\n"));
    assert.ok(korean.includes("- **성명**: 필수"));
    assert.ok(korean.includes("- **주민등록번호**: 주민등록번호"));
    assert.ok(korean.includes("- **금액**: 금액·수량 · 목록으로 적기 (빈 행 2개) · 행 순서: 인건비, 운영비"));
    assert.ok(korean.includes("> [!warning] 개인정보 주의"));

    const english = formNoteBody(fields.slice(2), "Application", "en");
    assert.ok(english.startsWith("# Application form\n"));
    assert.ok(english.includes("- **금액**: Amount or quantity · Write as a list (2 blank rows) · Row order: 인건비, 운영비"));
    assert.ok(!english.includes("[!warning]"));
    assert.ok(formNoteBody([], "빈 양식", "ko").includes("입력 칸을 찾지 못했습니다"));
  });

  it("embeds the standard draft letters and hashes forms stably", () => {
    for (const form of BUILTIN_FORMS) {
      assert.ok(isBuiltinFormId(form.id));
      const bytes = builtinFormBytes(form.id);
      assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
      assert.equal(formHash(bytes), formHash(builtinFormBytes(form.id)));
      assert.match(formHash(bytes), /^[0-9a-f]{64}$/u);
    }
    assert.equal(isBuiltinFormId("__proto__"), false);
    assert.equal(isBuiltinFormId("toString"), false);
  });
});
