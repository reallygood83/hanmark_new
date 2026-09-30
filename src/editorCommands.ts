import { type App, type Editor, Notice, Plugin } from "obsidian";
import { t } from "./i18n";
import { promptText } from "./ui/dialogs";
import { markdownTable } from "./utils/markdownTable";

type TextTransform = (value: string) => string;

/** Numbered header and cell placeholders of an inserted table, in the interface language. */
export function tableLabels(): { header(index: number): string; cell(index: number): string } {
  return {
    header: (index) => t("editor.insert.tableHeader", { number: index }),
    cell: (index) => t("editor.insert.tableCell", { number: index })
  };
}

/** Asks through an Obsidian modal; Electron has no working browser prompt dialog. */
function promptUser(
  app: App,
  message: string,
  defaultValue: string,
  allowEmpty = false
): Promise<string | null> {
  return promptText(app, { title: t("editor.prompt.title"), label: message, value: defaultValue, allowEmpty });
}

/**
 * The legacy text tools intentionally operate on the current selection, or on
 * only the current line when there is no selection.
 */
function transformSelectionOrCurrentLine(editor: Editor, transform: TextTransform): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    editor.replaceSelection(transform(selected));
    return;
  }

  const cursor = editor.getCursor();
  editor.setLine(cursor.line, transform(editor.getLine(cursor.line)));
}

/**
 * Only the two document-wide legacy tools use the whole document when there is
 * no selection. The cursor is restored after setValue, matching 2.4.2.
 */
function transformSelectionOrDocument(editor: Editor, transform: TextTransform): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    editor.replaceSelection(transform(selected));
    return;
  }

  const cursor = editor.getCursor();
  editor.setValue(transform(editor.getValue()));
  editor.setCursor(cursor);
}

function toggleWrapper(
  editor: Editor,
  open: string,
  close: string,
  placeholder: string
): void {
  const selected = editor.getSelection();
  if (selected.length > 0) {
    const trimmed = selected.trim();
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      editor.replaceSelection(trimmed.slice(open.length, trimmed.length - close.length));
      return;
    }
    editor.replaceSelection(`${open}${selected}${close}`);
    return;
  }

  const cursor = editor.getCursor();
  editor.replaceRange(`${open}${placeholder}${close}`, cursor);
  editor.setSelection(
    { line: cursor.line, ch: cursor.ch + open.length },
    { line: cursor.line, ch: cursor.ch + open.length + placeholder.length }
  );
}

function mapNonEmptyLines(value: string, transform: TextTransform): string {
  return value
    .split("\n")
    .map((line) => line.trim().length > 0 ? transform(line) : line)
    .join("\n");
}

function clearFormatting(value: string): string {
  return value
    .replace(/<p\s+align=["']?(left|center|right|justify)["']?>([\s\S]*?)<\/p>/gi, "$2")
    .replace(/<center>([\s\S]*?)<\/center>/gi, "$1")
    .replace(/<\/?(?:u|sup|sub)>/gi, "")
    .replace(/<font\s+color=["']?[^"'>]+["']?>([\s\S]*?)<\/font>/gi, "$1")
    .replace(/<mark\s+style=["']?background:[^"'>]+["']?>([\s\S]*?)<\/mark>/gi, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "");
}

function stripOuterAlignment(value: string): string {
  return value
    .replace(/^<p\s+align=["']?(left|center|right|justify)["']?>([\s\S]*)<\/p>$/i, "$2")
    .replace(/^<center>([\s\S]*)<\/center>$/i, "$1");
}

function setAlignment(
  editor: Editor,
  alignment: "left" | "center" | "right" | "justify"
): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(value, (line) => `<p align="${alignment}">${stripOuterAlignment(line)}</p>`)
  );
}

function cycleChecklist(editor: Editor): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    value
      .split("\n")
      .map((line) => {
        if (/^\s*[-*+]\s+\[[xX ]\]\s+/.test(line)) {
          return line.replace(/^(\s*[-*+])\s+\[[xX ]\]\s+/, "$1 ");
        }
        if (/^\s*[-*+]\s+/.test(line)) {
          return line.replace(/^(\s*[-*+])\s+/, "$1 [ ] ");
        }
        if (/^\s*\d+\.\s+/.test(line)) {
          return line.replace(/^(\s*)\d+\.\s+/, "$1- [ ] ");
        }
        return line;
      })
      .join("\n")
  );
}

function listToTable(value: string): string {
  const rows = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);

  if (rows.length === 0) return value;
  return [
    `| ${t("editor.insert.listHeader")} |`,
    "| --- |",
    ...rows.map((line) => `| ${line.replace(/\|/g, "\\|")} |`)
  ].join("\n");
}

function tableToList(value: string): string {
  const tableLines = value
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => line.includes("|"));
  if (tableLines.length < 2) return value;

  const bodyLines = tableLines.slice(2);
  if (bodyLines.length === 0) return value;

  const items = bodyLines
    .map((line) => {
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      return cells.length === 0 ? "" : `- ${cells.join(" | ")}`;
    })
    .filter((line) => line.length > 0);
  return items.length > 0 ? items.join("\n") : value;
}

function toHalfwidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0)
    )
    .replace(/\u3000/g, " ");
}

function toFullwidth(value: string): string {
  return value
    .replace(/[!-~]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) + 0xfee0)
    )
    .replace(/ /g, "\u3000");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertCallout(editor: Editor, type: "note" | "warning"): void {
  const block = `> [!${type}] ${type === "warning" ? t("editor.insert.calloutWarning") : t("editor.insert.calloutNote")}
> ${t("editor.insert.calloutBody")}
`;
  editor.replaceRange(block, editor.getCursor());
}

export function applyFontColorValue(editor: Editor, color: string): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(
      value,
      (line) =>
        `<font color="${color}">${line.replace(
          /<font\s+color=["']?[^"'>]+["']?>([\s\S]*?)<\/font>/gi,
          "$1"
        )}</font>`
    )
  );
}

async function applyFontColor(editor: Editor, app: App): Promise<void> {
  const color = await promptUser(
    app,
    t("editor.prompt.fontColor", { example: "#1a73e8, red" }),
    "#1a73e8"
  );
  if (color) applyFontColorValue(editor, color);
}

export function applyBackgroundColorValue(
  editor: Editor,
  color: string
): void {
  transformSelectionOrCurrentLine(editor, (value) =>
    mapNonEmptyLines(
      value,
      (line) =>
        `<mark style="background:${color}">${line.replace(
          /<mark\s+style=["']?background:[^"'>]+["']?>([\s\S]*?)<\/mark>/gi,
          "$1"
        )}</mark>`
    )
  );
}

async function applyBackgroundColor(editor: Editor, app: App): Promise<void> {
  const color = await promptUser(
    app,
    t("editor.prompt.backgroundColor", { example: "#fff59d, yellow" }),
    "#fff59d"
  );
  if (color) applyBackgroundColorValue(editor, color);
}

function moveCurrentLine(editor: Editor, direction: -1 | 1): void {
  const cursor = editor.getCursor();
  const targetLine = cursor.line + direction;
  if (targetLine < 0 || targetLine >= editor.lineCount()) return;

  const current = editor.getLine(cursor.line);
  const target = editor.getLine(targetLine);
  editor.setLine(targetLine, current);
  editor.setLine(cursor.line, target);
  editor.setCursor({ line: targetLine, ch: cursor.ch });
}

function duplicateCurrentLine(editor: Editor): void {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  editor.replaceRange(`\n${line}`, { line: cursor.line, ch: line.length });
  editor.setCursor({ line: cursor.line + 1, ch: cursor.ch });
}

function addEditorCommand(
  plugin: Plugin,
  id: string,
  name: string,
  run: (editor: Editor, app: App) => void | Promise<void>
): void {
  plugin.addCommand({
    id,
    name,
    editorCallback: (editor) => {
      void Promise.resolve(run(editor, plugin.app)).catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : String(error));
      });
    }
  });
}

/** Re-registers every public 2.4.2 editor command without loading the legacy bundle. */
export function registerEditorCompatibilityCommands(plugin: Plugin): void {
  addEditorCommand(plugin, "clear-formatting", t("editor.command.clearFormatting"), (editor) => {
    transformSelectionOrCurrentLine(editor, clearFormatting);
  });
  addEditorCommand(plugin, "toggle-underline", t("editor.command.toggleUnderline"), (editor) => {
    toggleWrapper(editor, "<u>", "</u>", t("editor.insert.underline"));
  });
  addEditorCommand(plugin, "toggle-inline-math", t("editor.command.toggleInlineMath"), (editor) => {
    toggleWrapper(editor, "$", "$", "x+y");
  });
  addEditorCommand(plugin, "superscript", t("editor.command.superscript"), (editor) => {
    toggleWrapper(editor, "<sup>", "</sup>", t("editor.insert.superscript"));
  });
  addEditorCommand(plugin, "subscript", t("editor.command.subscript"), (editor) => {
    toggleWrapper(editor, "<sub>", "</sub>", t("editor.insert.subscript"));
  });

  addEditorCommand(plugin, "insert-link", t("editor.command.insertLink"), (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`[${selected}](https://)`);
      return;
    }
    const cursor = editor.getCursor();
    const linkText = t("editor.insert.linkText");
    editor.replaceRange(`[${linkText}](https://)`, cursor);
    editor.setSelection(
      { line: cursor.line, ch: cursor.ch + 1 },
      { line: cursor.line, ch: cursor.ch + 1 + linkText.length }
    );
  });
  addEditorCommand(plugin, "insert-wikilink", t("editor.command.insertWikilink"), (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`[[${selected}]]`);
      return;
    }
    editor.replaceRange(`[[${t("editor.insert.noteName")}]]`, editor.getCursor());
  });
  addEditorCommand(plugin, "insert-embed", t("editor.command.insertEmbed"), (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`![[${selected}]]`);
      return;
    }
    editor.replaceRange(`![[${t("editor.insert.attachment")}]]`, editor.getCursor());
  });
  addEditorCommand(plugin, "insert-table", t("editor.command.insertTable"), (editor) => {
    editor.replaceRange(markdownTable(3, 3, tableLabels()), editor.getCursor());
  });
  addEditorCommand(plugin, "insert-hr", t("editor.command.insertHr"), (editor) => {
    editor.replaceRange("\n---\n", editor.getCursor());
  });
  addEditorCommand(plugin, "insert-codeblock", t("editor.command.insertCodeBlock"), (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`\`\`\`\n${selected}\n\`\`\``);
      return;
    }
    const cursor = editor.getCursor();
    editor.replaceRange("```\n\n```", cursor);
    editor.setCursor({ line: cursor.line + 1, ch: 0 });
  });
  addEditorCommand(plugin, "insert-mathblock", t("editor.command.insertMathBlock"), (editor) => {
    const selected = editor.getSelection();
    if (selected.length > 0) {
      editor.replaceSelection(`$$\n${selected}\n$$`);
      return;
    }
    const cursor = editor.getCursor();
    editor.replaceRange("$$\n\n$$", cursor);
    editor.setCursor({ line: cursor.line + 1, ch: 0 });
  });
  addEditorCommand(plugin, "toggle-blockquote", t("editor.command.toggleBlockquote"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) =>
          line.startsWith("> ")
            ? line.slice(2)
            : line.trim().length > 0
              ? `> ${line}`
              : line
        )
        .join("\n")
    );
  });
  addEditorCommand(plugin, "insert-callout-note", t("editor.command.insertCalloutNote"), (editor) => {
    insertCallout(editor, "note");
  });
  addEditorCommand(plugin, "insert-callout-warning", t("editor.command.insertCalloutWarning"), (editor) => {
    insertCallout(editor, "warning");
  });

  addEditorCommand(plugin, "align-left", t("editor.command.alignLeft"), (editor) => setAlignment(editor, "left"));
  addEditorCommand(plugin, "align-center", t("editor.command.alignCenter"), (editor) => setAlignment(editor, "center"));
  addEditorCommand(plugin, "align-right", t("editor.command.alignRight"), (editor) => setAlignment(editor, "right"));
  addEditorCommand(plugin, "align-justify", t("editor.command.alignJustify"), (editor) => setAlignment(editor, "justify"));
  addEditorCommand(plugin, "change-font-color", t("editor.command.changeFontColor"), applyFontColor);
  addEditorCommand(plugin, "change-background-color", t("editor.command.changeBackgroundColor"), applyBackgroundColor);
  addEditorCommand(plugin, "cycle-list-checklist", t("editor.command.cycleListChecklist"), cycleChecklist);

  addEditorCommand(plugin, "text-get-plain", t("editor.command.textGetPlain"), (editor) => {
    transformSelectionOrDocument(editor, clearFormatting);
    new Notice(t("editor.notice.plainText"));
  });
  addEditorCommand(plugin, "text-smart-symbols", t("editor.command.textSmartSymbols"), (editor) => {
    transformSelectionOrDocument(
      editor,
      (value) => /[\uFF01-\uFF5E\u3000]/.test(value) ? toHalfwidth(value) : toFullwidth(value)
    );
  });
  addEditorCommand(plugin, "text-insert-blank-lines", t("editor.command.textInsertBlankLines"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.split("\n").join("\n\n"));
  });
  addEditorCommand(plugin, "text-remove-blank-lines", t("editor.command.textRemoveBlankLines"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-split-lines", t("editor.command.textSplitLines"), async (editor, app) => {
    const separator = await promptUser(app, t("editor.prompt.separator"), ",");
    if (!separator) return;
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .flatMap((line) => line.split(separator))
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-merge-lines", t("editor.command.textMergeLines"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join(" ")
    );
  });
  addEditorCommand(plugin, "text-dedupe-lines", t("editor.command.textDedupeLines"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => {
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const line of value.split("\n")) {
        if (seen.has(line)) continue;
        seen.add(line);
        unique.push(line);
      }
      return unique.join("\n");
    });
  });
  addEditorCommand(plugin, "text-add-wrap", t("editor.command.textAddWrap"), async (editor, app) => {
    const prefix = await promptUser(app, t("editor.prompt.prefix"), "", true);
    if (prefix === null) return;
    const suffix = await promptUser(app, t("editor.prompt.suffix"), "", true);
    if (suffix === null) return;
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => `${prefix}${line}${suffix}`)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-number-lines", t("editor.command.textNumberLines"), async (editor, app) => {
    const requestedStart = await promptUser(app, t("editor.prompt.startNumber"), "1");
    if (requestedStart === null) return;
    const parsedStart = requestedStart ? Number(requestedStart) : 1;
    const start = Number.isFinite(parsedStart) ? parsedStart : 1;
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line, index) => `${start + index}. ${line}`)
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-trim-line-ends", t("editor.command.textTrimLineEnds"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) =>
      value
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
    );
  });
  addEditorCommand(plugin, "text-compress-spaces", t("editor.command.textCompressSpaces"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.replace(/[ \t]{2,}/g, " "));
  });
  addEditorCommand(plugin, "text-remove-all-whitespace", t("editor.command.textRemoveAllWhitespace"), (editor) => {
    transformSelectionOrCurrentLine(editor, (value) => value.replace(/\s+/g, ""));
  });
  addEditorCommand(plugin, "text-list-to-table", t("editor.command.textListToTable"), (editor) => {
    transformSelectionOrCurrentLine(editor, listToTable);
  });
  addEditorCommand(plugin, "text-table-to-list", t("editor.command.textTableToList"), (editor) => {
    transformSelectionOrCurrentLine(editor, tableToList);
  });
  addEditorCommand(plugin, "text-extract-between", t("editor.command.textExtractBetween"), async (editor, app) => {
    const start = await promptUser(app, t("editor.prompt.startText"), "");
    if (start === null) return;
    const end = await promptUser(app, t("editor.prompt.endText"), "");
    if (!start || !end) return;
    transformSelectionOrCurrentLine(editor, (value) => {
      const expression = new RegExp(
        `${escapeRegExp(start)}([\\s\\S]*?)${escapeRegExp(end)}`,
        "g"
      );
      const matches: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = expression.exec(value)) !== null) matches.push(match[1]);
      if (matches.length === 0) {
        new Notice(t("editor.notice.noMatch"));
        return value;
      }
      return matches.join("\n");
    });
  });

  addEditorCommand(plugin, "insert-image", t("editor.command.insertImage"), (editor) => {
    editor.replaceRange(`![[${t("editor.insert.imageFile")}.png]]`, editor.getCursor());
  });
  addEditorCommand(plugin, "move-line-up", t("editor.command.moveLineUp"), (editor) => {
    moveCurrentLine(editor, -1);
  });
  addEditorCommand(plugin, "move-line-down", t("editor.command.moveLineDown"), (editor) => {
    moveCurrentLine(editor, 1);
  });
  addEditorCommand(plugin, "duplicate-line", t("editor.command.duplicateLine"), duplicateCurrentLine);
  addEditorCommand(plugin, "insert-callout", t("editor.command.insertCallout"), (editor) => {
    insertCallout(editor, "note");
  });
}
