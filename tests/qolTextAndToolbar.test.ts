import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countText, visibleMarkdownText } from "../src/utils/textCount";
import { chooseHiddenGroups, TOOLBAR_GROUPS } from "../src/ui/toolbarLayout";
import { headingLevelOf, inlineMarksAt, moveGridSelection } from "../src/ui/toolbarState";

describe("Korean character counts (R-028)", () => {
  it("counts the text a reader sees", () => {
    const note = [
      "---",
      "title: 제목",
      "---",
      "# 제목 <!-- 메모 -->",
      "",
      "- **굵은** 글과 [링크](https://example.com) 그리고 [[노트|별칭]]",
      "> [!note] 참고",
      "> 인용 %%숨김%%",
      "![[그림.png]] ![대체](a.png)",
      "각주[^1]",
      "",
      "| 가 | 나 |",
      "|---|---|",
      "| 다 | 라 |",
      "",
      "```",
      "코드 `그대로`",
      "```",
      "---",
      "[^1]: 설명"
    ].join("\n");
    assert.equal(
      visibleMarkdownText(note),
      ["제목 ", "", "굵은 글과 링크 그리고 별칭", "참고", "인용 ", " ", "각주", "", "가 나", "", "다 라", "", "코드 `그대로`", "", "설명"].join("\n")
    );
  });

  it("counts with and without spaces, graphemes, and manuscript sheets", () => {
    assert.deepEqual(countText("가나 다\n라"), { withSpaces: 5, withoutSpaces: 4, manuscriptSheets: 0 });
    assert.equal(countText("👍🏽 가").withSpaces, 3, "an emoji with a skin tone is one character");
    assert.equal(countText("각").withoutSpaces, 1, "conjoining jamo form one syllable");
    assert.equal(countText("가".repeat(1234)).manuscriptSheets, 6.2);
  });
});

describe("one-line toolbar rows (R-028)", () => {
  it("hides the lowest-priority groups first and never the pinned ones", () => {
    const groups = [
      { id: "files", width: 100, priority: 90 },
      { id: "exports", width: 200, priority: 100 },
      { id: "history", width: 60, priority: 70 },
      { id: "templates", width: 120, priority: 40 }
    ];
    assert.deepEqual([...chooseHiddenGroups(groups, 480, 30)], []);
    assert.deepEqual([...chooseHiddenGroups(groups, 470, 30)], ["templates"]);
    assert.deepEqual([...chooseHiddenGroups(groups, 330, 30)], ["templates", "history"]);
    assert.deepEqual([...chooseHiddenGroups(groups, 300, 30)], ["templates", "history", "files"]);
    assert.deepEqual([...chooseHiddenGroups(groups, 10, 30)], ["templates", "history", "files"]);
    assert.ok(TOOLBAR_GROUPS.some((group) => group.row === "format" && group.priority === 100));
  });
});

describe("toolbar state at the cursor (R-028)", () => {
  it("reads the heading level of the cursor line", () => {
    assert.equal(headingLevelOf("## 제목"), 2);
    assert.equal(headingLevelOf("   ###### 끝"), 6);
    assert.equal(headingLevelOf("####### 아님"), 0);
    assert.equal(headingLevelOf("#태그"), 0);
    assert.equal(headingLevelOf("본문"), 0);
  });

  it("finds the inline marks around the cursor", () => {
    const at = (line: string, marker = "|"): string[] => {
      const ch = line.indexOf(marker);
      return [...inlineMarksAt(line.replace(marker, ""), ch)].sort();
    };
    assert.deepEqual(at("앞 **굵|게** 뒤"), ["bold"]);
    assert.deepEqual(at("앞 |**굵게** 뒤"), []);
    assert.deepEqual(at("***굵|은 기울임***"), ["bold", "italic"]);
    assert.deepEqual(at("*기울|임*과 _밑_"), ["italic"]);
    assert.deepEqual(at("~~취|소~~ ==형|광=="), ["strikethrough"]);
    assert.deepEqual(at("<u>밑|줄</u>"), ["underline"]);
    assert.deepEqual(at("`**코|드**`"), ["code"]);
    assert.deepEqual(at("값 $x^|2$ 원"), ["math"]);
    assert.deepEqual(at("가격 $5와 $|6"), []);
    assert.deepEqual(at("snake_ca|se_name"), []);
  });

  it("moves the table-size selection with arrow keys within bounds", () => {
    assert.deepEqual(moveGridSelection({ rows: 3, cols: 3 }, "ArrowRight"), { rows: 3, cols: 4 });
    assert.deepEqual(moveGridSelection({ rows: 1, cols: 1 }, "ArrowUp"), { rows: 1, cols: 1 });
    assert.deepEqual(moveGridSelection({ rows: 8, cols: 8 }, "ArrowDown"), { rows: 8, cols: 8 });
    assert.equal(moveGridSelection({ rows: 2, cols: 2 }, "Enter"), null);
  });
});
