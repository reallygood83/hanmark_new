/**
 * What the toolbar shows about the cursor (R-028): the heading level of the cursor
 * line and the inline marks the cursor sits inside, like a word processor's
 * pressed B / I / U buttons.
 */
export type InlineMark = "bold" | "italic" | "strikethrough" | "underline" | "highlight" | "code" | "math";

/** 1–6 for a Markdown heading line, 0 otherwise. */
export function headingLevelOf(line: string): number {
  const match = /^\s{0,3}(#{1,6})(?:\s|$)/u.exec(line);
  return match ? match[1].length : 0;
}

interface Span {
  start: number;
  end: number;
  open: number;
  close: number;
}

function spansOf(text: string, pattern: RegExp, open: (match: RegExpExecArray) => number, close: (match: RegExpExecArray) => number): Span[] {
  const spans: Span[] = [];
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (let match = global.exec(text); match; match = global.exec(text)) {
    spans.push({ start: match.index, end: match.index + match[0].length, open: open(match), close: close(match) });
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return spans;
}

function contains(span: Span, ch: number): boolean {
  return ch >= span.start + span.open && ch <= span.end - span.close;
}

/** Replaces the spans with the same number of placeholder characters. */
function mask(text: string, spans: readonly Span[], placeholder: string): string {
  let out = text;
  for (const span of spans) out = out.slice(0, span.start) + placeholder.repeat(span.end - span.start) + out.slice(span.end);
  return out;
}

const CODE = /(`+)(?!`)(.*?[^`])\1(?!`)/u;
const MATH = /(?<![\\$])\$(?=[^\s$])[^$\n]*?[^\s$\\]\$(?!\$)|(?<![\\$])\$[^\s$]\$(?!\$)/u;
const BOLD = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/u;
const STRIKE = /~~(?=\S)(.+?)(?<=\S)~~/u;
const HIGHLIGHT = /==(?=\S)(.+?)(?<=\S)==/u;
const UNDERLINE = /<u>(.*?)<\/u>/iu;
const ITALIC_STAR = /(?<![*\w\\])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![*\w])/u;
const ITALIC_UNDERSCORE = /(?<![_\w\\])_(?=[^\s_])([^_\n]*?[^\s_])?_(?![_\w])/u;

/** Inline marks around character position `ch` (0-based) of `line`. Code and math hide the rest. */
export function inlineMarksAt(line: string, ch: number): Set<InlineMark> {
  const marks = new Set<InlineMark>();
  const code = spansOf(line, CODE, (match) => match[1].length, (match) => match[1].length);
  if (code.some((span) => contains(span, ch))) return new Set<InlineMark>(["code"]);
  let text = mask(line, code, "\u0000");
  const math = spansOf(text, MATH, () => 1, () => 1);
  if (math.some((span) => contains(span, ch))) return new Set<InlineMark>(["math"]);
  text = mask(text, math, "\u0000");

  const bold = spansOf(text, BOLD, (match) => match[1].length, (match) => match[1].length);
  if (bold.some((span) => contains(span, ch))) marks.add("bold");
  if (spansOf(text, STRIKE, () => 2, () => 2).some((span) => contains(span, ch))) marks.add("strikethrough");
  if (spansOf(text, HIGHLIGHT, () => 2, () => 2).some((span) => contains(span, ch))) marks.add("highlight");
  if (spansOf(text, UNDERLINE, () => 3, () => 4).some((span) => contains(span, ch))) marks.add("underline");

  // Bold markers are hidden before looking for single-character emphasis.
  let emphasis = text;
  for (const span of bold) {
    emphasis = mask(emphasis, [{ start: span.start, end: span.start + span.open, open: 0, close: 0 }], "\u0001");
    emphasis = mask(emphasis, [{ start: span.end - span.close, end: span.end, open: 0, close: 0 }], "\u0001");
  }
  const italic = [...spansOf(emphasis, ITALIC_STAR, () => 1, () => 1), ...spansOf(emphasis, ITALIC_UNDERSCORE, () => 1, () => 1)];
  if (italic.some((span) => contains(span, ch))) marks.add("italic");
  return marks;
}

export interface GridSize {
  rows: number;
  cols: number;
}

/** The table-size grid after an arrow key; null for keys the grid does not handle. */
export function moveGridSelection(size: GridSize, key: string, max = 8): GridSize | null {
  const clamp = (value: number): number => Math.min(max, Math.max(1, value));
  switch (key) {
    case "ArrowRight":
      return { rows: size.rows, cols: clamp(size.cols + 1) };
    case "ArrowLeft":
      return { rows: size.rows, cols: clamp(size.cols - 1) };
    case "ArrowDown":
      return { rows: clamp(size.rows + 1), cols: size.cols };
    case "ArrowUp":
      return { rows: clamp(size.rows - 1), cols: size.cols };
    case "Home":
      return { rows: 1, cols: 1 };
    case "End":
      return { rows: max, cols: max };
    default:
      return null;
  }
}
