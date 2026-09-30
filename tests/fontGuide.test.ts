import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fontGuideLines, fontSource } from "../src/io/fontGuide";

describe("font guide", () => {
  it("classifies where common Korean fonts come from", () => {
    assert.equal(fontSource("HY견고딕").kind, "hancom");
    assert.equal(fontSource("휴먼명조").kind, "hancom");
    assert.equal(fontSource("함초롬바탕").kind, "hancom");
    assert.equal(fontSource("맑은 고딕").kind, "windows");
    assert.equal(fontSource("나눔고딕").kind, "free");
    assert.equal(fontSource("Noto Sans KR").url, "https://fonts.google.com/noto/specimen/Noto+Sans+KR");
    assert.equal(fontSource("Pretendard").kind, "free");
    assert.equal(fontSource("한림고딕체 Regular").kind, "institution");
    assert.equal(fontSource("Hallym Mjo Regular").kind, "institution");
    assert.equal(fontSource("한림고딕체 Regular").url, undefined);
    assert.equal(fontSource("우리학교체").kind, "unknown");
    assert.equal(fontSource("우리학교체").url, undefined);
  });

  it("explains the preview fallback and where to get each missing font", () => {
    const [line] = fontGuideLines([{ family: "HY견고딕", roles: ["h2"], previewFallback: "맑은 고딕" }]);
    assert.match(line, /^HY견고딕: 이 PC에 없어 미리보기는 맑은 고딕\(으\)로 표시합니다\. 받는 곳: 한컴오피스/);
    assert.match(line, /https:\/\/www\.hancom\.com\/cs_center\/csDownload\.do$/);
  });
});

describe("preview font fallbacks", () => {
  it("adds the machine fallback only to the preview font list", async () => {
    const { addPreviewFontAliases } = await import("../src/io/kordocEngine");
    const svg = `<text font-family="'휴먼명조','serif'">가</text><text font-family="'HY견고딕'">나</text>`;
    const previewed = addPreviewFontAliases(svg, { "휴먼명조": "바탕" });
    assert.match(previewed, /font-family="'휴먼명조','Human Myeongjo','HumanMyungjo','바탕','serif'"/);
    assert.match(previewed, /font-family="'HY견고딕','HYGothic-Extra'"/);
  });
});
