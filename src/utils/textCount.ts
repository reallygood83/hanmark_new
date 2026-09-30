import { extractEditableBody } from "../io/frontmatter";

/**
 * Korean character counts for the status bar (R-028): characters with and without
 * spaces, and 200-character manuscript sheets (원고지), counted on the text a reader
 * sees — Markdown marks, link targets, embeds, comments, and the frontmatter are left out.
 */
export interface TextCount {
  withSpaces: number;
  withoutSpaces: number;
  /** 200-character manuscript sheets, one decimal. */
  manuscriptSheets: number;
}

export const MANUSCRIPT_SHEET = 200;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/u;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/u;
const MATH_FENCE = /^\s*\$\$\s*$/u;
/** Marks, joiners, variation selectors, and characters outside the basic plane need grapheme segmentation. */
const COMPLEX = /[\u0300-\u036f]|[\u1100-\u11ff]|\u200c|\u200d|\u20e3|[\ufe00-\ufe0f]|[\u{10000}-\u{10ffff}]/u;

function visibleInline(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/gu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/gu, (_match, target: string, alias?: string) => alias ?? target)
    .replace(/\[\^[^\]]+\]/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/gu, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/gu, "")
    .replace(/`+([^`]*)`+/gu, "$1")
    .replace(/\$([^$\n]+?)\$/gu, "$1")
    .replace(/(\*\*|__|~~|==)(.+?)\1/gu, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?!\w)/gu, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_]+?)_(?!\w)/gu, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~$=])/gu, "$1");
}

function visibleLine(line: string): string {
  if ((TABLE_SEPARATOR.test(line) && line.includes("|")) || RULE.test(line) || MATH_FENCE.test(line)) return "";
  let text = line;
  while (/^\s*>/u.test(text)) text = text.replace(/^\s*>\s?/u, "");
  text = text
    .replace(/^\[![\w-]+\][+-]?\s*/u, "")
    .replace(/^\s{0,3}#{1,6}\s+/u, "")
    .replace(/\s+#+\s*$/u, "")
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+/u, "")
    .replace(/^\[[ xX]\]\s+/u, "")
    .replace(/^\[\^[^\]]+\]:\s*/u, "");
  if (/^\s*\|.*\|\s*$/u.test(text)) {
    text = text
      .trim()
      .slice(1, -1)
      .split(/(?<!\\)\|/u)
      .map((cell) => cell.trim())
      .join(" ");
  }
  return visibleInline(text);
}

/** The text a reader sees in a note (see the module comment). */
export function visibleMarkdownText(markdown: string, options: { frontmatter?: boolean } = {}): string {
  const body = options.frontmatter === false ? markdown : extractEditableBody(markdown);
  const text = body.replace(/\r\n?/gu, "\n").replace(/<!--[\s\S]*?-->/gu, "").replace(/%%[\s\S]*?%%/gu, "");
  const lines: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const opening = FENCE.exec(line);
    if (fence) {
      if (opening && opening[1][0] === fence[0] && opening[1].length >= fence.length && !line.trim().slice(opening[1].length).trim()) {
        fence = null;
      } else {
        lines.push(line);
      }
      continue;
    }
    if (opening) {
      fence = opening[1];
      continue;
    }
    lines.push(visibleLine(line));
  }
  return lines.join("\n");
}

interface GraphemeSegmenter {
  segment(input: string): Iterable<unknown>;
}

type SegmenterConstructor = new (locale: string, options: { granularity: "grapheme" }) => GraphemeSegmenter;

function graphemeCount(text: string): number {
  if (!text) return 0;
  if (!COMPLEX.test(text)) return text.length;
  const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
  if (typeof Segmenter !== "function") return Array.from(text).length;
  let count = 0;
  for (const segment of new Segmenter("ko", { granularity: "grapheme" }).segment(text)) {
    if (segment) count += 1;
  }
  return count;
}

/** Characters with spaces (line breaks excluded), without any whitespace, and manuscript sheets. */
export function countText(text: string): TextCount {
  const withSpaces = graphemeCount(text.replace(/[\r\n]+/gu, ""));
  const withoutSpaces = graphemeCount(text.replace(/\s+/gu, ""));
  return { withSpaces, withoutSpaces, manuscriptSheets: Math.round((withSpaces / MANUSCRIPT_SHEET) * 10) / 10 };
}
