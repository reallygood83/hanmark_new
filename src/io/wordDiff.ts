/**
 * Word-level difference for the old–new comparison table (2.7.0 W7).
 *
 * Deterministic LCS over tokens (letter/digit runs, whitespace runs, and single
 * punctuation marks), so Korean words and particles compare naturally. A changed
 * token marks its whole space-separated word (어절): emphasis then always starts
 * and ends at a word edge, which every Markdown renderer accepts, and it matches
 * how comparison tables underline changes. Changed words are emphasized with bold
 * (survives HWPX and DOCX) or ==highlight==.
 *
 * The output is Markdown: characters of the documents' own text that Markdown or
 * Obsidian would interpret are escaped, and emphasis never crosses a line break.
 */
export type ChangeMark = "bold" | "highlight";

/** Above this token product the whole text is marked instead (memory bound). */
const MAX_CELLS = 1_500_000;

interface Token {
  text: string;
  changed: boolean;
}

export function tokenizeWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu) ?? [];
}

/**
 * Escapes what would turn literal document text into Markdown syntax: emphasis,
 * code, table pipes, math, HTML tags, wikilinks and footnotes, highlights,
 * comments, and tags. Follows Kordoc's own escaping so imported notes and
 * comparison notes read alike.
 */
export function escapeMarkdownText(text: string): string {
  return text
    .replace(/\\/gu, "\\\\")
    .replace(/[~*_`|$]/gu, "\\$&")
    .replace(/<(?=[A-Za-z/!?])/gu, "\\<")
    .replace(/\[(?=[[^])/gu, "\\[")
    .replace(/=(?==)/gu, "\\=")
    .replace(/%(?=%)/gu, "\\%")
    .replace(/(^|\s)#(?=[^\s#])/gu, "$1\\#");
}

function isSpace(text: string): boolean {
  return /^\s+$/u.test(text);
}

function wrap(run: string, mark: ChangeMark): string {
  const leading = /^\s*/u.exec(run)?.[0] ?? "";
  const trailing = /\s*$/u.exec(run)?.[0] ?? "";
  const core = run.slice(leading.length, run.length - trailing.length);
  if (!core) return run;
  const marker = mark === "bold" ? "**" : "==";
  return `${leading}${marker}${escapeMarkdownText(core)}${marker}${trailing}`;
}

/** Emphasizes every non-empty line of `text` on its own. */
function emphasizeLines(text: string, mark: ChangeMark): string {
  return text
    .split("\n")
    .map((line) => (line.trim() ? wrap(line, mark) : line))
    .join("\n");
}

/** A word with any changed token is changed as a whole. */
function widenToWords(tokens: Token[]): void {
  let start = 0;
  for (let index = 0; index <= tokens.length; index += 1) {
    if (index < tokens.length && !isSpace(tokens[index].text)) continue;
    if (tokens.slice(start, index).some((token) => token.changed)) {
      for (let word = start; word < index; word += 1) tokens[word].changed = true;
    }
    start = index + 1;
  }
}

function render(tokens: readonly Token[], mark: ChangeMark): string {
  let output = "";
  let run = "";
  let runChanged = false;
  const flush = (): void => {
    if (!run) return;
    output += runChanged ? wrap(run, mark) : escapeMarkdownText(run);
    run = "";
  };
  for (const token of tokens) {
    const space = isSpace(token.text);
    if (space && token.text.includes("\n")) {
      // A line break ends emphasis, so each line of a table cell stays balanced.
      flush();
      runChanged = false;
      output += token.text;
      continue;
    }
    // Spaces join the surrounding run so "새 규정" stays one emphasized phrase.
    const changed: boolean = space ? runChanged : token.changed;
    if (changed !== runChanged) {
      flush();
      runChanged = changed;
    }
    run += token.text;
  }
  flush();
  return output;
}

/**
 * Marks what `before` lost and what `after` gained, as Markdown. Identical texts
 * come back escaped but unmarked.
 */
export function diffWords(before: string, after: string, mark: ChangeMark = "bold"): { before: string; after: string } {
  if (before === after) return { before: escapeMarkdownText(before), after: escapeMarkdownText(after) };
  const a = tokenizeWords(before);
  const b = tokenizeWords(after);
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) {
    return { before: emphasizeLines(before, mark), after: emphasizeLines(after, mark) };
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const left: Token[] = [];
  const right: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      left.push({ text: a[i], changed: false });
      right.push({ text: b[j], changed: false });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      left.push({ text: a[i], changed: true });
      i += 1;
    } else {
      right.push({ text: b[j], changed: true });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) left.push({ text: a[i], changed: true });
  for (; j < b.length; j += 1) right.push({ text: b[j], changed: true });
  widenToWords(left);
  widenToWords(right);
  return { before: render(left, mark), after: render(right, mark) };
}
