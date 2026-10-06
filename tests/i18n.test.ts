import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  currentUiLocale,
  messageTable,
  resolveOutputLocale,
  resolveUiLocale,
  setUiLocale,
  t,
  tOut,
  type MessageKey
} from "../src/i18n";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import { adaptMarkdownForKordoc } from "../src/io/markdownAdapter";
import { normalizeHanmarkSettings } from "../src/legacy-port/settings";
import { renderStandaloneHtml } from "../src/legacy-port/htmlExport";

const placeholderNames = (text: string): string[] =>
  [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)].map((match) => match[1]).sort();

describe("interface language (2.7.0 W9)", () => {
  afterEach(() => setUiLocale("ko"));

  it("follows Obsidian's language unless the user pins one", () => {
    assert.equal(resolveUiLocale("auto", "ko"), "ko");
    assert.equal(resolveUiLocale("auto", "ko-KR"), "ko");
    assert.equal(resolveUiLocale("auto", "en"), "en");
    assert.equal(resolveUiLocale("auto", "ja"), "en");
    assert.equal(resolveUiLocale("auto", "kok"), "en");
    assert.equal(resolveUiLocale("auto", undefined), "en");
    assert.equal(resolveUiLocale("ko", "en"), "ko");
    assert.equal(resolveUiLocale("en", "ko"), "en");
    assert.equal(resolveUiLocale("fr", "ko"), "ko", "unknown preferences fall back to auto");
  });

  it("switches interface text at runtime and fills placeholders", () => {
    setUiLocale("en");
    assert.equal(currentUiLocale(), "en");
    assert.equal(t("common.cancel"), "Cancel");
    assert.equal(t("settings.hwpx.engineName", { version: "4.15.7" }), "HWPX engine · Kordoc 4.15.7");
    setUiLocale("ko");
    assert.equal(t("common.cancel"), "취소");
    assert.equal(t("settings.hwpx.engineName", { version: "4.15.7" }), "HWPX 엔진 · Kordoc 4.15.7");
  });

  it("selects English plural forms by count and keeps Korean unchanged", () => {
    setUiLocale("en");
    assert.equal(t("preview.quick.warnings", { count: 1 }), "1 conversion note");
    assert.equal(t("preview.quick.warnings", { count: 3 }), "3 conversion notes");
    setUiLocale("ko");
    assert.equal(t("preview.quick.warnings", { count: 3 }), "변환 안내 3건");
  });

  it("defines the same keys and placeholders in Korean and English", () => {
    const koKeys = Object.keys(ko).sort();
    assert.deepEqual(Object.keys(en).sort(), koKeys);
    for (const key of koKeys as MessageKey[]) {
      const english = messageTable("en")[key];
      const expected = placeholderNames(ko[key]);
      if (typeof english === "string") {
        assert.deepEqual(placeholderNames(english), expected, key);
        continue;
      }
      assert.deepEqual(placeholderNames(english.other), expected, key);
      // The singular form may spell out the number ("Show the next page").
      assert.deepEqual(
        placeholderNames(english.one).filter((name) => name !== "count"),
        expected.filter((name) => name !== "count"),
        key
      );
    }
  });
});

describe("document label language", () => {
  it("reads the document in auto mode so the result is the same on every computer", () => {
    assert.equal(resolveOutputLocale("auto", "보고서 본문"), "ko");
    assert.equal(resolveOutputLocale("auto", "Quarterly report"), "en");
    assert.equal(resolveOutputLocale("auto", ""), "en");
    assert.equal(resolveOutputLocale("ko", "Quarterly report"), "ko");
    assert.equal(resolveOutputLocale("en", "보고서"), "en");
    assert.equal(tOut("en", "output.embedPlaceholder", { name: "Child" }), "[Embed: Child]");
  });

  it("writes callout titles and embed placeholders in the document's language", () => {
    setUiLocale("en");
    try {
      const korean = adaptMarkdownForKordoc("> [!note]\n> 본문\n\n![[하위 노트]]\n");
      assert.match(korean.markdown, /\*\*참고\*\*/u);
      assert.match(korean.markdown, /\[임베드: 하위 노트\]/u);

      const english = adaptMarkdownForKordoc("> [!warning]\n> Body\n\n![[Child note]]\n");
      assert.match(english.markdown, /\*\*Warning\*\*/u);
      assert.match(english.markdown, /\[Embed: Child note\]/u);

      const pinned = adaptMarkdownForKordoc("> [!tip]\n> Body\n", { outputLanguage: "ko" });
      assert.match(pinned.markdown, /\*\*팁\*\*/u);
    } finally {
      setUiLocale("ko");
    }
  });

  it("keeps unknown callout kinds, including prototype names, as written", () => {
    const result = adaptMarkdownForKordoc("> [!constructor]\n> 본문\n");
    assert.match(result.markdown, /\*\*constructor\*\*/u);
  });

  it("sets the HTML lang attribute from the resolved document language", () => {
    const korean = renderStandaloneHtml("# 제목\n", { title: "제목" });
    assert.match(korean, /<html lang="ko">/u);
    const english = renderStandaloneHtml("# Title\n", { title: "Title", language: "en" });
    assert.match(english, /<html lang="en">/u);
    const classic = renderStandaloneHtml("# Title\n", { title: "Title", theme: "classic", language: "en" });
    assert.match(classic, /<html lang="en">/u);
  });
});

describe("settings v12", () => {
  it("adds language and preview-pause settings without touching existing values", () => {
    const migrated = normalizeHanmarkSettings({ settingsVersion: 11, htmlExportTheme: "classic" });
    assert.equal(migrated.settingsVersion, 13);
    assert.deepEqual(migrated.companyTemplateByNote, {});
    assert.equal(migrated.uiLanguage, "auto");
    assert.equal(migrated.outputLanguage, "auto");
    assert.equal(migrated.previewAutoPause, true);
    assert.equal(migrated.htmlExportTheme, "classic");

    const pinned = normalizeHanmarkSettings({ uiLanguage: "en", outputLanguage: "ko", previewAutoPause: false });
    assert.equal(pinned.uiLanguage, "en");
    assert.equal(pinned.outputLanguage, "ko");
    assert.equal(pinned.previewAutoPause, false);

    const invalid = normalizeHanmarkSettings({ uiLanguage: "fr", outputLanguage: 3, previewAutoPause: "no" });
    assert.equal(invalid.uiLanguage, "auto");
    assert.equal(invalid.outputLanguage, "auto");
    assert.equal(invalid.previewAutoPause, true);
    assert.deepEqual(normalizeHanmarkSettings(migrated), migrated, "normalization is idempotent");
  });
});
