import type { MissingFont } from "./fontResolver";
import { t, tKey, type MessageKey } from "../i18n";

export type FontSourceKind = "hancom" | "windows" | "free" | "institution" | "unknown";

export interface FontSource {
  kind: FontSourceKind;
  /** Where the font normally comes from, in plain words (interface language). */
  label: string;
  /** Official page, opened only when the user clicks it. */
  url?: string;
}

// Links checked on 2026-09-28 (HTTP 200). Keep this list short and official.
// i18n-data-begin: font family names matched by the table below
const HANCOM_DOWNLOAD = "https://www.hancom.com/cs_center/csDownload.do";
const FREE_SOURCES: ReadonlyArray<{ match: RegExp; label: MessageKey; url: string }> = [
  { match: /^(?:나눔|nanum)/i, label: "font.source.nanum", url: "https://hangeul.naver.com/font" },
  { match: /^(?:pretendard|프리텐다드)/i, label: "font.source.pretendard", url: "https://github.com/orioncactus/pretendard" },
  { match: /^noto ?sans ?kr$/i, label: "font.source.notoSans", url: "https://fonts.google.com/noto/specimen/Noto+Sans+KR" },
  { match: /^noto ?serif ?kr$/i, label: "font.source.notoSerif", url: "https://fonts.google.com/noto/specimen/Noto+Serif+KR" },
  { match: /^(?:본고딕|source ?han ?sans)/i, label: "font.source.sourceHanSans", url: "https://github.com/adobe-fonts/source-han-sans" },
  { match: /^(?:본명조|source ?han ?serif)/i, label: "font.source.sourceHanSerif", url: "https://github.com/adobe-fonts/source-han-serif" }
];
/** Fonts of an institution, handed out to its members (no public download page). */
const INSTITUTION_SOURCES: ReadonlyArray<{ match: RegExp; label: MessageKey }> = [
  { match: /^(?:한림(?:고딕|명조)체|hallym ?(?:gothic|mjo))/i, label: "font.source.hallym" }
];
const HANCOM_FONT = /^(?:hy|휴먼|한양|양재|태 |md|신명 |함초롬|한컴|문체부|hci )/i;
const WINDOWS_FONTS = new Set(
  ["맑은 고딕", "맑은고딕", "malgun gothic", "굴림", "굴림체", "돋움", "돋움체", "바탕", "바탕체", "궁서", "궁서체"].map(
    (name) => name.toLowerCase()
  )
);
// i18n-data-end

/** Where a font usually comes from (deterministic, offline table). */
export function fontSource(family: string): FontSource {
  const name = family.normalize("NFC").trim();
  const free = FREE_SOURCES.find((source) => source.match.test(name));
  if (free) return { kind: "free", label: tKey(free.label), url: free.url };
  const institution = INSTITUTION_SOURCES.find((source) => source.match.test(name));
  if (institution) return { kind: "institution", label: tKey(institution.label) };
  if (HANCOM_FONT.test(name)) {
    return { kind: "hancom", label: t("font.source.hancom"), url: HANCOM_DOWNLOAD };
  }
  if (WINDOWS_FONTS.has(name.toLowerCase())) {
    return { kind: "windows", label: t("font.source.windows") };
  }
  return { kind: "unknown", label: t("font.source.unknown") };
}

/** One line per missing font: preview fallback and where to get the font. */
export function fontGuideLines(missing: readonly MissingFont[]): string[] {
  return missing.map((item) => {
    const source = fontSource(item.family);
    const where = source.url ? `${source.label} ${source.url}` : source.label;
    return t("font.guide.line", { family: item.family, fallback: item.previewFallback, where });
  });
}
