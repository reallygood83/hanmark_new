import {
  Component,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Setting,
  type App
} from "obsidian";
import type { FileGateway } from "../io/fileGateway";
import {
  filterWordFontEntries,
  type WordFontCatalog,
  type WordFontCatalogEntry
} from "../legacy-port/wordFontCatalog";
import {
  cloneWordTemplate,
  WORD_STYLE_IDS,
  type WordAlignment,
  type WordLineSpacingMode,
  type WordStyleId,
  type WordStyleSpec,
  type WordTemplateSpec,
  type WordUnderline
} from "../legacy-port/wordTypes";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import { applyWordTemplatePreview } from "./DocxPreviewView";
import { confirmAction, promptText } from "./dialogs";
import { t, tKey, type MessageKey } from "../i18n";

/** Message key of the sample note shown in the template preview. */
const WORD_TEMPLATE_PREVIEW_SAMPLE = "wordTemplate.previewSample";

const MAX_VISIBLE_FONT_RESULTS = 200;

export interface WordTemplateManagerModalOptions {
  store: WordTemplateStore;
  fileGateway: FileGateway;
  fontCatalog: WordFontCatalog;
  /** Persist settings and refresh DOCX previews after a template mutation. */
  onChanged?: (activeTemplate: WordTemplateSpec) => Promise<void> | void;
  /** Persist custom-font settings and refresh the browser DOCX preview. */
  onFontCatalogChanged?: () => Promise<void> | void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return `${error}`;
  }
  return t("common.unknownError");
}

function normalizedTemplateName(value: string): string {
  return value.trim() || t("wordTemplate.untitledName");
}

function normalizedHexColor(value: string, fallback = "#000000"): string {
  const normalized = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    return `#${normalized.toUpperCase()}`;
  }
  return fallback;
}

function safeTemplateFilename(template: WordTemplateSpec): string {
  const stem = template.name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return `${stem || "hanmark-word-template"}.json`;
}

export function wordTemplateDraftIsDirty(
  persistedSnapshot: string,
  draft: WordTemplateSpec
): boolean {
  return JSON.stringify(draft) !== persistedSnapshot;
}

class WordFontCombobox {
  private readonly rootEl: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly panelEl: HTMLElement;
  private readonly entries: readonly WordFontCatalogEntry[];
  private readonly sample: string;
  private readonly onValue: (value: string) => void;
  private filteredEntries: WordFontCatalogEntry[] = [];
  private matchingEntryCount = 0;
  private highlightedIndex = 0;
  private blurTimer: number | null = null;

  constructor(
    container: HTMLElement,
    options: {
      value: string;
      entries: readonly WordFontCatalogEntry[];
      sample: string;
      placeholder: string;
      onValue: (value: string) => void;
    }
  ) {
    this.entries = options.entries;
    this.sample = options.sample;
    this.onValue = options.onValue;
    this.rootEl = container.createDiv({ cls: "word-font-combobox" });
    this.inputEl = this.rootEl.createEl("input", {
      cls: "word-font-combobox-input",
      type: "text",
      attr: {
        placeholder: options.placeholder,
        "aria-label": options.placeholder,
        "aria-autocomplete": "list",
        autocomplete: "off"
      }
    });
    this.inputEl.value = options.value;
    const toggle = this.rootEl.createEl("button", {
      cls: "word-font-combobox-toggle",
      text: "▾",
      attr: { type: "button", "aria-label": t("wordFont.combobox.openList") }
    });
    this.panelEl = this.rootEl.createDiv({
      cls: "word-font-combobox-panel",
      attr: { role: "listbox" }
    });
    this.updateFilter();
    this.renderPanel();

    this.inputEl.addEventListener("focus", () => this.open());
    this.inputEl.addEventListener("input", () => {
      this.updateFilter();
      this.renderPanel();
      this.open();
      this.onValue(this.inputEl.value);
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.open();
        this.moveHighlight(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.open();
        this.moveHighlight(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.commit(
          this.filteredEntries[this.highlightedIndex]?.family ??
            this.inputEl.value
        );
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closePanel();
      }
    });
    this.inputEl.addEventListener("blur", () => {
      this.blurTimer = window.setTimeout(() => this.closePanel(), 120);
    });
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      if (this.rootEl.hasClass("is-open")) {
        this.closePanel();
      } else {
        this.open();
        this.inputEl.focus();
      }
    });
  }

  private updateFilter(): void {
    const matches = filterWordFontEntries(this.entries, this.inputEl.value);
    this.matchingEntryCount = matches.length;
    this.filteredEntries = matches.slice(0, MAX_VISIBLE_FONT_RESULTS);
    this.highlightedIndex = 0;
  }

  private moveHighlight(delta: number): void {
    if (!this.filteredEntries.length) return;
    this.highlightedIndex =
      (this.highlightedIndex + delta + this.filteredEntries.length) %
      this.filteredEntries.length;
    this.renderPanel();
    this.panelEl
      .querySelector(".is-highlighted")
      ?.scrollIntoView({ block: "nearest" });
  }

  private commit(value: string): void {
    const family = value.trim();
    if (family) this.inputEl.value = family;
    this.onValue(this.inputEl.value);
    this.closePanel();
  }

  private renderManualRow(): void {
    const value = this.inputEl.value.trim();
    if (!value) return;
    const row = this.panelEl.createDiv({
      cls: "word-font-option word-font-option-manual",
      attr: { role: "option" }
    });
    row.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.commit(value);
    });
    row.createDiv({
      cls: "word-font-option-name",
      text: t("wordFont.combobox.useTyped", { name: value })
    });
    row.createDiv({
      cls: "word-font-option-sample",
      text: this.sample
    }).style.fontFamily = `"${value.replace(/["\\]/g, "")}", sans-serif`;
  }

  private renderPanel(): void {
    this.panelEl.empty();
    const typed = this.inputEl.value.trim().toLocaleLowerCase();
    const exact = this.filteredEntries.some(
      (entry) => entry.family.toLocaleLowerCase() === typed
    );
    if (!exact) this.renderManualRow();
    if (!this.filteredEntries.length) {
      this.panelEl.createDiv({
        cls: "word-font-empty",
        text: typed
          ? t("wordFont.combobox.noMatch")
          : t("wordFont.combobox.empty")
      });
      return;
    }
    if (this.matchingEntryCount > this.filteredEntries.length) {
      this.panelEl.createDiv({
        cls: "word-font-empty",
        text: t("wordFont.combobox.truncated", {
          total: this.matchingEntryCount.toLocaleString(),
          shown: this.filteredEntries.length
        })
      });
    }
    this.filteredEntries.forEach((entry, index) => {
      const row = this.panelEl.createDiv({
        cls:
          `word-font-option${index === this.highlightedIndex ? " is-highlighted" : ""}`,
        attr: { role: "option" }
      });
      row.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.commit(entry.family);
      });
      const name = row.createDiv({
        cls: "word-font-option-name",
        text: entry.displayName
      });
      name.title = `${entry.family} · ${entry.sourceLabel ?? entry.source}`;
      row.createDiv({
        cls: "word-font-option-sample",
        text: this.sample
      }).style.fontFamily =
        `"${entry.previewFamily.replace(/["\\]/g, "")}", ` +
        `"${entry.family.replace(/["\\]/g, "")}", sans-serif`;
    });
  }

  private open(): void {
    if (this.blurTimer !== null) {
      window.clearTimeout(this.blurTimer);
      this.blurTimer = null;
    }
    this.rootEl.addClass("is-open");
  }

  private closePanel(): void {
    this.rootEl.removeClass("is-open");
  }
}

export class WordTemplateManagerModal extends Modal {
  private readonly options: WordTemplateManagerModalOptions;
  private templates: WordTemplateSpec[] = [];
  private activeTemplateId = "default";
  private draft: WordTemplateSpec | null = null;
  private persistedSnapshot = "";
  private selectedStyleId: WordStyleId = "Normal";
  private dirtyStatusEl: HTMLElement | null = null;
  private previewTab: "sample" | "current" = "sample";
  private previewPaperEl: HTMLElement | null = null;
  private previewTimer: number | null = null;
  private previewRenderVersion = 0;
  private bypassCloseGuard = false;
  private readonly previewComponent = new Component();

  constructor(app: App, options: WordTemplateManagerModalOptions) {
    super(app);
    this.options = options;
  }

  async onOpen(): Promise<void> {
    this.previewComponent.load();
    this.modalEl.addClass(
      "hanmark-resizable-workspace-modal",
      "hanmark-word-template-manager-modal",
      "word-template-modal-shell"
    );
    this.contentEl.addClass(
      "hanmark-word-template-manager",
      "word-template-modal"
    );
    await this.options.fontCatalog.applyPreviewFonts(
      this.contentEl.ownerDocument
    );
    await this.reload();
  }

  onClose(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.modalEl.removeClass(
      "hanmark-resizable-workspace-modal",
      "hanmark-word-template-manager-modal",
      "word-template-modal-shell"
    );
    this.contentEl.empty();
    this.templates = [];
    this.draft = null;
    this.previewPaperEl = null;
    this.previewComponent.unload();
  }

  close(): void {
    if (this.bypassCloseGuard || !this.isDirty()) {
      super.close();
      return;
    }
    void this.confirm(t("wordTemplate.confirm.discardAndClose")).then((discard) => {
      if (!discard) return;
      this.bypassCloseGuard = true;
      super.close();
      this.bypassCloseGuard = false;
    });
  }

  /** Electron has no working browser confirm/prompt dialogs; ask through Obsidian modals. */
  private confirm(message: string): Promise<boolean> {
    return confirmAction(this.app, {
      title: t("wordTemplate.dialogTitle"),
      message,
      confirmText: t("wordTemplate.continue"),
      warning: true
    });
  }

  private prompt(message: string, value: string): Promise<string | null> {
    return promptText(this.app, { title: t("wordTemplate.dialogTitle"), label: message, value });
  }

  private async reload(preferredId?: string): Promise<void> {
    try {
      this.templates = await this.options.store.listTemplates();
      if (!this.templates.length) {
        throw new Error(t("wordTemplate.noTemplates"));
      }
      const active = await this.options.store.readActiveTemplate();
      this.activeTemplateId = active.id;
      const preferred = preferredId
        ? await this.options.store.readTemplate(preferredId)
        : null;
      this.markPersisted(preferred ?? active);
      this.render();
    } catch (error) {
      this.renderError(error);
    }
  }

  private renderError(error: unknown): void {
    this.setTitle(t("wordTemplate.dialogTitle"));
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "hanmark-word-template-error",
      text: t("wordTemplate.openFailed", { detail: errorMessage(error) })
    });
  }

  private isDirty(): boolean {
    return this.draft
      ? wordTemplateDraftIsDirty(this.persistedSnapshot, this.draft)
      : false;
  }

  private markDirty(): void {
    this.updateDirtyState();
    this.schedulePreviewRender();
  }

  private markPersisted(template: WordTemplateSpec): void {
    this.draft = cloneWordTemplate(template);
    if (!this.draft.styles[this.selectedStyleId]) {
      this.selectedStyleId = "Normal";
    }
    this.persistedSnapshot = JSON.stringify(this.draft);
    this.updateDirtyState();
    this.schedulePreviewRender();
  }

  private updateDirtyState(): void {
    if (!this.dirtyStatusEl) return;
    if (this.isDirty()) {
      this.dirtyStatusEl.setText(t("wordTemplate.status.unsaved"));
      this.dirtyStatusEl.addClass("is-dirty");
    } else {
      this.dirtyStatusEl.setText(t("wordTemplate.status.saved"));
      this.dirtyStatusEl.removeClass("is-dirty");
    }
  }

  private schedulePreviewRender(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.renderPreview();
    }, 250);
  }

  private render(): void {
    if (!this.draft) return;
    this.setTitle(t("wordTemplate.title"));
    this.contentEl.empty();
    this.renderHeader(this.contentEl);
    const layout = this.contentEl.createDiv({ cls: "word-template-layout" });
    this.renderSidebar(layout);
    this.renderEditor(layout);
    this.renderPreviewPanel(layout);
  }

  private createButton(
    container: HTMLElement,
    text: string,
    className: string,
    action: () => void
  ): HTMLButtonElement {
    const button = container.createEl("button", {
      text,
      cls: className,
      attr: { type: "button" }
    });
    button.addEventListener("click", action);
    return button;
  }

  private renderHeader(content: HTMLElement): void {
    const draft = this.draft;
    if (!draft) return;
    const header = content.createDiv({ cls: "word-template-header" });
    const chooser = header.createDiv({ cls: "word-template-header-group" });
    chooser.createDiv({
      cls: "word-template-header-label",
      text: t("wordTemplate.header.template")
    });
    const select = chooser.createEl("select", {
      cls: "dropdown word-template-template-select",
      attr: { "aria-label": t("wordTemplate.header.select") }
    });
    for (const template of this.templates) {
      const option = select.createEl("option", {
        text:
          template.id === this.activeTemplateId
            ? t("wordTemplate.header.activeOption", { name: template.name })
            : template.name
      });
      option.value = template.id;
    }
    select.value = draft.id;
    select.addEventListener("change", () => {
      void this.onTemplateSelected(select.value);
    });
    this.dirtyStatusEl = header.createSpan({
      cls: "word-template-dirty-status"
    });

    const actions = header.createDiv({ cls: "word-template-actions" });
    this.createButton(actions, t("wordTemplate.action.new"), "mod-muted", () => {
      void this.createTemplate();
    });
    this.createButton(actions, t("template.manager.duplicate"), "mod-muted", () => {
      void this.duplicateTemplate();
    });
    this.createButton(actions, t("template.manager.rename"), "mod-muted", () => {
      void this.renameTemplate();
    });
    const deleteButton = this.createButton(
      actions,
      t("template.manager.delete"),
      "mod-warning",
      () => void this.deleteTemplate()
    );
    deleteButton.disabled = draft.id === "default";
    this.createButton(actions, t("wordTemplate.action.import"), "mod-muted", () => {
      void this.importJson();
    });
    this.createButton(actions, t("wordTemplate.action.export"), "mod-muted", () => {
      void this.exportJson();
    });
    this.createButton(actions, t("wordTemplate.action.save"), "mod-cta", () => {
      void this.saveDraft(false);
    });
    this.createButton(actions, t("wordTemplate.action.saveAndUse"), "mod-cta", () => {
      void this.saveDraft(true);
    });
    this.createButton(actions, t("wordTemplate.action.revert"), "mod-muted", () => {
      void this.resetDraft();
    });
    this.createButton(actions, t("common.close"), "mod-muted", () => this.close());
    this.updateDirtyState();
  }

  private renderSidebar(layout: HTMLElement): void {
    const sidebar = layout.createDiv({ cls: "word-template-sidebar" });
    sidebar.createEl("h3", { text: t("wordTemplate.styles") });
    const list = sidebar.createDiv({ cls: "word-template-style-list" });
    for (const id of WORD_STYLE_IDS) {
      const button = list.createEl("button", {
        text: id,
        cls:
          `word-style-button${id === this.selectedStyleId ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        if (id === this.selectedStyleId) return;
        this.selectedStyleId = id;
        this.render();
      });
    }
  }

  private renderEditor(layout: HTMLElement): void {
    const draft = this.draft;
    if (!draft) return;
    const editor = layout.createDiv({ cls: "word-template-editor" });

    const identity = this.createSection(editor, t("wordTemplate.section.info"));
    this.createTextInput(
      this.createFieldRow(identity, t("wordTemplate.field.name")),
      draft.name,
      (value) => {
        draft.name = normalizedTemplateName(value);
        this.markDirty();
      }
    );

    const style = draft.styles[this.selectedStyleId];
    const fontSection = this.createSection(
      editor,
      t("wordTemplate.section.font", { style: style.displayName })
    );
    this.renderFontEditor(fontSection, style);

    const links = this.createSection(editor, t("wordTemplate.section.links"));
    this.createSelect(
      this.createFieldRow(links, t("wordTemplate.field.basedOn")),
      ["", ...WORD_STYLE_IDS],
      style.basedOn ?? "",
      (value) => {
        style.basedOn = value
          ? (value as WordStyleId)
          : undefined;
        this.markDirty();
      }
    );
    this.createSelect(
      this.createFieldRow(links, t("wordTemplate.field.nextStyle")),
      ["", ...WORD_STYLE_IDS],
      style.nextStyle ?? "",
      (value) => {
        style.nextStyle = value
          ? (value as WordStyleId)
          : undefined;
        this.markDirty();
      }
    );

    if (style.paragraph) {
      const paragraph = this.createSection(
        editor,
        t("wordTemplate.section.paragraph", { style: style.displayName })
      );
      this.renderParagraphEditor(paragraph, style);
    }

    const page = this.createSection(editor, t("wordTemplate.section.page"));
    this.renderPageEditor(page, draft);
    this.renderFontCatalog(editor, draft);
  }

  private createSection(container: HTMLElement, title: string): HTMLElement {
    const section = container.createDiv({ cls: "word-template-section" });
    section.createEl("h4", { text: title });
    return section;
  }

  private createFieldRow(container: HTMLElement, label: string): HTMLElement {
    const row = container.createDiv({ cls: "word-template-field" });
    row.createDiv({ cls: "word-template-field-label", text: label });
    return row.createDiv({ cls: "word-template-field-control" });
  }

  private createTextInput(
    container: HTMLElement,
    value: string,
    update: (value: string) => void,
    placeholder = "",
    extraClass = ""
  ): HTMLInputElement {
    const input = container.createEl("input", {
      cls: `word-template-input ${extraClass}`.trim(),
      type: "text"
    });
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => update(input.value));
    return input;
  }

  private createNumberInput(
    container: HTMLElement,
    value: number,
    update: (value: number) => void,
    step = "0.1"
  ): HTMLInputElement {
    const input = container.createEl("input", {
      cls: "word-template-input word-template-input-number",
      type: "number"
    });
    input.value = String(value);
    input.step = step;
    input.addEventListener("input", () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) update(parsed);
    });
    return input;
  }

  private createSelect(
    container: HTMLElement,
    values: readonly string[],
    selected: string,
    update: (value: string) => void,
    /** Readable labels for stored values; the stored value itself never changes. */
    labels?: Readonly<Record<string, MessageKey>>
  ): HTMLSelectElement {
    const select = container.createEl("select", {
      cls: "dropdown word-template-select"
    });
    for (const value of values) {
      const label = labels?.[value];
      const option = select.createEl("option", {
        text: label ? tKey(label) : value || t("wordTemplate.option.none")
      });
      option.value = value;
    }
    select.value = selected;
    select.addEventListener("change", () => update(select.value));
    return select;
  }

  private createToggleChip(
    container: HTMLElement,
    label: string,
    selected: boolean,
    update: (value: boolean) => void
  ): void {
    const button = container.createEl("button", {
      text: label,
      cls: `word-template-chip${selected ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(selected) }
    });
    button.addEventListener("click", () => {
      const next = !button.hasClass("is-active");
      button.toggleClass("is-active", next);
      button.setAttribute("aria-pressed", String(next));
      update(next);
    });
  }

  private documentFontFamilies(draft: WordTemplateSpec): string[] {
    const families = new Set<string>();
    for (const style of Object.values(draft.styles)) {
      const font = style.font;
      if (!font) continue;
      for (const family of [
        font.family,
        font.eastAsiaFamily,
        font.asciiFamily,
        font.hAnsiFamily,
        font.csFamily
      ]) {
        if (family?.trim()) families.add(family.trim());
      }
    }
    return [...families];
  }

  private renderFontEditor(
    container: HTMLElement,
    style: WordStyleSpec
  ): void {
    const font = style.font;
    const draft = this.draft;
    if (!font || !draft) {
      container.createEl("p", {
        cls: "setting-item-description",
        text: t("wordTemplate.font.none")
      });
      return;
    }
    const entries = this.options.fontCatalog.listFamilies(
      this.documentFontFamilies(draft)
    );
    const korean = this.createFieldRow(container, t("wordTemplate.font.korean"));
    new WordFontCombobox(korean, {
      value: font.eastAsiaFamily ?? font.family,
      entries,
      sample: this.options.fontCatalog.getPreviewSample(),
      placeholder: t("wordTemplate.font.placeholder"),
      onValue: (value) => {
        const family = value.trim();
        font.eastAsiaFamily = family;
        font.family = family;
        this.markDirty();
      }
    });
    const latin = this.createFieldRow(container, t("wordTemplate.font.latin"));
    new WordFontCombobox(latin, {
      value: font.asciiFamily ?? font.hAnsiFamily ?? font.family,
      entries,
      sample: this.options.fontCatalog.getPreviewSample(),
      placeholder: t("wordTemplate.font.placeholder"),
      onValue: (value) => {
        const family = value.trim();
        font.asciiFamily = family;
        font.hAnsiFamily = family;
        font.csFamily = family;
        this.markDirty();
      }
    });
    this.createNumberInput(
      this.createFieldRow(container, t("wordTemplate.font.size")),
      font.sizePt,
      (value) => {
        font.sizePt = value;
        this.markDirty();
      }
    );
    const emphasis = this.createFieldRow(container, t("wordTemplate.font.emphasis")).createDiv({
      cls: "word-template-inline-group"
    });
    this.createToggleChip(emphasis, t("wordTemplate.font.bold"), font.bold, (value) => {
      font.bold = value;
      this.markDirty();
    });
    this.createToggleChip(emphasis, t("wordTemplate.font.italic"), font.italic, (value) => {
      font.italic = value;
      this.markDirty();
    });
    this.createSelect(
      emphasis,
      ["none", "single", "double"],
      font.underline,
      (value) => {
        const underline: WordUnderline =
          value === "single" || value === "double" ? value : "none";
        font.underline = underline;
        this.markDirty();
      },
      {
        none: "wordTemplate.option.underline.none",
        single: "wordTemplate.option.underline.single",
        double: "wordTemplate.option.underline.double"
      }
    );

    const colorGroup = this.createFieldRow(container, t("wordTemplate.font.color")).createDiv({
      cls: "word-template-inline-group word-template-color-group"
    });
    const initialColor = normalizedHexColor(font.color ?? "#000000");
    const colorPicker = colorGroup.createEl("input", {
      cls: "word-template-color-picker",
      type: "color",
      attr: { "aria-label": t("wordTemplate.font.colorPicker") }
    });
    colorPicker.value = initialColor;
    const colorText = this.createTextInput(
      colorGroup,
      initialColor,
      (value) => {
        const color = normalizedHexColor(value, colorPicker.value);
        font.color = color;
        if (/^#?[0-9a-f]{6}$/i.test(value.trim())) {
          colorPicker.value = color;
        }
        this.markDirty();
      },
      "#000000",
      "word-template-input-color"
    );
    colorPicker.addEventListener("input", () => {
      const color = colorPicker.value.toUpperCase();
      colorText.value = color;
      font.color = color;
      this.markDirty();
    });
    this.createNumberInput(
      this.createFieldRow(container, t("wordTemplate.font.charSpacing")),
      font.charSpacingPt ?? 0,
      (value) => {
        font.charSpacingPt = value;
        this.markDirty();
      }
    );
    this.createNumberInput(
      this.createFieldRow(container, t("wordTemplate.font.widthScale")),
      font.widthScalePct ?? 100,
      (value) => {
        font.widthScalePct = value;
        this.markDirty();
      },
      "1"
    );
  }

  private renderParagraphEditor(
    container: HTMLElement,
    style: WordStyleSpec
  ): void {
    const paragraph = style.paragraph;
    if (!paragraph) return;
    this.createSelect(
      this.createFieldRow(container, t("wordTemplate.paragraph.align")),
      ["left", "center", "right", "justify"],
      paragraph.align,
      (value) => {
        const align: WordAlignment =
          value === "center" || value === "right" || value === "justify"
            ? value
            : "left";
        paragraph.align = align;
        this.markDirty();
      },
      {
        left: "wordTemplate.option.align.left",
        center: "wordTemplate.option.align.center",
        right: "wordTemplate.option.align.right",
        justify: "wordTemplate.option.align.justify"
      }
    );
    this.createSelect(
      this.createFieldRow(container, t("wordTemplate.paragraph.lineSpacingMode")),
      ["single", "multiple", "exact", "atLeast"],
      paragraph.lineSpacingMode,
      (value) => {
        const mode: WordLineSpacingMode =
          value === "single" || value === "exact" || value === "atLeast"
            ? value
            : "multiple";
        paragraph.lineSpacingMode = mode;
        this.markDirty();
      },
      {
        single: "wordTemplate.option.lineSpacing.single",
        multiple: "wordTemplate.option.lineSpacing.multiple",
        exact: "wordTemplate.option.lineSpacing.exact",
        atLeast: "wordTemplate.option.lineSpacing.atLeast"
      }
    );
    this.createNumberInput(
      this.createFieldRow(container, t("wordTemplate.paragraph.lineSpacingValue")),
      paragraph.lineSpacingValue,
      (value) => {
        paragraph.lineSpacingValue = value;
        this.markDirty();
      }
    );
    const numbers: Array<[string, keyof typeof paragraph]> = [
      [t("wordTemplate.paragraph.leftIndent"), "leftIndentPt"],
      [t("wordTemplate.paragraph.rightIndent"), "rightIndentPt"],
      [t("wordTemplate.paragraph.firstLineIndent"), "firstLineIndentPt"],
      [t("wordTemplate.paragraph.spacingBefore"), "spacingBeforePt"],
      [t("wordTemplate.paragraph.spacingAfter"), "spacingAfterPt"]
    ];
    for (const [label, key] of numbers) {
      const value = paragraph[key];
      if (typeof value !== "number") continue;
      this.createNumberInput(
        this.createFieldRow(container, label),
        value,
        (next) => {
          paragraph[key] = next as never;
          this.markDirty();
        }
      );
    }
    const flow = this.createFieldRow(container, t("wordTemplate.paragraph.flow")).createDiv({
      cls: "word-template-inline-group"
    });
    this.createToggleChip(
      flow,
      t("wordTemplate.paragraph.keepWithNext"),
      paragraph.keepWithNext ?? false,
      (value) => {
        paragraph.keepWithNext = value;
        this.markDirty();
      }
    );
    this.createToggleChip(
      flow,
      t("wordTemplate.paragraph.pageBreakBefore"),
      paragraph.pageBreakBefore ?? false,
      (value) => {
        paragraph.pageBreakBefore = value;
        this.markDirty();
      }
    );
    this.createToggleChip(
      flow,
      t("wordTemplate.paragraph.widowControl"),
      paragraph.widowControl ?? true,
      (value) => {
        paragraph.widowControl = value;
        this.markDirty();
      }
    );
  }

  private renderPageEditor(
    container: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    this.createSelect(
      this.createFieldRow(container, t("wordTemplate.page.orientation")),
      ["portrait", "landscape"],
      draft.page.orientation,
      (value) => {
        draft.page.orientation =
          value === "landscape" ? "landscape" : "portrait";
        this.markDirty();
      },
      {
        portrait: "wordTemplate.option.orientation.portrait",
        landscape: "wordTemplate.option.orientation.landscape"
      }
    );
    const numbers: Array<[string, keyof typeof draft.page]> = [
      [t("wordTemplate.page.width"), "widthPt"],
      [t("wordTemplate.page.height"), "heightPt"],
      [t("wordTemplate.page.marginTop"), "marginTopPt"],
      [t("wordTemplate.page.marginRight"), "marginRightPt"],
      [t("wordTemplate.page.marginBottom"), "marginBottomPt"],
      [t("wordTemplate.page.marginLeft"), "marginLeftPt"],
      [t("wordTemplate.page.headerDistance"), "headerDistancePt"],
      [t("wordTemplate.page.footerDistance"), "footerDistancePt"]
    ];
    for (const [label, key] of numbers) {
      const value = draft.page[key];
      if (typeof value !== "number") continue;
      this.createNumberInput(
        this.createFieldRow(container, label),
        value,
        (next) => {
          draft.page[key] = next as never;
          this.markDirty();
        }
      );
    }
  }

  private renderFontCatalog(
    container: HTMLElement,
    draft: WordTemplateSpec
  ): void {
    const details = container.createEl("details", {
      cls: "hanmark-word-template-section"
    });
    details.createEl("summary", { text: t("wordFont.catalog.title") });
    const choices = this.options.fontCatalog.listFamilies(
      this.documentFontFamilies(draft)
    );
    details.createEl("p", {
      cls: "setting-item-description",
      text: t("wordFont.catalog.desc", {
        count: choices.length.toLocaleString()
      })
    });
    new Setting(details)
      .setName(t("wordFont.catalog.installed.name"))
      .setDesc(t("wordFont.catalog.installed.desc"))
      .addButton((button) => {
        button.setButtonText(t("wordFont.catalog.installed.find"));
        button.onClick(() => void this.discoverInstalledFonts());
      });
    new Setting(details)
      .setName(t("wordFont.catalog.custom.name"))
      .setDesc(t("wordFont.catalog.custom.desc"))
      .addButton((button) => {
        button.setButtonText(t("wordFont.catalog.custom.files"));
        button.onClick(() => void this.importFontFiles(false));
      })
      .addButton((button) => {
        button.setButtonText(t("wordFont.catalog.custom.folder"));
        button.onClick(() => void this.importFontFiles(true));
      });
    const custom = this.options.fontCatalog.listCustomFonts();
    if (!custom.length) {
      details.createEl("p", {
        cls: "setting-item-description",
        text: t("wordFont.catalog.custom.none")
      });
      return;
    }
    const list = details.createDiv({ cls: "word-font-custom-list" });
    for (const entry of custom) {
      const row = list.createDiv({ cls: "word-font-custom-row" });
      const label = row.createDiv();
      label.createDiv({
        cls: "word-font-option-name",
        text: entry.displayName
      });
      label.createDiv({
        cls: "word-font-option-sample",
        text:
          `${this.options.fontCatalog.getPreviewSample()} · ` +
          `${entry.sourceLabel ?? t("wordFont.catalog.custom.fileLabel")}`
      }).style.fontFamily =
        `"${entry.previewFamily.replace(/["\\]/g, "")}", sans-serif`;
      const remove = row.createEl("button", {
        text: t("wordFont.catalog.custom.remove"),
        attr: {
          type: "button",
          "aria-label": t("wordFont.catalog.custom.removeLabel", {
            family: entry.family
          })
        }
      });
      remove.addEventListener("click", () => {
        void this.removeCustomFont(entry);
      });
    }
  }

  private renderPreviewPanel(layout: HTMLElement): void {
    const preview = layout.createDiv({ cls: "word-template-preview" });
    const header = preview.createDiv({
      cls: "word-template-preview-header"
    });
    header.createEl("h3", { text: t("wordTemplate.preview.title") });
    const tabs = header.createDiv({ cls: "word-preview-tabs" });
    this.createButton(
      tabs,
      t("wordTemplate.preview.sample"),
      this.previewTab === "sample" ? "is-active" : "",
      () => {
        this.previewTab = "sample";
        this.render();
      }
    );
    this.createButton(
      tabs,
      t("wordTemplate.preview.current"),
      this.previewTab === "current" ? "is-active" : "",
      () => {
        this.previewTab = "current";
        this.render();
      }
    );
    const stage = preview.createDiv({
      cls: "word-template-preview-stage"
    });
    this.previewPaperEl = stage.createDiv({
      cls: "word-template-preview-paper"
    });
    void this.renderPreview();
  }

  private async renderPreview(): Promise<void> {
    const paper = this.previewPaperEl;
    const draft = this.draft;
    if (!paper || !draft) return;
    const version = ++this.previewRenderVersion;
    paper.empty();
    const activeView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    const markdown =
      this.previewTab === "current"
        ? activeView?.editor.getValue() ||
          t("wordTemplate.preview.openNote")
        : t(WORD_TEMPLATE_PREVIEW_SAMPLE);
    const sourcePath = activeView?.file?.path ?? "";
    const rendered = paper.createDiv({
      cls: "word-template-preview-markdown"
    });
    try {
      await this.options.fontCatalog.applyPreviewFonts(paper.ownerDocument);
      await MarkdownRenderer.render(
        this.app,
        markdown,
        rendered,
        sourcePath,
        this.previewComponent
      );
      if (
        version !== this.previewRenderVersion ||
        paper !== this.previewPaperEl
      ) {
        return;
      }
      applyWordTemplatePreview(paper, rendered, draft);
    } catch (error) {
      if (version !== this.previewRenderVersion) return;
      paper.empty();
      paper.createDiv({
        cls: "docx-preview-error",
        text: t("wordTemplate.preview.failed", { detail: errorMessage(error) })
      });
    }
  }

  private async onTemplateSelected(id: string): Promise<void> {
    const draft = this.draft;
    if (!draft || id === draft.id) return;
    if (
      this.isDirty() &&
      !(await this.confirm(t("wordTemplate.confirm.switch")))
    ) {
      this.render();
      return;
    }
    const template = await this.options.store.readTemplate(id);
    if (!template) {
      new Notice(t("wordTemplate.notice.notFound", { id }));
      this.render();
      return;
    }
    this.markPersisted(template);
    this.render();
  }

  private async saveDraft(useTemplate: boolean): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      draft.name = normalizedTemplateName(draft.name);
      const saved = await this.options.store.writeTemplate(draft);
      let active = await this.options.store.readActiveTemplate();
      if (useTemplate) {
        active = await this.options.store.setActiveTemplate(saved.id);
        this.activeTemplateId = active.id;
      } else if (active.id === saved.id) {
        active = saved;
      }
      await this.changed(active);
      this.templates = await this.options.store.listTemplates();
      this.markPersisted(saved);
      this.render();
      new Notice(
        useTemplate
          ? t("wordTemplate.notice.savedAndApplied", { name: saved.name })
          : t("wordTemplate.notice.saved", { name: saved.name })
      );
    } catch (error) {
      new Notice(t("wordTemplate.notice.saveFailed", { detail: errorMessage(error) }));
    }
  }

  private async resetDraft(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (
      this.isDirty() &&
      !(await this.confirm(t("wordTemplate.confirm.revert")))
    ) {
      return;
    }
    const stored = await this.options.store.readTemplate(draft.id);
    if (!stored) {
      new Notice(t("wordTemplate.notice.savedNotFound"));
      return;
    }
    this.markPersisted(stored);
    this.render();
  }

  private async createTemplate(): Promise<void> {
    if (
      this.isDirty() &&
      !(await this.confirm(t("wordTemplate.confirm.create")))
    ) {
      return;
    }
    const name = (
      await this.prompt(t("wordTemplate.prompt.newName"), t("wordTemplate.defaultNewName"))
    )?.trim();
    if (!name) return;
    try {
      const source =
        (await this.options.store.readTemplate("default")) ??
        (await this.options.store.readActiveTemplate());
      const created = await this.options.store.createTemplate(name, source);
      await this.reload(created.id);
    } catch (error) {
      new Notice(t("wordTemplate.notice.createFailed", { detail: errorMessage(error) }));
    }
  }

  private async duplicateTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    if (
      this.isDirty() &&
      !(await this.confirm(t("wordTemplate.confirm.duplicate")))
    ) {
      return;
    }
    const name = (
      await this.prompt(
        t("wordTemplate.prompt.duplicateName"),
        t("wordTemplate.copyName", { name: draft.name })
      )
    )?.trim();
    if (!name) return;
    try {
      const duplicate = await this.options.store.duplicateTemplate(
        draft.id,
        name
      );
      await this.reload(duplicate.id);
    } catch (error) {
      new Notice(t("wordTemplate.notice.duplicateFailed", { detail: errorMessage(error) }));
    }
  }

  private async renameTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    const name = (await this.prompt(t("wordTemplate.prompt.rename"), draft.name))?.trim();
    if (!name) return;
    try {
      const saved = await this.options.store.renameTemplate(draft.id, name);
      draft.name = saved.name;
      const active = await this.options.store.readActiveTemplate();
      await this.changed(active);
      this.templates = await this.options.store.listTemplates();
      this.persistedSnapshot = JSON.stringify(saved);
      this.updateDirtyState();
      this.schedulePreviewRender();
      this.render();
    } catch (error) {
      new Notice(t("wordTemplate.notice.renameFailed", { detail: errorMessage(error) }));
    }
  }

  private async deleteTemplate(): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.id === "default") return;
    if (this.templates.length <= 1) {
      new Notice(t("wordTemplate.notice.keepOne"));
      return;
    }
    if (!(await this.confirm(t("wordTemplate.confirm.delete", { name: draft.name })))) return;
    try {
      await this.options.store.deleteTemplate(draft.id);
      const active = await this.options.store.readActiveTemplate();
      await this.changed(active);
      await this.reload(active.id);
    } catch (error) {
      new Notice(t("wordTemplate.notice.deleteFailed", { detail: errorMessage(error) }));
    }
  }

  private async importJson(): Promise<void> {
    if (
      this.isDirty() &&
      !(await this.confirm(t("wordTemplate.confirm.import")))
    ) {
      return;
    }
    try {
      const [file] = await this.options.fileGateway.pickFiles({
        title: t("wordTemplate.import.pickTitle"),
        extensions: ["json"],
        maxFiles: 1,
        maxFileBytes: 5 * 1024 * 1024,
        maxTotalBytes: 5 * 1024 * 1024
      });
      if (!file) return;
      const imported = await this.options.store.importTemplateJson(
        new TextDecoder().decode(file.bytes)
      );
      await this.reload(imported.id);
      new Notice(t("wordTemplate.notice.imported", { name: imported.name }));
    } catch (error) {
      new Notice(t("wordTemplate.notice.importFailed", { detail: errorMessage(error) }));
    }
  }

  private async exportJson(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    try {
      const json = await this.options.store.exportTemplateJson(draft.id);
      const result = await this.options.fileGateway.saveFile(
        new TextEncoder().encode(json),
        safeTemplateFilename(draft)
      );
      if (!result.cancelled) {
        new Notice(t("wordTemplate.notice.exported", { file: result.fileName }));
      }
    } catch (error) {
      new Notice(t("wordTemplate.notice.exportFailed", { detail: errorMessage(error) }));
    }
  }

  private async discoverInstalledFonts(): Promise<void> {
    try {
      const result = await this.options.fontCatalog.discoverInstalledFonts();
      this.render();
      const count = result.entries.length.toLocaleString();
      new Notice(
        result.method === "local-font-access"
          ? t("wordFont.notice.installedLoaded", { count })
          : t("wordFont.notice.knownFound", { count })
      );
    } catch (error) {
      new Notice(
        t("wordFont.notice.installedFailed", { detail: errorMessage(error) })
      );
    }
  }

  private async importFontFiles(directory: boolean): Promise<void> {
    try {
      const imported = directory
        ? await this.options.fontCatalog.pickFontDirectory()
        : await this.options.fontCatalog.pickFontFiles();
      if (!imported.length) return;
      await this.options.fontCatalog.applyPreviewFonts(
        this.contentEl.ownerDocument
      );
      await this.options.onFontCatalogChanged?.();
      this.render();
      new Notice(t("wordFont.notice.added", { count: imported.length }));
    } catch (error) {
      new Notice(t("wordFont.notice.addFailed", { detail: errorMessage(error) }));
    }
  }

  private async removeCustomFont(
    entry: WordFontCatalogEntry
  ): Promise<void> {
    if (!this.options.fontCatalog.removeCustomFont(entry)) return;
    await this.options.onFontCatalogChanged?.();
    this.render();
    new Notice(t("wordFont.notice.removed", { family: entry.family }));
  }

  private async changed(active: WordTemplateSpec): Promise<void> {
    await this.options.onChanged?.(cloneWordTemplate(active));
  }
}
