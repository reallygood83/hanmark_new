/**
 * A Markdown table skeleton: a header row, the separator, and body rows whose cells
 * are numbered left to right. `rows` counts the header row, so `markdownTable(3, 3)`
 * is the 3-column, 2-body-row table the "insert table" command has always inserted.
 * The result starts and ends with a line break so it never joins the text around it.
 */
export const MARKDOWN_TABLE_MAX = 20;

export interface MarkdownTableLabels {
  header(index: number): string;
  cell(index: number): string;
}

function clamp(value: number): number {
  return Math.min(MARKDOWN_TABLE_MAX, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
}

export function markdownTable(rows: number, columns: number, labels: MarkdownTableLabels): string {
  const rowCount = clamp(rows);
  const columnCount = clamp(columns);
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  const numbers = Array.from({ length: columnCount }, (_value, index) => index + 1);
  const lines = [
    "",
    line(numbers.map((index) => labels.header(index))),
    `|${numbers.map(() => "--------").join("|")}|`
  ];
  for (let row = 1; row < rowCount; row += 1) {
    lines.push(line(numbers.map((index) => labels.cell((row - 1) * columnCount + index))));
  }
  lines.push("");
  return lines.join("\n");
}
