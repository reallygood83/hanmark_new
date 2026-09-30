import {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Platform,
  type ViewStateResult,
  type WorkspaceLeaf
} from "obsidian";
import type { DocxExportService, DocxSource } from "../io/docxExport";
import type { DocxPreviewMode } from "../legacy-port/settings";
import type { SavedFileResult } from "../io/fileGateway";
import { createUserInitiatedAction } from "../legacy-port/userProcess";
import type { WordTemplateStore } from "../legacy-port/wordTemplateStore";
import type {
  WordFontSpec,
  WordParagraphSpec,
  WordStyleId,
  WordStyleSpec,
  WordTemplateSpec
} from "../legacy-port/wordTypes";
import {
  calculateDocxPreviewFitPercent,
  isUserInitiatedFastPreviewTrigger,
  UserInitiatedDocxPackagePreview,
  type FastDocxPreviewTrigger
} from "./docxPackagePreview";
import { t } from "../i18n";
import type { EditorActivity } from "./editorActivity";
import { PreviewNav } from "./previewNav";
import { isPreviewZoom, PREVIEW_ZOOM_STEPS, stepZoom, type PreviewZoom } from "./previewIndex";

export const DOCX_PREVIEW_VIEW_TYPE = "hanmark-docx-preview";

export interface DocxPreviewViewOptions {
  exporter: DocxExportService;
  templateStore: WordTemplateStore;
  getPreviewMode: () => DocxPreviewMode;
  setPreviewMode?: (mode: DocxPreviewMode) => Promise<void>;
  getSource?: () => DocxSource | null;
  /** Loads only fonts that the user explicitly selected into the browser preview. */
  preparePreviewFonts?: (target: Document) => Promise<void>;
  /** After "Export DOCX" saved a file (recent exports, R-028). */
  onSaved?: (saved: SavedFileResult) => void;
  /** Cursor moves in Markdown editors, for following the cursor (R-028). Returns an unsubscribe function. */
  subscribeActivity?: (listener: (activity: EditorActivity) => void, delayMs: number) => () => void;
  /** Whether previews follow the cursor (R-028). */
  followCursor?: () => boolean;
  setFollowCursor?: (on: boolean) => Promise<void>;
}

/** A user scroll or click in the preview pauses following the cursor this long (ms). */
const FOLLOW_PAUSE = 1500;

const BODY_STYLE_IDS: readonly WordStyleId[] = [
  "Normal",
  "Body Text",
  "First Paragraph"
];

function toErrorMessage(error: unknown): string {
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

function activeDocxSource(view: DocxPreviewView): DocxSource | null {
  const markdownView = view.app.workspace.getActiveViewOfType(MarkdownView);
  if (!markdownView?.file) return null;
  return {
    markdown: markdownView.editor.getValue(),
    title: markdownView.file.basename,
    sourcePath: markdownView.file.path
  };
}

function cssFontFamily(font: WordFontSpec): string {
  const families = [
    font.eastAsiaFamily,
    font.family,
    font.asciiFamily,
    "Malgun Gothic",
    "sans-serif"
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `"${value.replace(/["\\]/g, "")}"`);
  return Array.from(new Set(families)).join(", ");
}

function lineHeight(paragraph: WordParagraphSpec): string {
  if (paragraph.lineSpacingMode === "single") return "1";
  if (paragraph.lineSpacingMode === "multiple") {
    return String(Math.max(0.5, paragraph.lineSpacingValue));
  }
  return `${Math.max(1, paragraph.lineSpacingValue)}pt`;
}

function applyFont(element: HTMLElement, font: WordFontSpec | undefined): void {
  if (!font) return;
  element.style.fontFamily = cssFontFamily(font);
  element.style.fontSize = `${font.sizePt}pt`;
  element.style.fontWeight = font.bold ? "700" : "400";
  element.style.fontStyle = font.italic ? "italic" : "normal";
  element.style.textDecorationLine =
    font.underline === "none" ? "none" : "underline";
  if (font.color && /^#[0-9A-Fa-f]{6}$/.test(font.color)) {
    element.style.color = font.color;
  }
  if (font.charSpacingPt !== undefined) {
    element.style.letterSpacing = `${font.charSpacingPt}pt`;
  }
}

function applyParagraph(
  element: HTMLElement,
  paragraph: WordParagraphSpec | undefined
): void {
  if (!paragraph) return;
  element.style.textAlign =
    paragraph.align === "justify" ? "justify" : paragraph.align;
  element.style.lineHeight = lineHeight(paragraph);
  element.style.marginLeft = `${paragraph.leftIndentPt}pt`;
  element.style.marginRight = `${paragraph.rightIndentPt}pt`;
  element.style.textIndent = `${paragraph.firstLineIndentPt}pt`;
  element.style.marginTop = `${paragraph.spacingBeforePt}pt`;
  element.style.marginBottom = `${paragraph.spacingAfterPt}pt`;
  element.toggleClass(
    "hanmark-docx-page-break-before",
    paragraph.pageBreakBefore === true
  );
  element.toggleClass(
    "hanmark-docx-keep-with-next",
    paragraph.keepWithNext === true
  );
}

function applyStyle(element: HTMLElement, style: WordStyleSpec | undefined): void {
  if (!style) return;
  applyFont(element, style.font);
  applyParagraph(element, style.paragraph);
}

function elements(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter(
    (element): element is HTMLElement => element.instanceOf(HTMLElement)
  );
}

function effectiveBodyStyle(template: WordTemplateSpec): WordStyleSpec | undefined {
  for (const id of BODY_STYLE_IDS) {
    const style = template.styles[id];
    if (style) return style;
  }
  return undefined;
}

/** Applies Word-template semantics to an Obsidian-rendered Markdown tree. */
export function applyWordTemplatePreview(
  paper: HTMLElement,
  content: HTMLElement,
  template: WordTemplateSpec
): void {
  const page = template.page;
  paper.style.width = `${page.widthPt}pt`;
  paper.style.minHeight = `${page.heightPt}pt`;
  paper.style.padding =
    `${page.marginTopPt}pt ${page.marginRightPt}pt ` +
    `${page.marginBottomPt}pt ${page.marginLeftPt}pt`;

  const bodyStyle = effectiveBodyStyle(template);
  applyStyle(content, bodyStyle);
  for (const element of elements(content, "p, li")) applyStyle(element, bodyStyle);
  for (const element of elements(content, "blockquote")) {
    applyStyle(element, template.styles["Block Text"]);
  }
  for (const element of elements(content, "pre, code")) {
    applyStyle(element, template.styles["Source Code"]);
  }
  for (const element of elements(content, "table, th, td")) {
    applyStyle(element, template.styles.Table);
  }
  for (let level = 1; level <= 6; level += 1) {
    const id = `Heading ${level}` as WordStyleId;
    for (const element of elements(content, `h${level}`)) {
      applyStyle(element, template.styles[id]);
    }
  }
}

export class DocxPreviewView extends ItemView {
  private readonly options: DocxPreviewViewOptions;
  private readonly fastPreview: UserInitiatedDocxPackagePreview<
    DocxSource,
    ReturnType<typeof createUserInitiatedAction>
  >;
  private previewEl: HTMLElement | null = null;
  private modeSelect: HTMLSelectElement | null = null;
  private statusEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private renderVersion = 0;
  private objectUrl: string | null = null;
  private renderedSourceKey: string | null = null;
  private nav: PreviewNav | null = null;
  private flowEl: HTMLElement | null = null;
  /** null fits the pane width; else a manual zoom step, kept per pane (R-028). */
  private zoom: PreviewZoom | null = null;
  /** The note on screen: redrawing the same note keeps the scroll position (R-028). */
  private shownPath: string | null = null;
  private lastUserScroll = 0;
  private scrollFrame: number | null = null;

  constructor(leaf: WorkspaceLeaf, options: DocxPreviewViewOptions) {
    super(leaf);
    this.options = options;
    this.fastPreview = new UserInitiatedDocxPackagePreview(
      (source, action) =>
        this.options.exporter.buildDocxBytesUserInitiated(source, action)
    );
  }

  getViewType(): string {
    return DOCX_PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("docxPreview.title");
  }

  getIcon(): string {
    return "file-text";
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), zoom: this.zoom };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const zoom = state && typeof state === "object" ? (state as { zoom?: unknown }).zoom : undefined;
    this.zoom = isPreviewZoom(zoom) ? zoom : null;
    this.updatePreviewFit();
    this.syncNav();
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    content.addClass("hanmark-docx-preview-container", "docx-preview-container");

    const toolbar = content.createDiv({ cls: "hanmark-docx-preview-toolbar" });
    toolbar.createSpan({
      cls: "hanmark-docx-preview-label",
      text: t("docxPreview.label")
    });
    this.statusEl = toolbar.createSpan({
      cls: "hanmark-docx-preview-status",
      text: t("docxPreview.status.semantic"),
      attr: {
        role: "status",
        "aria-live": "polite",
        "aria-atomic": "true",
        "data-state": "semantic"
      }
    });

    const mode = toolbar.createEl("select", {
      attr: { "aria-label": t("settings.docx.previewMode.name") }
    });
    this.modeSelect = mode;
    mode.createEl("option", { text: t("settings.docx.previewMode.fast"), value: "fast-docx" });
    mode.createEl("option", { text: t("settings.docx.previewMode.wordPdf"), value: "word-pdf" });
    mode.value = this.options.getPreviewMode();
    mode.disabled = !this.options.setPreviewMode;
    mode.addEventListener("change", () => {
      const selected: DocxPreviewMode =
        mode.value === "word-pdf" ? "word-pdf" : "fast-docx";
      void this.changeMode(selected);
    });

    const refreshButton = toolbar.createEl("button", {
      text: t("docxPreview.refresh"),
      attr: { type: "button" }
    });
    refreshButton.addEventListener("click", () => {
      if (this.options.getPreviewMode() === "word-pdf") {
        void this.renderExactPreview();
      } else {
        void this.handleFastPreviewTrigger("toolbar-refresh");
      }
    });

    const saveButton = toolbar.createEl("button", {
      text: t("docxPreview.save"),
      attr: { type: "button" }
    });
    saveButton.addEventListener("click", () => void this.exportDocx());
    this.flowEl = toolbar.createDiv({ cls: "hanmark-flow-line", attr: { "aria-hidden": "true" } });

    // Pages (real DOCX), zoom, and following the cursor (R-028).
    const setFollow = this.options.setFollowCursor;
    this.nav = new PreviewNav(content, {
      page: (delta) => this.movePage(delta),
      zoom: (direction) => this.changeZoom(direction),
      follow: setFollow && this.options.subscribeActivity ? (on) => void setFollow(on) : undefined,
      status: false
    });
    this.nav.el.addClass("hanmark-docx-preview-nav");

    this.previewEl = content.createDiv({
      cls: "hanmark-docx-preview-content docx-preview-content"
    });
    const previewEl = this.previewEl;
    this.registerDomEvent(previewEl, "scroll", () => {
      if (this.scrollFrame !== null) return;
      this.scrollFrame = previewEl.win.requestAnimationFrame(() => {
        this.scrollFrame = null;
        this.syncPages();
      });
    }, { passive: true });
    const touched = (): void => {
      this.lastUserScroll = Date.now();
    };
    this.registerDomEvent(previewEl, "wheel", touched, { passive: true });
    this.registerDomEvent(previewEl, "pointerdown", touched, { passive: true });
    this.registerDomEvent(previewEl, "keydown", touched);
    const unsubscribe = this.options.subscribeActivity?.((activity) => this.follow(activity), 200);
    if (unsubscribe) this.register(unsubscribe);
    this.installPreviewFitObserver();
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        if (this.options.getPreviewMode() === "word-pdf") {
          this.markExactPreviewStale();
        } else {
          void this.handleFastPreviewTrigger("document-change");
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (
          this.options.getPreviewMode() === "fast-docx" &&
          this.activeSourceChanged()
        ) {
          void this.handleFastPreviewTrigger("active-document-change");
        }
      })
    );
    await this.handleFastPreviewTrigger("view-open");
  }

  /**
   * Starts the external preview only after the caller has received a direct
   * user gesture. Workspace restoration calls onOpen(), but never this method.
   */
  async showUserInitiatedPreview(): Promise<void> {
    if (this.options.getPreviewMode() === "word-pdf") {
      await this.renderExactPreview();
      return;
    }
    await this.handleFastPreviewTrigger("explicit-open");
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.revokeObjectUrl();
    if (this.scrollFrame !== null) this.previewEl?.win.cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    this.previewEl = null;
    this.modeSelect = null;
    this.statusEl = null;
    this.renderedSourceKey = null;
    this.nav = null;
    this.flowEl = null;
    this.shownPath = null;
  }

  /** Redraws the navigation row only (the follow setting changed elsewhere). */
  refreshControls(): void {
    this.syncNav();
  }

  forceRefresh(): void {
    if (this.options.getPreviewMode() === "word-pdf") {
      this.markExactPreviewStale();
    } else {
      void this.handleFastPreviewTrigger("template-change");
    }
  }

  private source(): DocxSource | null {
    return this.options.getSource?.() ?? activeDocxSource(this);
  }

  private sourceKey(source: DocxSource | null = this.source()): string | null {
    if (!source) return null;
    return `${source.sourcePath ?? ""}\u0000${source.markdown}`;
  }

  private activeSourceChanged(): boolean {
    return (
      this.renderedSourceKey !== null &&
      this.sourceKey() !== this.renderedSourceKey
    );
  }

  private setPreviewStatus(
    text:
      | "docxPreview.status.building"
      | "docxPreview.status.actual"
      | "docxPreview.status.semantic"
      | "docxPreview.status.stale"
      | "docxPreview.status.exact",
    state: "building" | "actual" | "semantic" | "stale" | "exact"
  ): void {
    if (this.flowEl) this.flowEl.dataset.active = String(state === "building");
    if (!this.statusEl) return;
    this.statusEl.setText(t(text));
    this.statusEl.dataset.state = state;
  }

  private installPreviewFitObserver(): void {
    const preview = this.previewEl;
    if (!preview || typeof ResizeObserver === "undefined") return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.updatePreviewFit());
    this.resizeObserver.observe(preview);
  }

  private updatePreviewFit(): void {
    const preview = this.previewEl;
    if (!preview) return;
    // A manual zoom stays until "fit width" is chosen again (R-028).
    if (this.zoom !== null) {
      preview.dataset.fit = String(this.zoom);
      return;
    }
    preview.dataset.fit = "100";
    const page = preview.querySelector<HTMLElement>(
      ".docx-preview-docx section.docx, .hanmark-docx-preview-paper"
    );
    if (!page) return;

    const view = preview.ownerDocument.defaultView;
    const previewStyle = view?.getComputedStyle(preview);
    const horizontalPadding =
      Number.parseFloat(previewStyle?.paddingLeft ?? "0") +
      Number.parseFloat(previewStyle?.paddingRight ?? "0");
    let pageWidth = page.getBoundingClientRect().width;
    const wrapper = page.closest<HTMLElement>(".docx-wrapper");
    if (wrapper) {
      const wrapperStyle = view?.getComputedStyle(wrapper);
      pageWidth +=
        Number.parseFloat(wrapperStyle?.paddingLeft ?? "0") +
        Number.parseFloat(wrapperStyle?.paddingRight ?? "0");
    }
    preview.dataset.fit = String(
      calculateDocxPreviewFitPercent(
        Math.max(0, preview.clientWidth - horizontalPadding),
        pageWidth
      )
    );
  }

  /** Fits the page on the next frame, then runs `after` (restoring the scroll position). */
  private schedulePreviewFit(after?: () => void): void {
    const fit = (): void => {
      this.updatePreviewFit();
      after?.();
      this.syncNav();
    };
    const view = this.previewEl?.ownerDocument.defaultView;
    if (view) {
      view.requestAnimationFrame(fit);
      return;
    }
    fit();
  }

  /**
   * Remembers how far down the preview is when the same note is redrawn and returns a
   * function that scrolls back there once the new content is in place (R-028).
   */
  private keepScroll(source: DocxSource | null): () => void {
    const preview = this.previewEl;
    const path = source?.sourcePath ?? null;
    const same = preview !== null && path !== null && path === this.shownPath;
    const range = preview ? preview.scrollHeight - preview.clientHeight : 0;
    const share = same && range > 0 && preview ? preview.scrollTop / range : 0;
    this.shownPath = path;
    return () => {
      if (!same || !preview?.isConnected) return;
      preview.scrollTop = share * Math.max(0, preview.scrollHeight - preview.clientHeight);
    };
  }

  /** Pages of the real DOCX render (the simple and the Word PDF previews have none). */
  private docxPages(): HTMLElement[] {
    return this.previewEl ? elements(this.previewEl, ".docx-preview-docx section.docx") : [];
  }

  private currentPage(pages: HTMLElement[]): number {
    const preview = this.previewEl;
    if (!preview) return 1;
    const probe = preview.getBoundingClientRect().top + preview.clientHeight * 0.3;
    let current = 1;
    pages.forEach((page, index) => {
      if (page.getBoundingClientRect().top <= probe) current = index + 1;
    });
    return current;
  }

  private syncPages(): void {
    const pages = this.docxPages();
    this.nav?.setPages(pages.length ? this.currentPage(pages) : 0, pages.length);
  }

  private syncNav(): void {
    const nav = this.nav;
    const preview = this.previewEl;
    if (!nav || !preview) return;
    this.syncPages();
    // The Word PDF preview has its own page and zoom controls.
    const exact = preview.querySelector(".hanmark-docx-preview-pdf-frame") !== null;
    nav.setZoomVisible(!exact && preview.querySelector(".docx-preview-docx, .hanmark-docx-preview-paper") !== null);
    const percent = this.zoom ?? (Number(preview.dataset.fit) || 100);
    nav.setZoom(this.zoom === null, percent, percent > PREVIEW_ZOOM_STEPS[0] + 0.5, percent < 199.5);
    nav.setFollow(this.options.followCursor?.() ?? false);
  }

  private scrollPreviewTo(top: number): void {
    const preview = this.previewEl;
    if (!preview) return;
    const reduced = preview.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    preview.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  }

  private movePage(delta: -1 | 1): void {
    const preview = this.previewEl;
    const pages = this.docxPages();
    const target = pages[this.currentPage(pages) - 1 + delta];
    if (!preview || !target) return;
    this.lastUserScroll = Date.now();
    this.scrollPreviewTo(target.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop - 10);
  }

  private changeZoom(direction: -1 | 0 | 1): void {
    const preview = this.previewEl;
    if (!preview) return;
    const range = preview.scrollHeight - preview.clientHeight;
    const share = range > 0 ? preview.scrollTop / range : 0;
    const current = this.zoom ?? (Number(preview.dataset.fit) || 100);
    this.zoom = direction === 0 ? null : stepZoom(current, direction);
    this.updatePreviewFit();
    preview.scrollTop = share * Math.max(0, preview.scrollHeight - preview.clientHeight);
    this.syncNav();
    this.app.workspace.requestSaveLayout();
  }

  /**
   * Follow mode (R-028): the DOCX preview has no positions for headings, so the cursor's
   * share of the note's lines picks the same share of the preview.
   */
  private follow(activity: EditorActivity): void {
    const preview = this.previewEl;
    const editor = activity.view?.editor;
    if (!preview || !editor || (!activity.selectionSet && !activity.docChanged)) return;
    if (!(this.options.followCursor?.() ?? false)) return;
    if (!this.shownPath || activity.path !== this.shownPath) return;
    if (preview.querySelector(".hanmark-docx-preview-pdf-frame")) return;
    if (Date.now() - this.lastUserScroll < FOLLOW_PAUSE) return;
    const y = (editor.getCursor("head").line / Math.max(1, editor.lineCount() - 1)) * preview.scrollHeight;
    const at = y - preview.scrollTop;
    if (at >= preview.clientHeight * 0.12 && at <= preview.clientHeight * 0.72) return;
    this.scrollPreviewTo(y - preview.clientHeight * 0.3);
  }

  private markExactPreviewStale(): void {
    this.renderVersion += 1;
    this.previewEl?.removeAttribute("aria-busy");
    this.setPreviewStatus("docxPreview.status.stale", "stale");
  }

  private markFastPreviewStale(): void {
    this.renderVersion += 1;
    this.previewEl?.removeAttribute("aria-busy");
    this.setPreviewStatus("docxPreview.status.stale", "stale");
  }

  private async handleFastPreviewTrigger(
    trigger: FastDocxPreviewTrigger
  ): Promise<void> {
    if (!isUserInitiatedFastPreviewTrigger(trigger)) {
      if (trigger === "document-change") {
        this.markFastPreviewStale();
      } else {
        await this.renderSemanticFallback();
      }
      return;
    }
    if (trigger === "mode-selection") {
      await this.renderSemanticFallback();
    }
    await this.renderFastPreviewUserInitiated(trigger);
  }

  private async changeMode(mode: DocxPreviewMode): Promise<void> {
    try {
      await this.setPreviewMode(mode);
      if (mode === "word-pdf") {
        await this.renderExactPreview();
      } else {
        await this.handleFastPreviewTrigger("mode-selection");
      }
    } catch (error) {
      new Notice(toErrorMessage(error));
      await this.renderSemanticFallback();
    }
  }

  private async setPreviewMode(mode: DocxPreviewMode): Promise<void> {
    await this.options.setPreviewMode?.(mode);
    if (this.modeSelect) this.modeSelect.value = mode;
  }

  private async renderFastPreviewUserInitiated(
    trigger: "explicit-open" | "toolbar-refresh" | "mode-selection"
  ): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const source = this.source();
    if (!source || !source.markdown.trim()) {
      await this.renderSemanticFallback();
      return;
    }
    if (!this.fastPreview.canHandle(trigger)) return;
    const version = ++this.renderVersion;
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.setAttribute("aria-busy", "true");
    this.setPreviewStatus("docxPreview.status.building", "building");

    try {
      const rendered = createDiv({ cls: "docx-preview-docx" });
      await this.options.preparePreviewFonts?.(this.containerEl.ownerDocument);
      if (!this.previewEl || version !== this.renderVersion) return;
      const upgraded = await this.fastPreview.handle(trigger, {
        source,
        action: createUserInitiatedAction("toolbar"),
        container: rendered
      });
      if (!this.previewEl || version !== this.renderVersion) return;
      if (!upgraded) {
        preview.removeAttribute("aria-busy");
        return;
      }
      const restore = this.keepScroll(source);
      preview.empty();
      preview.append(rendered);
      preview.removeAttribute("aria-busy");
      this.setPreviewStatus("docxPreview.status.actual", "actual");
      this.schedulePreviewFit(restore);
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.removeAttribute("aria-busy");
      new Notice(
        t("docxPreview.actualFailed", { detail: toErrorMessage(error) })
      );
      await this.renderSemanticFallback();
    }
  }

  private async renderSemanticFallback(): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const version = ++this.renderVersion;
    const source = this.source();
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.removeAttribute("aria-busy");
    this.setPreviewStatus("docxPreview.status.semantic", "semantic");

    if (!source) {
      this.shownPath = null;
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: t("docxPreview.openNote")
      });
      this.syncNav();
      return;
    }
    if (!source.markdown.trim()) {
      this.shownPath = null;
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-empty",
        text: t("docxPreview.emptyNote")
      });
      this.syncNav();
      return;
    }
    const staged = createDiv({
      cls: "hanmark-docx-preview-stage"
    });
    const paper = staged.createDiv({
      cls: "hanmark-docx-preview-paper word-template-preview-paper"
    });
    const rendered = paper.createDiv({
      cls: "markdown-preview-view hanmark-docx-preview-markdown"
    });

    try {
      await MarkdownRenderer.render(
        this.app,
        source.markdown,
        rendered,
        source.sourcePath ?? "",
        this
      );
      if (!this.previewEl || version !== this.renderVersion) return;
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
      preview.createDiv({
        cls: "hanmark-docx-preview-error",
        text: t("docxPreview.failed", { detail: toErrorMessage(error) })
      });
      new Notice(t("docxPreview.simpleFailed", { detail: toErrorMessage(error) }));
      return;
    }

    try {
      const template = await this.options.templateStore.readActiveTemplate();
      await this.options.preparePreviewFonts?.(this.containerEl.ownerDocument);
      if (!this.previewEl || version !== this.renderVersion) return;
      applyWordTemplatePreview(paper, rendered, template);
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      new Notice(
        t("docxPreview.templateFailed", { detail: toErrorMessage(error) })
      );
    }

    if (!this.previewEl || version !== this.renderVersion) return;
    const restore = this.keepScroll(source);
    preview.empty();
    while (staged.firstChild) preview.append(staged.firstChild);
    this.schedulePreviewFit(restore);
  }

  private async renderExactPreview(): Promise<void> {
    const preview = this.previewEl;
    if (!preview) return;
    const source = this.source();
    if (!source) {
      await this.renderSemanticFallback();
      return;
    }
    if (!Platform.isWin || !Platform.isDesktopApp) {
      await this.setPreviewMode("fast-docx");
      new Notice(t("docxPreview.windowsOnly"));
      await this.renderSemanticFallback();
      return;
    }

    const version = ++this.renderVersion;
    this.renderedSourceKey = this.sourceKey(source);
    this.revokeObjectUrl();
    preview.setAttribute("aria-busy", "true");
    this.setPreviewStatus("docxPreview.status.building", "building");

    try {
      const result =
        await this.options.exporter.buildExactPdfPreviewUserInitiated(
          source,
          createUserInitiatedAction("toolbar")
        );
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.empty();
      preview.removeAttribute("aria-busy");
      const blob = new Blob([result.pdfBytes.slice().buffer], {
        type: "application/pdf"
      });
      this.objectUrl = URL.createObjectURL(blob);
      preview.createEl("iframe", {
        cls: "hanmark-docx-preview-pdf-frame docx-preview-pdf-frame",
        attr: {
          title: t("docxPreview.pdfFrameTitle", { title: source.title }),
          src: this.objectUrl
        }
      });
      this.setPreviewStatus("docxPreview.status.exact", "exact");
      preview.dataset.fit = "100";
      this.shownPath = source.sourcePath ?? null;
      this.syncNav();
    } catch (error) {
      if (!this.previewEl || version !== this.renderVersion) return;
      preview.removeAttribute("aria-busy");
      await this.setPreviewMode("fast-docx");
      new Notice(
        t("docxPreview.wordPdfFailed", { detail: toErrorMessage(error) })
      );
      await this.renderSemanticFallback();
    }
  }

  private async exportDocx(): Promise<void> {
    const source = this.source();
    if (!source) {
      new Notice(t("docxPreview.openNoteToExport"));
      return;
    }
    try {
      const result = await this.options.exporter.exportUserInitiated(
        source,
        createUserInitiatedAction("toolbar")
      );
      if (!result.saved.cancelled) {
        new Notice(t("docxPreview.saved", { file: result.saved.fileName }));
        this.options.onSaved?.(result.saved);
      }
    } catch (error) {
      new Notice(t("docxPreview.exportFailed", { detail: toErrorMessage(error) }));
    }
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
