import type { BlockDiff, DiffResult, IRBlock } from "kordoc";
import { tOut, type Locale } from "../i18n";
import { diffWords, escapeMarkdownText, type ChangeMark } from "./wordDiff";

/**
 * Old–new comparison table note (신구대조표, 2.7.0 W7). The note is ordinary
 * Markdown: a summary, a | change | current | revised | table, and cell-level table
 * changes. Exporting it to HWPX or DOCX gives a submission-ready comparison table.
 */
export interface CompareNoteOptions {
  beforeName: string;
  afterName: string;
  /** Also list unchanged blocks (default false). */
  includeUnchanged?: boolean;
  mark?: ChangeMark;
  /** Language of the labels written into the note. */
  locale: Locale;
}

/** Kordoc keeps a literal "$" of Hangul documents as "\\$" in block text; the note escapes it again. */
function plainText(text: string | undefined): string {
  return (text ?? "").replace(/\\\$/gu, "$").trim();
}

function blockText(block: IRBlock | undefined): string {
  if (!block) return "";
  if (block.type === "list") {
    const items = (block.children ?? []).map((child) => blockText(child)).filter(Boolean);
    return items.length ? items.map((item) => `- ${item}`).join("\n") : plainText(block.text);
  }
  return plainText(block.text);
}

/** One table cell from Markdown whose emphasis never crosses a line (see wordDiff). */
function tableCell(markdown: string): string {
  return markdown
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("<br>");
}

/** Literal document text on one Markdown line. */
function inlineText(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => escapeMarkdownText(plainText(line)))
    .filter(Boolean)
    .join(" / ");
}

function emphasizeWhole(text: string, mark: ChangeMark): string {
  if (!text.trim()) return text;
  return diffWords("", text, mark).after;
}

function tableShape(block: IRBlock | undefined): { rows: number; cols: number } {
  return { rows: block?.table?.rows ?? 0, cols: block?.table?.cols ?? 0 };
}

export function renderCompareNote(result: DiffResult, options: CompareNoteOptions): string {
  const { locale } = options;
  const mark = options.mark ?? "bold";
  const lines: string[] = [];
  lines.push(`# ${tOut(locale, "output.compare.title", {
    before: inlineText(options.beforeName),
    after: inlineText(options.afterName)
  })}`, "");
  lines.push(`> [!info] ${tOut(locale, "output.compare.summaryTitle")}`);
  lines.push(`> ${tOut(locale, "output.compare.summary", {
    added: result.stats.added,
    removed: result.stats.removed,
    modified: result.stats.modified,
    unchanged: result.stats.unchanged
  })}`, "");

  const rows: string[] = [];
  const cellChanges: string[] = [];
  let tableIndex = 0;
  const kindLabel = (diff: BlockDiff): string =>
    diff.type === "added"
      ? tOut(locale, "output.compare.added")
      : diff.type === "removed"
        ? tOut(locale, "output.compare.removed")
        : diff.type === "modified"
          ? tOut(locale, "output.compare.modified")
          : tOut(locale, "output.compare.unchanged");

  for (const diff of result.diffs) {
    const isTable = diff.before?.type === "table" || diff.after?.type === "table";
    if (isTable) tableIndex += 1;
    if (diff.type === "unchanged" && !options.includeUnchanged) continue;

    let before: string;
    let after: string;
    if (isTable) {
      const describe = (block: IRBlock | undefined): string =>
        block ? tOut(locale, "output.compare.tableBlock", { table: tableIndex, ...tableShape(block) }) : "";
      before = describe(diff.before);
      after = describe(diff.after);
      for (const [rowIndex, row] of (diff.cellDiffs ?? []).entries()) {
        for (const [colIndex, cell] of row.entries()) {
          if (cell.type === "unchanged") continue;
          cellChanges.push(`- ${tOut(locale, "output.compare.cellChange", {
            table: tableIndex,
            row: rowIndex + 1,
            col: colIndex + 1,
            before: inlineText(cell.before ?? "") || tOut(locale, "output.compare.empty"),
            after: inlineText(cell.after ?? "") || tOut(locale, "output.compare.empty")
          })}`);
        }
      }
    } else if (diff.type === "modified") {
      const marked = diffWords(blockText(diff.before), blockText(diff.after), mark);
      before = marked.before;
      after = marked.after;
    } else if (diff.type === "added") {
      before = "";
      after = emphasizeWhole(blockText(diff.after), mark);
    } else if (diff.type === "removed") {
      before = emphasizeWhole(blockText(diff.before), mark);
      after = "";
    } else {
      before = escapeMarkdownText(blockText(diff.before));
      after = escapeMarkdownText(blockText(diff.after));
    }
    rows.push(`| ${kindLabel(diff)} | ${tableCell(before)} | ${tableCell(after)} |`);
  }

  if (!rows.length && !cellChanges.length) {
    lines.push(tOut(locale, "output.compare.noChanges"), "");
    return lines.join("\n");
  }
  if (rows.length) {
    lines.push(
      `| ${tOut(locale, "output.compare.kind")} | ${tOut(locale, "output.compare.current")} | ${tOut(locale, "output.compare.revised")} |`,
      "|---|---|---|",
      ...rows,
      ""
    );
  }
  if (cellChanges.length) {
    lines.push(`## ${tOut(locale, "output.compare.tableChanges")}`, "", ...cellChanges, "");
  }
  return lines.join("\n");
}

/** A note or file name without characters Obsidian or the file system rejects. */
export function safeBaseName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/gu, "_").replace(/\s+/gu, " ").trim();
}

/** A file name for the comparison note. */
export function compareNoteBaseName(beforeName: string, afterName: string, locale: Locale): string {
  const stem = (name: string): string => name.replace(/\.[^.]+$/u, "");
  return safeBaseName(tOut(locale, "output.compare.fileName", { before: stem(beforeName), after: stem(afterName) }));
}
