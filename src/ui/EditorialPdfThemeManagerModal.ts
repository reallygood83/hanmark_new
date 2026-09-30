import { type App, Modal, Notice } from "obsidian";
import type { FileGateway } from "../io/fileGateway";
import {
  BUILTIN_EDITORIAL_PDF_THEME_ID,
  EDITORIAL_PDF_THEME_LIMITS,
  EDITORIAL_PDF_THEME_MAX_JSON_BYTES,
  activeEditorialPdfThemeSnapshot,
  availableEditorialPdfThemeName,
  canonicalEditorialPdfHex,
  createEditorialPdfTheme,
  deleteEditorialPdfTheme,
  duplicateEditorialPdfTheme,
  editorialPdfContrastGuidance,
  editorialPdfContrastStatus,
  editorialPdfThemeDisplayName,
  formatEditorialPdfContrastRatio,
  listEditorialPdfThemeSnapshots,
  normalizeEditorialPdfTheme,
  parseEditorialPdfThemeExchange,
  renameEditorialPdfTheme,
  resolveEditorialPdfTheme,
  resolveEditorialPdfThemeSnapshot,
  setActiveEditorialPdfTheme,
  stringifyEditorialPdfThemeExchange,
  updateEditorialPdfTheme,
  type EditorialPdfContrastDiagnostic,
  type EditorialPdfOverrideToken,
  type EditorialPdfThemeLibraryV1,
  type EditorialPdfThemeSnapshot,
  type EditorialPdfThemeV1,
  type EditorialPdfTitleMode,
  type ResolvedEditorialPdfTheme
} from "../io/editorialPdfTheme";
import { t, tKey, type MessageKey } from "../i18n";
import { errorMessage } from "../utils/errors";

export interface EditorialPdfThemeManagerOptions {
  fileGateway: FileGateway;
  getLibrary(): EditorialPdfThemeLibraryV1;
  replaceLibrary(library: EditorialPdfThemeLibraryV1): Promise<void>;
  onChanged?(): void;
  selectedId?: string;
  startInCreate?: boolean;
}

interface BuilderOptions {
  initialName: string;
  initialTheme: EditorialPdfThemeV1;
  previewFileTitle: string;
  title: string;
  save(name: string, theme: EditorialPdfThemeV1): Promise<void>;
}

type ThemeTextSection = "cover" | "page";

const OVERRIDE_LABELS: ReadonlyArray<{
  token: EditorialPdfOverrideToken;
  label: MessageKey;
  description: MessageKey;
}> = [
  {
    token: "onKey",
    label: "pdfTheme.role.onKey.name",
    description: "pdfTheme.role.onKey.desc"
  },
  {
    token: "keyInk",
    label: "pdfTheme.role.keyInk.name",
    description: "pdfTheme.role.keyInk.desc"
  },
  {
    token: "accentLine",
    label: "pdfTheme.role.accentLine.name",
    description: "pdfTheme.role.accentLine.desc"
  }
];

let controlSequence = 0;

function nextControlId(stem: string): string {
  controlSequence += 1;
  return `hanmark-pdf-theme-${stem}-${controlSequence}`;
}

function safeThemeFilename(snapshot: EditorialPdfThemeSnapshot): string {
  const stem = Array.from(snapshot.name, (character) => {
    const code = character.charCodeAt(0);
    return "\\/:*?\"<>|".includes(character) || code <= 31 || code === 127
      ? "_"
      : character;
  }).join("").trim() || "hanmark-pdf-theme";
  return `${stem}.hanmark-pdf-theme.json`;
}

function themeTitle(
  mode: EditorialPdfTitleMode,
  custom: string,
  fileTitle: string
): string {
  if (mode === "blank") return "";
  return mode === "custom" ? custom : fileTitle;
}

function applyPalette(
  element: HTMLElement,
  resolved: ResolvedEditorialPdfTheme
): void {
  const { palette } = resolved;
  element.style.setProperty("--hanmark-pdf-preview-key", palette.keySurface);
  element.style.setProperty(
    "--hanmark-pdf-preview-key-text-surface",
    palette.keyTextSurface
  );
  element.style.setProperty("--hanmark-pdf-preview-on-key", palette.onKey);
  element.style.setProperty("--hanmark-pdf-preview-key-ink", palette.keyInk);
  element.style.setProperty(
    "--hanmark-pdf-preview-muted-ink",
    palette.keyMutedInk
  );
  element.style.setProperty("--hanmark-pdf-preview-accent", palette.accentLine);
  element.style.setProperty("--hanmark-pdf-preview-tint", palette.softTint);
  element.style.setProperty("--hanmark-pdf-preview-body", palette.bodyInk);
  element.style.setProperty("--hanmark-pdf-preview-border", palette.border);
}

function diagnosticLabel(item: EditorialPdfContrastDiagnostic): string {
  const label = OVERRIDE_LABELS.find(({ token }) => token === item.token)?.label;
  return label ? tKey(label) : item.token;
}

function renderColorChoiceExplanation(
  root: HTMLElement,
  resolved: ResolvedEditorialPdfTheme
): void {
  const details = root.createEl("details", {
    cls: "hanmark-pdf-theme-contrast-explanation"
  });
  details.createEl("summary", { text: t("pdfTheme.explain.summary") });
  const { onKeyResolution: resolution } = resolved;
  let explanation: string;
  switch (resolution.strategy) {
    case "builtin":
      explanation = t("pdfTheme.explain.builtin");
      break;
    case "manual-exact":
      explanation = t("pdfTheme.explain.manual");
      break;
    case "automatic-adjusted":
      explanation = t("pdfTheme.explain.adjusted", {
        seed: resolution.seed,
        surface: resolution.surface
      });
      break;
    case "automatic-wcag-fallback":
      explanation = t("pdfTheme.explain.fallback");
      break;
    case "automatic-exact":
      explanation = t("pdfTheme.explain.exact");
      break;
  }
  details.createEl("p", { text: explanation });
  details.createEl("p", {
    text: t("pdfTheme.explain.wcagScope")
  });
  details.createEl("p", {
    text: t("pdfTheme.explain.rendering")
  });
}

function renderDiagnostics(
  root: HTMLElement,
  resolved: ResolvedEditorialPdfTheme
): void {
  root.empty();
  const failing = resolved.diagnostics.filter(
    (item) => item.enforced && !item.passes
  );
  root.addClass(failing.length ? "has-warning" : "is-safe");
  root.removeClass(failing.length ? "is-safe" : "has-warning");
  const liveStatus = root.createDiv({
    cls: "hanmark-pdf-theme-diagnostic-status",
    attr: {
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    }
  });
  liveStatus.createEl("strong", { text: editorialPdfContrastStatus(resolved) });
  const list = root.createEl("ul");
  for (const item of resolved.diagnostics) {
    list.createEl("li", {
      text: t("pdfTheme.diagnostic.row", {
        label: diagnosticLabel(item),
        ratio: formatEditorialPdfContrastRatio(item.ratio),
        guidance: editorialPdfContrastGuidance(item),
        source: item.manual ? t("pdfTheme.source.manual") : t("pdfTheme.source.automatic")
      })
    });
  }
  const hasMinimumBoundaryText = resolved.diagnostics.some(
    (item) => item.token !== "accentLine" && item.ratio >= 4.5 && item.ratio < 7
  );
  if (hasMinimumBoundaryText) {
    root.createEl("p", {
      text: t("pdfTheme.diagnostic.minimumNote")
    });
  }
  const hasLargeTextOnly = resolved.diagnostics.some(
    (item) => item.token !== "accentLine" && item.ratio >= 3 && item.ratio < 4.5
  );
  if (hasLargeTextOnly) {
    root.createEl("p", {
      text: t("pdfTheme.diagnostic.largeTextNote")
    });
  }
  if (failing.length) {
    root.createEl("p", {
      text: t("pdfTheme.diagnostic.manualNote")
    });
  }
  renderColorChoiceExplanation(root, resolved);
}

function renderPreview(
  root: HTMLElement,
  theme: EditorialPdfThemeV1,
  resolved: ResolvedEditorialPdfTheme,
  previewFileTitle: string
): void {
  root.empty();
  applyPalette(root, resolved);
  const cover = root.createDiv({ cls: "hanmark-pdf-theme-preview-cover" });
  const coverTop = cover.createDiv({ cls: "hanmark-pdf-theme-preview-cover-top" });
  coverTop.createSpan({
    cls: "hanmark-pdf-theme-preview-cover-kicker",
    text: theme.cover.kicker
  });
  coverTop.createSpan({
    cls: "hanmark-pdf-theme-preview-cover-edition",
    text: theme.cover.edition
  });
  coverTop.createEl("strong", {
    cls: "hanmark-pdf-theme-preview-cover-title",
    text: themeTitle(
      theme.cover.titleMode,
      theme.cover.titleText,
      previewFileTitle
    )
  });
  coverTop.createSpan({
    cls: "hanmark-pdf-theme-preview-cover-subtitle",
    text: theme.cover.subtitle
  });
  const coverBody = cover.createDiv({ cls: "hanmark-pdf-theme-preview-cover-body" });
  coverBody.createEl("b", {
    cls: "hanmark-pdf-theme-preview-cover-brand",
    text: theme.cover.brand
  });
  coverBody.createEl("strong", {
    cls: "hanmark-pdf-theme-preview-cover-system",
    text: theme.cover.system
  });
  coverBody.createSpan({
    cls: "hanmark-pdf-theme-preview-cover-detail",
    text: theme.cover.detail
  });
  const tags = coverBody.createDiv({ cls: "hanmark-pdf-theme-preview-tags" });
  for (const tag of theme.cover.tags.filter(Boolean)) {
    tags.createSpan({ text: tag });
  }

  const page = root.createDiv({ cls: "hanmark-pdf-theme-preview-page" });
  const header = page.createDiv({ cls: "hanmark-pdf-theme-preview-header" });
  header.createSpan({ text: theme.page.headerLeft });
  header.createSpan({
    text: themeTitle(
      theme.page.headerRightMode,
      theme.page.headerRightText,
      previewFileTitle
    )
  });
  const body = page.createDiv({ cls: "hanmark-pdf-theme-preview-body" });
  body.createEl("h3", { text: t("pdfTheme.preview.heading") });
  body.createEl("p", {
    text: t("pdfTheme.preview.body")
  });
  const codeBlock = body.createEl("pre");
  codeBlock.createEl("code", { text: "const theme = \"readable\";" });
  const footer = page.createDiv({ cls: "hanmark-pdf-theme-preview-footer" });
  footer.createSpan({ text: theme.page.footerLeft });
  footer.createSpan({ text: theme.page.showPageNumber ? "16" : "" });
}

class ConfirmThemeDeleteModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly name: string,
    private readonly finish: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("pdfTheme.delete.title"));
    this.contentEl.createEl("p", {
      text: t("pdfTheme.delete.message", { name: this.name })
    });
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.onclick = () => this.complete(false);
    const remove = actions.createEl("button", {
      text: t("pdfTheme.manager.delete"),
      cls: "mod-warning",
      attr: { type: "button" }
    });
    remove.onclick = () => this.complete(true);
    window.setTimeout(() => cancel.focus());
  }

  onClose(): void {
    if (!this.settled) this.finish(false);
    this.contentEl.empty();
  }

  private complete(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.finish(value);
    this.close();
  }
}

function confirmThemeDelete(app: App, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmThemeDeleteModal(app, name, resolve).open();
  });
}

class PdfThemeNameModal extends Modal {
  private value: string;
  private saving = false;

  constructor(
    app: App,
    title: string,
    initial: string,
    private readonly saveName: (value: string) => Promise<void>
  ) {
    super(app);
    this.titleEl.setText(title);
    this.value = initial;
  }

  onOpen(): void {
    const id = nextControlId("name");
    const label = this.contentEl.createEl("label", {
      text: t("pdfTheme.name.label"),
      attr: { for: id }
    });
    label.addClass("hanmark-pdf-theme-field-label");
    const input = this.contentEl.createEl("input", {
      type: "text",
      value: this.value,
      attr: { id }
    });
    input.maxLength = EDITORIAL_PDF_THEME_LIMITS.name * 2;
    input.oninput = () => (this.value = input.value);
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.submit(input);
      }
    };
    const actions = this.contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const cancel = actions.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", {
      text: t("common.confirm"),
      cls: "mod-cta",
      attr: { type: "button" }
    });
    save.onclick = () => void this.submit(input);
    window.setTimeout(() => {
      input.focus();
      input.select();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(input: HTMLInputElement): Promise<void> {
    if (this.saving) return;
    if (!this.value.trim()) {
      input.setAttribute("aria-invalid", "true");
      new Notice(t("pdfTheme.name.required"));
      input.focus();
      return;
    }
    this.saving = true;
    try {
      await this.saveName(this.value);
      this.close();
    } catch (error) {
      this.saving = false;
      new Notice(t("pdfTheme.name.saveFailed", { detail: errorMessage(error) }));
      input.focus();
    }
  }
}

export class EditorialPdfThemeBuilderModal extends Modal {
  private readonly draft: EditorialPdfThemeV1;
  private readonly overrideInputs: Record<EditorialPdfOverrideToken, string>;
  private name: string;
  private keyInput: string;
  private step = 0;
  private saving = false;

  constructor(
    app: App,
    private readonly options: BuilderOptions
  ) {
    super(app);
    this.name = options.initialName;
    this.draft = normalizeEditorialPdfTheme(options.initialTheme);
    this.keyInput = this.draft.colors.key;
    this.overrideInputs = {
      onKey: this.draft.colors.overrides.onKey ?? "",
      keyInk: this.draft.colors.overrides.keyInk ?? "",
      accentLine: this.draft.colors.overrides.accentLine ?? ""
    };
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.modalEl.addClass("hanmark-pdf-theme-workspace-modal");
    this.render();
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.modalEl.removeClass("hanmark-pdf-theme-workspace-modal");
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText(this.options.title);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-pdf-theme-builder");
    const intro = contentEl.createDiv({ cls: "hanmark-pdf-theme-builder-intro" });
    intro.createEl("p", {
      text: t("pdfTheme.builder.intro")
    });
    this.renderStepNavigation(intro);

    const panel = contentEl.createDiv({
      cls: "hanmark-pdf-theme-builder-panel",
      attr: {
        role: "region",
        "aria-label": t("pdfTheme.builder.stepRegion", { step: this.step + 1 })
      }
    });
    if (this.step === 0) this.renderColorStep(panel);
    if (this.step === 1) this.renderTextStep(panel);
    if (this.step === 2) this.renderPreviewStep(panel);
    this.renderFooter(contentEl);
    window.setTimeout(() => {
      contentEl.querySelector<HTMLElement>("[data-hanmark-autofocus]")?.focus();
    });
  }

  private renderStepNavigation(root: HTMLElement): void {
    const nav = root.createDiv({
      cls: "hanmark-pdf-theme-steps",
      attr: { "aria-label": t("pdfTheme.builder.steps") }
    });
    for (const [index, label] of [
      t("pdfTheme.builder.step.color"),
      t("pdfTheme.builder.step.text"),
      t("pdfTheme.builder.step.preview")
    ].entries()) {
      const button = nav.createEl("button", {
        text: label,
        attr: {
          type: "button",
          "aria-current": this.step === index ? "step" : "false"
        }
      });
      button.disabled = index > this.step && !this.validThrough(index - 1);
      button.onclick = () => {
        if (button.disabled) return;
        this.step = index;
        this.render();
      };
    }
  }

  private renderColorStep(root: HTMLElement): void {
    root.createEl("h3", { text: t("pdfTheme.builder.color.heading") });
    root.createEl("p", {
      text: t("pdfTheme.builder.color.desc")
    });
    this.renderNameField(root);

    const field = root.createDiv({ cls: "hanmark-pdf-theme-color-field" });
    const id = nextControlId("key-color");
    field.createEl("label", {
      text: t("pdfTheme.field.keyColor"),
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const picker = field.createEl("input", {
      type: "color",
      value: this.draft.colors.key,
      attr: {
        id,
        "aria-label": t("pdfTheme.builder.color.picker"),
        "data-hanmark-autofocus": "true"
      }
    });
    const hex = field.createEl("input", {
      type: "text",
      value: this.keyInput,
      attr: {
        "aria-label": t("pdfTheme.builder.color.hex"),
        spellcheck: "false",
        inputmode: "text"
      }
    });
    hex.maxLength = 7;
    const help = field.createEl("small", {
      text: t("pdfTheme.builder.color.help")
    });
    const diagnostic = root.createDiv({ cls: "hanmark-pdf-theme-diagnostics" });
    const refresh = (): void => {
      const canonical = canonicalEditorialPdfHex(this.keyInput);
      const invalid = canonical === null;
      hex.setAttribute("aria-invalid", String(invalid));
      help.setText(
        invalid
          ? t("pdfTheme.builder.color.invalid")
          : t("pdfTheme.builder.color.valid", { color: canonical })
      );
      if (!canonical) {
        diagnostic.empty();
        diagnostic.addClass("has-warning");
        diagnostic.removeClass("is-safe");
        const status = diagnostic.createDiv({
          attr: {
            role: "status",
            "aria-live": "polite",
            "aria-atomic": "true"
          }
        });
        status.createEl("strong", { text: t("pdfTheme.builder.color.enterHex") });
        return;
      }
      this.draft.colors.key = canonical;
      picker.value = canonical;
      renderDiagnostics(diagnostic, resolveEditorialPdfTheme(this.draft));
    };
    picker.oninput = () => {
      this.keyInput = picker.value.toUpperCase();
      hex.value = this.keyInput;
      refresh();
    };
    hex.oninput = () => {
      this.keyInput = hex.value;
      refresh();
    };
    refresh();
  }

  private renderNameField(root: HTMLElement): void {
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    const id = nextControlId("builder-name");
    field.createEl("label", {
      text: t("pdfTheme.name.label"),
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: this.name,
      attr: { id }
    });
    input.maxLength = EDITORIAL_PDF_THEME_LIMITS.name * 2;
    input.oninput = () => {
      this.name = input.value;
      input.setAttribute("aria-invalid", String(!this.name.trim()));
    };
  }

  private renderTextStep(root: HTMLElement): void {
    const heading = root.createEl("h3", {
      text: t("pdfTheme.builder.text.heading")
    });
    heading.tabIndex = -1;
    heading.setAttribute("data-hanmark-autofocus", "true");
    root.createEl("p", {
      text: t("pdfTheme.builder.text.desc")
    });
    const columns = root.createDiv({ cls: "hanmark-pdf-theme-text-columns" });
    const cover = columns.createDiv();
    cover.createEl("h4", { text: t("pdfTheme.builder.text.cover") });
    this.textField(cover, t("pdfTheme.builder.text.kicker"), "cover", "kicker", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, t("pdfTheme.builder.text.edition"), "cover", "edition", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.titleModeField(cover, t("pdfTheme.field.coverTitle"), "cover");
    this.textField(cover, t("pdfTheme.builder.text.subtitle"), "cover", "subtitle", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, t("pdfTheme.builder.text.brand"), "cover", "brand", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, t("pdfTheme.builder.text.system"), "cover", "system", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.textField(cover, t("pdfTheme.builder.text.detail"), "cover", "detail", EDITORIAL_PDF_THEME_LIMITS.coverText);
    this.tagsField(cover);

    const page = columns.createDiv();
    page.createEl("h4", { text: t("pdfTheme.builder.text.pages") });
    this.textField(page, t("pdfTheme.field.headerLeft"), "page", "headerLeft", EDITORIAL_PDF_THEME_LIMITS.pageText);
    this.titleModeField(page, t("pdfTheme.field.headerRight"), "page");
    this.textField(page, t("pdfTheme.field.footerLeft"), "page", "footerLeft", EDITORIAL_PDF_THEME_LIMITS.pageText);
    const id = nextControlId("page-number");
    const toggle = page.createEl("label", {
      cls: "hanmark-pdf-theme-toggle",
      attr: { for: id }
    });
    const checkbox = toggle.createEl("input", {
      type: "checkbox",
      attr: { id }
    });
    checkbox.checked = this.draft.page.showPageNumber;
    checkbox.onchange = () => {
      this.draft.page.showPageNumber = checkbox.checked;
    };
    toggle.createSpan({ text: t("pdfTheme.builder.text.pageNumber") });
  }

  private textField(
    root: HTMLElement,
    labelText: string,
    section: ThemeTextSection,
    key: string,
    maximum: number
  ): void {
    const values = this.draft[section] as unknown as Record<string, unknown>;
    const current = values[key];
    if (typeof current !== "string") return;
    const id = nextControlId(`${section}-${String(key)}`);
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    field.createEl("label", {
      text: labelText,
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: current,
      attr: { id }
    });
    input.maxLength = maximum * 2;
    input.oninput = () => {
      values[key] = input.value;
    };
    field.createEl("small", { text: t("pdfTheme.builder.text.limit", { count: maximum }) });
  }

  private titleModeField(
    root: HTMLElement,
    labelText: string,
    section: "cover" | "page"
  ): void {
    const mode = section === "cover"
      ? this.draft.cover.titleMode
      : this.draft.page.headerRightMode;
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    const id = nextControlId(`${section}-title-mode`);
    field.createEl("label", {
      text: labelText,
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const select = field.createEl("select", { attr: { id } });
    select.createEl("option", { value: "file-title", text: t("pdfTheme.builder.titleMode.file") });
    select.createEl("option", { value: "custom", text: t("pdfTheme.builder.titleMode.custom") });
    select.createEl("option", { value: "blank", text: t("pdfTheme.builder.titleMode.blank") });
    select.value = mode;
    if (mode === "custom") {
      const input = field.createEl("input", {
        type: "text",
        value: section === "cover"
          ? this.draft.cover.titleText
          : this.draft.page.headerRightText,
        attr: { "aria-label": t("pdfTheme.builder.titleMode.customInput", { label: labelText }) }
      });
      input.maxLength = section === "cover"
        ? EDITORIAL_PDF_THEME_LIMITS.coverTitle * 2
        : EDITORIAL_PDF_THEME_LIMITS.pageText * 2;
      input.oninput = () => {
        if (section === "cover") this.draft.cover.titleText = input.value;
        else this.draft.page.headerRightText = input.value;
      };
    }
    select.onchange = () => {
      const next = select.value as EditorialPdfTitleMode;
      if (section === "cover") this.draft.cover.titleMode = next;
      else this.draft.page.headerRightMode = next;
      this.render();
    };
  }

  private tagsField(root: HTMLElement): void {
    const id = nextControlId("tags");
    const field = root.createDiv({ cls: "hanmark-pdf-theme-text-field" });
    field.createEl("label", {
      text: t("pdfTheme.builder.text.tags"),
      cls: "hanmark-pdf-theme-field-label",
      attr: { for: id }
    });
    const input = field.createEl("input", {
      type: "text",
      value: this.draft.cover.tags.join(", "),
      attr: { id }
    });
    input.oninput = () => {
      this.draft.cover.tags = input.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, EDITORIAL_PDF_THEME_LIMITS.tagCount);
    };
    field.createEl("small", {
      text: t("pdfTheme.builder.text.tagsHint", { count: EDITORIAL_PDF_THEME_LIMITS.tagCount })
    });
  }

  private renderPreviewStep(root: HTMLElement): void {
    const heading = root.createEl("h3", {
      text: t("pdfTheme.builder.preview.heading")
    });
    heading.tabIndex = -1;
    heading.setAttribute("data-hanmark-autofocus", "true");
    root.createEl("p", {
      text: t("pdfTheme.builder.preview.desc")
    });
    const preview = root.createDiv({ cls: "hanmark-pdf-theme-preview" });
    const diagnostic = root.createDiv({ cls: "hanmark-pdf-theme-diagnostics" });
    const advanced = root.createEl("details", {
      cls: "hanmark-pdf-theme-advanced"
    });
    advanced.createEl("summary", { text: t("pdfTheme.builder.override.summary") });
    advanced.createEl("p", {
      text: t("pdfTheme.builder.override.desc")
    });
    for (const item of OVERRIDE_LABELS) {
      this.renderOverrideField(advanced, item.token, tKey(item.label), tKey(item.description));
    }
    const refresh = (): void => {
      const resolved = resolveEditorialPdfTheme(this.draft);
      renderPreview(
        preview,
        this.draft,
        resolved,
        this.options.previewFileTitle
      );
      renderDiagnostics(diagnostic, resolved);
    };
    refresh();
  }

  private renderOverrideField(
    root: HTMLElement,
    token: EditorialPdfOverrideToken,
    labelText: string,
    description: string
  ): void {
    const row = root.createDiv({ cls: "hanmark-pdf-theme-override" });
    row.createEl("strong", { text: labelText });
    row.createEl("small", { text: description });
    const active = this.draft.colors.overrides[token] !== null;
    if (!active) {
      const useCustom = row.createEl("button", {
        text: t("pdfTheme.builder.override.custom"),
        attr: { type: "button" }
      });
      useCustom.onclick = () => {
        const resolved = resolveEditorialPdfTheme(this.draft);
        const recommended = resolved.palette[token];
        this.draft.colors.overrides[token] = recommended;
        this.overrideInputs[token] = recommended;
        this.render();
      };
      return;
    }

    const id = nextControlId(`override-${token}`);
    const controls = row.createDiv({ cls: "hanmark-pdf-theme-override-controls" });
    const picker = controls.createEl("input", {
      type: "color",
      value: this.draft.colors.overrides[token] ?? "#000000",
      attr: { id, "aria-label": t("pdfTheme.builder.override.picker", { label: labelText }) }
    });
    const hex = controls.createEl("input", {
      type: "text",
      value: this.overrideInputs[token],
      attr: {
        "aria-label": t("pdfTheme.builder.override.hex", { label: labelText }),
        spellcheck: "false"
      }
    });
    hex.maxLength = 7;
    const reset = controls.createEl("button", {
      text: t("pdfTheme.builder.override.reset"),
      attr: { type: "button" }
    });
    const ratio = row.createSpan({ cls: "hanmark-pdf-theme-override-ratio" });
    const refresh = (): void => {
      const canonical = canonicalEditorialPdfHex(this.overrideInputs[token]);
      hex.setAttribute("aria-invalid", String(canonical === null));
      if (!canonical) {
        ratio.setText(t("pdfTheme.builder.override.invalid"));
        ratio.addClass("has-warning");
        return;
      }
      this.draft.colors.overrides[token] = canonical;
      picker.value = canonical;
      const result = resolveEditorialPdfTheme(this.draft);
      const item = result.diagnostics.find((entry) => entry.token === token);
      ratio.setText(
        item
          ? `${formatEditorialPdfContrastRatio(item.ratio)}:1 · ${editorialPdfContrastGuidance(item)}`
          : ""
      );
      ratio.toggleClass("has-warning", item ? !item.passes : false);
    };
    picker.oninput = () => {
      this.overrideInputs[token] = picker.value.toUpperCase();
      hex.value = this.overrideInputs[token];
      refresh();
    };
    picker.onchange = () => this.render();
    hex.oninput = () => {
      this.overrideInputs[token] = hex.value;
      refresh();
    };
    hex.onchange = () => this.render();
    reset.onclick = () => {
      this.draft.colors.overrides[token] = null;
      this.overrideInputs[token] = "";
      this.render();
    };
    refresh();
  }

  private renderFooter(root: HTMLElement): void {
    const footer = root.createDiv({ cls: "hanmark-pdf-theme-builder-footer" });
    const cancel = footer.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.disabled = this.saving;
    cancel.onclick = () => this.close();
    if (this.step > 0) {
      const previous = footer.createEl("button", {
        text: t("pdfTheme.builder.previous"),
        attr: { type: "button" }
      });
      previous.disabled = this.saving;
      previous.onclick = () => {
        this.step -= 1;
        this.render();
      };
    }
    if (this.step < 2) {
      const next = footer.createEl("button", {
        text: t("pdfTheme.builder.next"),
        cls: "mod-cta",
        attr: { type: "button" }
      });
      next.disabled = this.saving || !this.validThrough(this.step);
      next.onclick = () => {
        if (next.disabled) return;
        this.step += 1;
        this.render();
      };
    } else {
      const save = footer.createEl("button", {
        text: this.saving ? t("pdfTheme.builder.saving") : t("pdfTheme.builder.save"),
        cls: "mod-cta",
        attr: { type: "button" }
      });
      save.disabled = this.saving || !this.validThrough(2);
      save.onclick = () => void this.save();
    }
  }

  private validThrough(step: number): boolean {
    if (!this.name.trim() || !canonicalEditorialPdfHex(this.keyInput)) {
      return false;
    }
    if (step < 2) return true;
    return OVERRIDE_LABELS.every(({ token }) => {
      if (this.draft.colors.overrides[token] === null) return true;
      return canonicalEditorialPdfHex(this.overrideInputs[token]) !== null;
    });
  }

  private async save(): Promise<void> {
    if (this.saving || !this.validThrough(2)) return;
    this.saving = true;
    this.render();
    try {
      for (const { token } of OVERRIDE_LABELS) {
        if (this.draft.colors.overrides[token] === null) continue;
        const canonical = canonicalEditorialPdfHex(this.overrideInputs[token]);
        if (!canonical) throw new Error(t("pdfTheme.builder.overrideHexInvalid"));
        this.draft.colors.overrides[token] = canonical;
      }
      await this.options.save(
        this.name,
        normalizeEditorialPdfTheme(this.draft)
      );
      this.close();
    } catch (error) {
      this.saving = false;
      this.render();
      new Notice(t("pdfTheme.builder.saveFailed", { detail: errorMessage(error) }));
    }
  }
}

export class EditorialPdfThemeManagerModal extends Modal {
  private selectedId: string;
  private busy = false;

  constructor(
    app: App,
    private readonly options: EditorialPdfThemeManagerOptions
  ) {
    super(app);
    this.selectedId = options.selectedId
      ?? activeEditorialPdfThemeSnapshot(options.getLibrary()).id;
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-resizable-workspace-modal");
    this.modalEl.addClass("hanmark-pdf-theme-workspace-modal");
    this.render();
    if (this.options.startInCreate) {
      this.options.startInCreate = false;
      window.setTimeout(() => this.openBuilder());
    }
  }

  onClose(): void {
    this.modalEl.removeClass("hanmark-resizable-workspace-modal");
    this.modalEl.removeClass("hanmark-pdf-theme-workspace-modal");
    this.contentEl.empty();
  }

  private render(): void {
    this.titleEl.setText(t("pdfTheme.manager.title"));
    const library = this.options.getLibrary();
    const snapshots = listEditorialPdfThemeSnapshots(library);
    if (!snapshots.some(({ id }) => id === this.selectedId)) {
      this.selectedId = activeEditorialPdfThemeSnapshot(library).id;
    }
    const active = activeEditorialPdfThemeSnapshot(library);
    const selected = snapshots.find(({ id }) => id === this.selectedId)
      ?? active;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("hanmark-pdf-theme-manager");
    contentEl.createEl("p", {
      text: t("pdfTheme.manager.desc")
    });

    const list = contentEl.createDiv({
      cls: "hanmark-pdf-theme-list",
      attr: { role: "radiogroup", "aria-label": t("pdfTheme.manager.list") }
    });
    for (const snapshot of snapshots) {
      const resolved = resolveEditorialPdfThemeSnapshot(snapshot);
      const label = list.createEl("label", {
        cls:
          `hanmark-pdf-theme-row${snapshot.id === this.selectedId ? " is-selected" : ""}`
      });
      applyPalette(label, resolved);
      const radio = label.createEl("input", { type: "radio" });
      radio.name = "hanmark-editorial-pdf-theme";
      radio.value = snapshot.id;
      radio.checked = snapshot.id === this.selectedId;
      radio.disabled = this.busy;
      radio.onchange = () => {
        if (!radio.checked) return;
        this.selectedId = snapshot.id;
        this.render();
      };
      label.createSpan({
        cls: "hanmark-pdf-theme-swatch",
        attr: { "aria-hidden": "true" }
      });
      const info = label.createSpan({ cls: "hanmark-pdf-theme-row-copy" });
      info.createEl("strong", { text: editorialPdfThemeDisplayName(snapshot) });
      const rowStatus = snapshot.builtIn
        ? t("pdfTheme.manager.builtinRow")
        : editorialPdfContrastStatus(resolved);
      info.createEl("small", {
        text: rowStatus,
        attr: { title: rowStatus }
      });
      if (snapshot.id === active.id) {
        label.createSpan({ text: t("pdfTheme.manager.active"), cls: "hanmark-template-active" });
      }
    }

    const selectedResolved = resolveEditorialPdfThemeSnapshot(selected);
    const status = contentEl.createDiv({
      cls:
        `hanmark-pdf-theme-manager-status${selectedResolved.warnings.length ? " has-warning" : ""}`,
      attr: { role: "status", "aria-live": "polite" }
    });
    applyPalette(status, selectedResolved);
    status.createSpan({
      cls: "hanmark-pdf-theme-swatch",
      attr: { "aria-hidden": "true" }
    });
    status.createEl("strong", { text: editorialPdfThemeDisplayName(selected) });
    status.createSpan({
      text: selected.builtIn
        ? t("pdfTheme.manager.builtinStatus")
        : editorialPdfContrastStatus(selectedResolved)
    });

    this.renderSelectedActions(contentEl, selected, active.id);
    this.renderLibraryActions(contentEl);
  }

  private renderSelectedActions(
    root: HTMLElement,
    selected: EditorialPdfThemeSnapshot,
    activeId: string
  ): void {
    const actions = root.createDiv({ cls: "hanmark-pdf-theme-actions" });
    const apply = actions.createEl("button", {
      text: selected.id === activeId ? t("pdfTheme.manager.active") : t("pdfTheme.manager.apply"),
      cls: "mod-cta",
      attr: { type: "button" }
    });
    apply.disabled = this.busy || selected.id === activeId;
    apply.onclick = () => void this.applySelected(selected.id);

    const edit = actions.createEl("button", {
      text: selected.builtIn ? t("pdfTheme.manager.duplicateEdit") : t("pdfTheme.manager.edit"),
      attr: { type: "button" }
    });
    edit.disabled = this.busy;
    edit.onclick = () => this.openBuilder(selected);

    const duplicate = actions.createEl("button", {
      text: t("pdfTheme.manager.duplicate"),
      attr: { type: "button" }
    });
    duplicate.disabled = this.busy;
    duplicate.onclick = () => void this.duplicateSelected(selected);

    const exportButton = actions.createEl("button", {
      text: t("pdfTheme.manager.exportJson"),
      attr: { type: "button" }
    });
    exportButton.disabled = this.busy;
    exportButton.onclick = () => void this.exportSelected(selected);

    if (!selected.builtIn) {
      const rename = actions.createEl("button", {
        text: t("pdfTheme.manager.rename"),
        attr: { type: "button" }
      });
      rename.disabled = this.busy;
      rename.onclick = () => this.renameSelected(selected);
      const remove = actions.createEl("button", {
        text: t("pdfTheme.manager.delete"),
        cls: "mod-warning",
        attr: { type: "button" }
      });
      remove.disabled = this.busy;
      remove.onclick = () => void this.deleteSelected(selected);
    }
  }

  private renderLibraryActions(root: HTMLElement): void {
    const actions = root.createDiv({ cls: "hanmark-pdf-theme-library-actions" });
    const create = actions.createEl("button", {
      text: t("export.pdf.newTheme"),
      cls: "mod-cta",
      attr: { type: "button" }
    });
    create.disabled = this.busy;
    create.onclick = () => this.openBuilder();
    const importButton = actions.createEl("button", {
      text: t("pdfTheme.manager.importJson"),
      attr: { type: "button" }
    });
    importButton.disabled = this.busy;
    importButton.onclick = () => void this.importTheme();
    const close = actions.createEl("button", {
      text: t("common.close"),
      attr: { type: "button" }
    });
    close.disabled = this.busy;
    close.onclick = () => this.close();
  }

  private openBuilder(source?: EditorialPdfThemeSnapshot): void {
    const library = this.options.getLibrary();
    const isEdit = source && !source.builtIn;
    const initialName = isEdit
      ? source.name
      : availableEditorialPdfThemeName(
          library,
          source
            ? t("pdfTheme.copyName", { name: editorialPdfThemeDisplayName(source) })
            : t("pdfTheme.manager.newName")
        );
    const initialTheme = source?.theme
      ?? activeEditorialPdfThemeSnapshot(library).theme;
    new EditorialPdfThemeBuilderModal(this.app, {
      initialName,
      initialTheme,
      previewFileTitle:
        this.app.workspace.getActiveFile()?.basename.trim()
        || t("pdfTheme.builder.previewFileTitle"),
      title: isEdit ? t("pdfTheme.manager.editTitle") : t("pdfTheme.manager.newTitle"),
      save: async (name, theme) => {
        let next: EditorialPdfThemeLibraryV1;
        let selectedId: string;
        if (isEdit) {
          const updated = updateEditorialPdfTheme(
            this.options.getLibrary(),
            source.id,
            theme
          );
          const renamed = renameEditorialPdfTheme(
            updated.library,
            source.id,
            name
          );
          next = renamed.library;
          selectedId = source.id;
        } else {
          const created = createEditorialPdfTheme(
            this.options.getLibrary(),
            name,
            theme
          );
          next = created.library;
          selectedId = created.record.id;
        }
        await this.persist(next);
        this.selectedId = selectedId;
        this.render();
      }
    }).open();
  }

  private async applySelected(id: string): Promise<void> {
    await this.runBusy(async () => {
      await this.persist(setActiveEditorialPdfTheme(this.options.getLibrary(), id));
      this.selectedId = id;
      new Notice(t("pdfTheme.manager.applied"));
    });
  }

  private async duplicateSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    await this.runBusy(async () => {
      const result = duplicateEditorialPdfTheme(
        this.options.getLibrary(),
        selected.id
      );
      await this.persist(result.library);
      this.selectedId = result.record.id;
      new Notice(t("pdfTheme.manager.duplicated", { name: result.record.name }));
    });
  }

  private renameSelected(selected: EditorialPdfThemeSnapshot): void {
    new PdfThemeNameModal(
      this.app,
      t("pdfTheme.manager.renameTitle"),
      selected.name,
      async (name) => {
        const result = renameEditorialPdfTheme(
          this.options.getLibrary(),
          selected.id,
          name
        );
        await this.persist(result.library);
        this.selectedId = result.record.id;
        this.render();
      }
    ).open();
  }

  private async deleteSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    if (!(await confirmThemeDelete(this.app, selected.name))) return;
    await this.runBusy(async () => {
      const next = deleteEditorialPdfTheme(
        this.options.getLibrary(),
        selected.id
      );
      await this.persist(next);
      this.selectedId = activeEditorialPdfThemeSnapshot(next).id;
      new Notice(t("pdfTheme.manager.deleted", { name: selected.name }));
    });
  }

  private async importTheme(): Promise<void> {
    await this.runBusy(async () => {
      const [file] = await this.options.fileGateway.pickFiles({
        title: t("pdfTheme.manager.importTitle"),
        extensions: ["json"],
        maxFiles: 1,
        maxFileBytes: EDITORIAL_PDF_THEME_MAX_JSON_BYTES,
        maxTotalBytes: EDITORIAL_PDF_THEME_MAX_JSON_BYTES
      });
      if (!file) return;
      const exchange = parseEditorialPdfThemeExchange(file.bytes);
      const created = createEditorialPdfTheme(
        this.options.getLibrary(),
        exchange.name,
        exchange.theme
      );
      await this.persist(created.library);
      this.selectedId = created.record.id;
      new Notice(
        t("pdfTheme.manager.imported", { name: created.record.name })
      );
    });
  }

  private async exportSelected(
    selected: EditorialPdfThemeSnapshot
  ): Promise<void> {
    await this.runBusy(async () => {
      const json = stringifyEditorialPdfThemeExchange(
        selected.name,
        selected.theme
      );
      const result = await this.options.fileGateway.saveFile(
        new TextEncoder().encode(json),
        safeThemeFilename(selected)
      );
      if (!result.cancelled) {
        new Notice(t("pdfTheme.manager.exported", { fileName: result.fileName }));
      }
    });
  }

  private async persist(library: EditorialPdfThemeLibraryV1): Promise<void> {
    await this.options.replaceLibrary(library);
    this.options.onChanged?.();
  }

  private async runBusy(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      new Notice(t("pdfTheme.manager.failed", { detail: errorMessage(error) }));
    } finally {
      this.busy = false;
      if (this.contentEl.isConnected) this.render();
    }
  }
}

export function activeEditorialPdfThemeSummary(
  library: EditorialPdfThemeLibraryV1
): string {
  const snapshot = activeEditorialPdfThemeSnapshot(library);
  const resolved = resolveEditorialPdfThemeSnapshot(snapshot);
  if (snapshot.id === BUILTIN_EDITORIAL_PDF_THEME_ID) {
    return `${editorialPdfThemeDisplayName(snapshot)} · ${t("pdfTheme.manager.builtinStatus")}`;
  }
  return `${snapshot.name} · ${editorialPdfContrastStatus(resolved)}`;
}
