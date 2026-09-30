/**
 * Where things are in a Kordoc preview SVG, and the arithmetic of the preview's page
 * navigation, zoom, scroll anchors, and follow mode (R-028).
 *
 * The SVG stacks the pages vertically: each page is a `g[data-page]` moved down with
 * `transform="translate(0 Y)"`, and each paragraph is a `g[data-kordoc-type="paragraph"]`
 * (also inside table cells) whose `<text>` baselines are page-local. All positions here
 * are in SVG user units (pt) from the top of the canvas. Only `getAttribute`,
 * `getElementsByTagName`, and `textContent` are used, so the same code reads the live
 * DOM and xmldom in tests.
 */

export interface SvgElementLike {
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<SvgElementLike>;
  readonly textContent: string | null;
}

export interface PreviewPage {
  /** 1-based */
  page: number;
  top: number;
  height: number;
}

export interface PreviewParagraph {
  page: number;
  top: number;
  text: string;
  /** The text without white space, for matching headings. */
  key: string;
}

export interface PreviewIndex {
  width: number;
  height: number;
  pages: PreviewPage[];
  paragraphs: PreviewParagraph[];
}

/** A place in the preview that survives a redraw: a page and how far down it (0–1). */
export interface PreviewAnchor {
  page: number;
  ratio: number;
}

export interface NoteHeading {
  /** 0-based line in the editor. */
  line: number;
  level: number;
  text: string;
  key: string;
}

export interface AlignedHeading {
  line: number;
  top: number;
}

/** Zoom steps in percent; "fit" (the pane width) is the default and not a step. */
export const PREVIEW_ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200] as const;

export type PreviewZoom = (typeof PREVIEW_ZOOM_STEPS)[number];

export function isPreviewZoom(value: unknown): value is PreviewZoom {
  return typeof value === "number" && (PREVIEW_ZOOM_STEPS as readonly number[]).includes(value);
}

/** The next step from the shown scale (a step, or the fitted scale in percent). */
export function stepZoom(current: number, direction: 1 | -1): PreviewZoom {
  if (direction > 0) return PREVIEW_ZOOM_STEPS.find((step) => step > current + 0.5) ?? 200;
  for (let index = PREVIEW_ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
    const step = PREVIEW_ZOOM_STEPS[index];
    if (step < current - 0.5) return step;
  }
  return 50;
}

const SPACE = /[\s\u200b\u2060\ufeff]+/gu;

/** Text without white space, lower-cased: line breaks inside a paragraph drop spaces. */
export function compactText(text: string): string {
  return text.replace(SPACE, "").toLowerCase();
}

function translateY(transform: string | null): number {
  const match = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/u.exec(transform ?? "");
  const value = Number(match?.[2] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function indexKordocSvg(svg: SvgElementLike): PreviewIndex {
  const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/u).map(Number);
  const width = box.length === 4 && box[2] > 0 ? box[2] : 0;
  const height = box.length === 4 && box[3] > 0 ? box[3] : 0;
  const groups = svg.getElementsByTagName("g");

  const pages: PreviewPage[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const page = Number(group.getAttribute("data-page"));
    if (!(page > 0)) continue;
    const rect = group.getElementsByTagName("rect")[0];
    pages.push({ page, top: translateY(group.getAttribute("transform")), height: Number(rect?.getAttribute("height")) || 0 });
  }
  pages.sort((a, b) => a.top - b.top);
  pages.forEach((page, index) => {
    if (page.height > 0) return;
    page.height = Math.max(0, (pages[index + 1]?.top ?? height) - page.top);
  });
  const pageTops = new Map(pages.map((page) => [page.page, page.top]));

  const paragraphs: PreviewParagraph[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (group.getAttribute("data-kordoc-type") !== "paragraph") continue;
    const runs = group.getElementsByTagName("text");
    let text = "";
    let top = Number.POSITIVE_INFINITY;
    for (let run = 0; run < runs.length; run += 1) {
      const element = runs[run];
      text += element.textContent ?? "";
      const y = Number(element.getAttribute("y"));
      const size = Number(element.getAttribute("font-size")) || 10;
      if (Number.isFinite(y)) top = Math.min(top, y - size);
    }
    const key = compactText(text);
    if (!key || !Number.isFinite(top)) continue;
    const page = Number(group.getAttribute("data-kordoc-page")) || 1;
    paragraphs.push({ page, top: (pageTops.get(page) ?? 0) + top, text, key });
  }
  return { width, height, pages, paragraphs };
}

/** The page shown at canvas position `y` (1-based; 1 without pages). */
export function pageAt(index: Pick<PreviewIndex, "pages">, y: number): number {
  let current = index.pages[0]?.page ?? 1;
  for (const page of index.pages) {
    if (page.top > y + 1) break;
    current = page.page;
  }
  return current;
}

export function anchorAt(index: Pick<PreviewIndex, "pages" | "height">, y: number): PreviewAnchor {
  const page = index.pages.find((item) => item.page === pageAt(index, y));
  if (!page || page.height <= 0) return { page: 0, ratio: index.height > 0 ? Math.max(0, y / index.height) : 0 };
  return { page: page.page, ratio: Math.min(1.1, Math.max(0, (y - page.top) / page.height)) };
}

/** Where an anchor is in a (new) render; past the end when the page no longer exists. */
export function offsetFor(index: Pick<PreviewIndex, "pages" | "height">, anchor: PreviewAnchor): number {
  if (anchor.page === 0 || !index.pages.length) return anchor.ratio * index.height;
  const page = index.pages.find((item) => item.page === anchor.page);
  if (page) return page.top + anchor.ratio * page.height;
  const last = index.pages[index.pages.length - 1];
  return last.top + last.height;
}

/** Removes Markdown that never reaches the document, so a heading reads like its output. */
export function headingKey(text: string): string {
  return compactText(
    text
      .replace(/\s\^[A-Za-z0-9-]+$/u, "")
      .replace(/!\[\[[^\]]*\]\]/gu, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/gu, "$1")
      .replace(/\[\[([^\]]*)\]\]/gu, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[\^[^\]]*\]/gu, "")
      .replace(/<[^>]+>/gu, "")
      .replace(/__(.+?)__/gu, "$1")
      .replace(/\*\*|==|~~|[*`$]/gu, "")
  );
}

/**
 * The note's headings with their editor lines, skipping front matter, code and math
 * blocks, and comments (none of them reach the document).
 */
export function noteHeadings(markdown: string): NoteHeading[] {
  const lines = markdown.split(/\r?\n/u);
  const headings: NoteHeading[] = [];
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0) start = end + 1;
  }
  let fence: RegExp | null = null;
  let math = false;
  let comment = false;
  let html = false;
  for (let line = start; line < lines.length; line += 1) {
    const text = lines[line];
    const trimmed = text.trim();
    if (fence) {
      if (fence.test(text)) fence = null;
      continue;
    }
    if (math) {
      if (trimmed.endsWith("$$")) math = false;
      continue;
    }
    if (html) {
      if (text.includes("-->")) html = false;
      continue;
    }
    const marks = text.split("%%").length - 1;
    if (comment) {
      if (marks % 2 === 1) comment = false;
      continue;
    }
    if (marks % 2 === 1) {
      comment = true;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/u.exec(text);
    if (open) {
      fence = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`, "u");
      continue;
    }
    if (trimmed.startsWith("$$")) {
      if (!(trimmed.length >= 4 && trimmed.endsWith("$$"))) math = true;
      continue;
    }
    const opened = text.lastIndexOf("<!--");
    if (opened >= 0 && text.indexOf("-->", opened) < 0) {
      html = true;
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u.exec(text);
    if (!heading) continue;
    const title = heading[2].replace(/%%.*?%%/gu, "").replace(/<!--.*?-->/gu, "");
    headings.push({ line, level: heading[1].length, text: title, key: headingKey(title) });
  }
  return headings;
}

// i18n-data-begin: Korean numbering letters and bullets matched in the rendered document
const PREFIX_UNIT = String.raw`(?:\d{1,3}(?:\.\d{1,3})*|[a-zA-Z]|[ivxIVX]{1,4}|[\u2160-\u217f]{1,4}|[가나다라마바사아자차카타파하])`;
/** Numbering and bullets that official-document forms put before a heading. */
const NUMBERING_PREFIX = new RegExp(
  String.raw`^(?:[□■○●◦◎◆◇▪▫▶▷►•·∙※*ㅇ❍✓✔\-–—]|[\u2460-\u2473]|${PREFIX_UNIT}[.)．]|\(${PREFIX_UNIT}\)|제\d{1,3}[장절편관조항부])+$`,
  "u"
);
// i18n-data-end

function matchesHeading(paragraph: string, key: string): boolean {
  if (paragraph === key) return true;
  return (
    paragraph.length > key.length &&
    paragraph.endsWith(key) &&
    NUMBERING_PREFIX.test(paragraph.slice(0, paragraph.length - key.length))
  );
}

/**
 * Pairs the note's headings with the paragraphs that print them, matching from the end:
 * covers and tables of contents repeat headings before the body, and the body copy is
 * the one the cursor belongs to. Forms may number a heading ("Ⅰ. ", "1) ", "□ ") or
 * print it in a table cell. The result runs down the document.
 */
export function alignHeadings(
  headings: readonly NoteHeading[],
  paragraphs: readonly Pick<PreviewParagraph, "key" | "top">[]
): AlignedHeading[] {
  const matched: AlignedHeading[] = [];
  let limit = paragraphs.length;
  for (let heading = headings.length - 1; heading >= 0; heading -= 1) {
    const { key, line } = headings[heading];
    if (!key) continue;
    for (let paragraph = limit - 1; paragraph >= 0; paragraph -= 1) {
      if (!matchesHeading(paragraphs[paragraph].key, key)) continue;
      matched.push({ line, top: paragraphs[paragraph].top });
      limit = paragraph;
      break;
    }
  }
  matched.reverse();
  const aligned: AlignedHeading[] = [];
  for (const item of matched) {
    if (!aligned.length || item.top >= aligned[aligned.length - 1].top) aligned.push(item);
  }
  return aligned;
}

/**
 * The canvas position for an editor line: between the matched headings around it,
 * in proportion to the line (the start and the end of the canvas bound the ends).
 */
export function followTarget(
  line: number,
  aligned: readonly AlignedHeading[],
  lineCount: number,
  height: number
): number {
  let before: AlignedHeading = { line: 0, top: 0 };
  let after: AlignedHeading = { line: Math.max(1, lineCount), top: height };
  for (const item of aligned) {
    if (item.line > line) {
      after = item;
      break;
    }
    before = item;
  }
  const span = after.line - before.line;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (line - before.line) / span)) : 0;
  return before.top + (after.top - before.top) * ratio;
}
