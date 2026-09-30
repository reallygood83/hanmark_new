import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEditorialDocument, type EditorialBlock } from "../src/io/editorialDocument";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

describe("HTML and PDF footnotes (2.7.0 W10)", () => {
  it("turns references into superscript numbers and definitions into an end list", () => {
    const document = parseEditorialDocument(
      "# 제목\n\n본문 첫째[^a] 둘째[^b].\n\n[^a]: 첫 각주입니다.\n[^b]: 둘째 각주입니다.\n    이어지는 줄입니다.\n",
      "파일"
    );
    const [paragraph, rule, list] = document.blocks;
    assert.equal(paragraph.type, "paragraph");
    const superscripts = paragraph.type === "paragraph"
      ? paragraph.inlines.filter((inline) => inline.type === "styled" && inline.style === "superscript")
      : [];
    assert.deepEqual(
      superscripts.map((inline) => (inline.type === "styled" && inline.children[0]?.type === "text" ? inline.children[0].value : "")),
      ["1", "2"]
    );
    assert.equal(rule.type, "thematic-break");
    assert.equal(list.type, "list");
    const items = (list as Extract<EditorialBlock, { type: "list" }>).items;
    assert.equal(items.length, 2);
    const texts = items.map((item) =>
      item.blocks
        .map((block) => (block.type === "paragraph" ? block.inlines.map((inline) => (inline.type === "text" ? inline.value : "")).join("") : ""))
        .join(" ")
    );
    assert.equal(texts[0], "첫 각주입니다.");
    assert.match(texts[1], /둘째 각주입니다\.\s*이어지는 줄입니다\./u);
    assert.equal(document.blocks.length, 3, "definitions leave the body");
  });

  it("renders the notes in the standalone HTML", () => {
    const html = renderStandaloneHtml("본문[^1]\n\n[^1]: 각주 내용\n", { title: "각주" });
    assert.match(html, /<sup[^>]*>1<\/sup>/u);
    assert.match(html, /<ol[^>]*>[\s\S]*각주 내용[\s\S]*<\/ol>/u);
    assert.doesNotMatch(html, /\[\^1\]/u);
  });

  it("leaves documents without footnote syntax unchanged", () => {
    const markdown = "# 제목\n\n문단 하나.\n\n- 목록\n\n| 가 | 나 |\n|---|---|\n| 1 | 2 |\n\n[링크](https://example.com)\n";
    const document = parseEditorialDocument(markdown, "파일");
    assert.equal(document.blocks.some((block) => block.type === "thematic-break"), false);
    assert.equal(JSON.stringify(document).includes("superscript"), false);
  });

  it("keeps an unmatched reference as literal text", () => {
    const document = parseEditorialDocument("정의 없는 참조[^x]\n", "파일");
    const [paragraph] = document.blocks;
    assert.equal(paragraph.type, "paragraph");
    assert.match(
      paragraph.type === "paragraph" ? paragraph.inlines.map((inline) => (inline.type === "text" ? inline.value : "")).join("") : "",
      /\[\^x\]/u
    );
  });
});
