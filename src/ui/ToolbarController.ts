import {
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  setIcon,
  type Editor,
  type EditorPosition,
  type WorkspaceLeaf
} from "obsidian";
import {
  applyBackgroundColorValue,
  applyFontColorValue,
  tableLabels
} from "../editorCommands";
import { currentUiLocale, t, tKey, type Locale, type MessageKey } from "../i18n";
import {
  DEFAULT_HANMARK_SETTINGS,
  normalizeToolbarHex,
  normalizeToolbarSkin,
  normalizeToolbarSkinMode,
  type HanmarkSettings,
  type ToolbarSkinPalette
} from "../legacy-port/settings";
import { markdownTable } from "../utils/markdownTable";
import type { EditorActivityHub } from "./editorActivity";
import type { JobState, JobTracker } from "./jobTracker";
import { chooseHiddenGroups, toolbarGroup, type ToolbarGroupId, type ToolbarRowId } from "./toolbarLayout";
import { headingLevelOf, inlineMarksAt, type InlineMark } from "./toolbarState";
import { showToolbarOverflow, type OverflowSection } from "./toolbarOverflow";
import { openTableGrid } from "./toolbarTableGrid";

interface CommandManager {
  executeCommandById(id: string): boolean;
}

interface AppWithCommands {
  commands: CommandManager;
}

export interface ToolbarActions {
  importDocument: () => void;
  openHwpxExport: () => void;
  openDocxExport: () => void;
  openHtmlExport: () => void;
  openPdfExport: () => void;
  toggleHwpxPreview: () => void;
  openTemplateManager: () => void;
  openSettings: () => void;
  toggleDocxPreview?: () => void;
  openWordTemplateEditor?: () => void;
}

interface ToolbarButtonOptions {
  icon?: string;
  label: string;
  text?: string;
  action: (event: MouseEvent) => void;
}

interface ToolbarMenuItem {
  commandId?: string;
  /** Runs instead of a plugin command (heading levels, for example). */
  run?: () => void;
  divider?: boolean;
  icon?: string;
  label?: string;
}

interface BrushPattern {
  name: string;
  apply: (value: string) => string;
}

type ToolbarSkinSettings = Pick<
  HanmarkSettings,
  "toolbarSkinMode" | "toolbarSkin"
>;

const TOOLBAR_SKIN_CLASSES = [
  "hwp-toolbar-skin-auto",
  "hwp-toolbar-skin-light",
  "hwp-toolbar-skin-dark"
] as const;

function svgCssUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function toolbarLogoHwp(palette: ToolbarSkinPalette): string {
  const { logoAccent, logoBody, logoMuted, logoText } = palette;
  return svgCssUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
      `<path fill="${logoAccent}" d="M128 248h98c12 0 22-10 22-22v-38H128z"/>` +
      `<path fill="${logoAccent}" d="M128 188h120v-60H128z"/>` +
      `<path fill="${logoBody}" d="M128 128h120V68H128z"/>` +
      `<path fill="${logoMuted}" d="M128 68h120V30c0-12-10-22-22-22h-98z"/>` +
      `<path fill="${logoBody}" d="M39 8h89v240H39C18 248 8 238 8 217V39C8 18 18 8 39 8z"/>` +
      `<path fill="${logoText}" d="M104 57H75V43H62v14H32v12h15c-5 4-8 10-8 17 0 15 12 27 29 27s29-12 29-27c0-7-3-13-8-17h15zm-36 44c-9 0-16-7-16-16s7-16 16-16 16 7 16 16-7 16-16 16z"/>` +
      `</svg>`
  );
}

function toolbarLogoWord(palette: ToolbarSkinPalette): string {
  const { logoAccent, logoBody, logoMuted, logoText } = palette;
  return svgCssUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
      `<path fill="${logoMuted}" d="M9 34l15-19 17 11v13c0 2-2 4-4 4H15c-3 0-6-3-6-6z"/>` +
      `<path fill="${logoAccent}" d="M9 20c0-3 2-5 5-5h22l5-2v13c0 2-2 4-4 4H15c-3 0-6 3-6 6z"/>` +
      `<path fill="${logoAccent}" d="M9 10c0-3 3-6 6-6h22c2 0 4 2 4 4v5c0 2-2 4-4 4H15c-3 0-6 3-6 6z"/>` +
      `<path fill="${logoBody}" d="M8 23h10c2 0 3 2 3 4v10c0 2-1 3-3 3H8c-2 0-4-1-4-3V27c0-2 2-4 4-4z"/>` +
      `<path fill="${logoText}" d="M18 27l-2 9h-2l-2-5-1 5H9l-2-9h2l1 6 1-6h3l1 6 1-6z"/>` +
      `</svg>`
  );
}

function setToolbarPaletteVariables(
  toolbar: HTMLElement,
  variant: "light" | "dark",
  palette: ToolbarSkinPalette
): void {
  const prefix = `--hwp-toolbar-${variant}`;
  toolbar.style.setProperty(`${prefix}-bg`, palette.toolbarBg);
  toolbar.style.setProperty(`${prefix}-edge`, palette.toolbarEdge);
  toolbar.style.setProperty(`${prefix}-btn-border`, palette.buttonBorder);
  toolbar.style.setProperty(`${prefix}-logo-body`, palette.logoBody);
  toolbar.style.setProperty(`${prefix}-logo-accent`, palette.logoAccent);
  toolbar.style.setProperty(`${prefix}-logo-muted`, palette.logoMuted);
  toolbar.style.setProperty(`${prefix}-logo-text`, palette.logoText);
  toolbar.style.setProperty(`${prefix}-logo-hwp`, toolbarLogoHwp(palette));
  toolbar.style.setProperty(`${prefix}-logo-word`, toolbarLogoWord(palette));
}

/**
 * Applies only validated palette values to a toolbar element. Theme switching
 * remains live because CSS selects the light or dark variable set by class.
 */
export function applyToolbarSkin(
  toolbar: HTMLElement,
  settings: Partial<ToolbarSkinSettings>
): void {
  const mode = normalizeToolbarSkinMode(settings.toolbarSkinMode);
  const skin = normalizeToolbarSkin(settings.toolbarSkin);
  toolbar.classList.remove(...TOOLBAR_SKIN_CLASSES);
  toolbar.classList.add(`hwp-toolbar-skin-${mode}`);
  setToolbarPaletteVariables(toolbar, "light", skin.light);
  setToolbarPaletteVariables(toolbar, "dark", skin.dark);
}

function commandManager(plugin: Plugin): CommandManager {
  return (plugin.app as unknown as AppWithCommands).commands;
}

function orderedPositions(left: EditorPosition, right: EditorPosition): [EditorPosition, EditorPosition] {
  if (left.line < right.line || (left.line === right.line && left.ch <= right.ch)) return [left, right];
  return [right, left];
}

function selectedLineRange(editor: Editor): [number, number] {
  const [from, to] = orderedPositions(editor.getCursor("from"), editor.getCursor("to"));
  const end = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
  return [from.line, Math.max(from.line, end)];
}

function mapSelectedLines(editor: Editor, transform: (line: string, lineNumber: number) => string): void {
  const [start, end] = selectedLineRange(editor);
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    editor.setLine(lineNumber, transform(editor.getLine(lineNumber), lineNumber));
  }
}

function wrapSelection(editor: Editor, open: string, close = open): void {
  const selection = editor.getSelection();
  if (selection) {
    editor.replaceSelection(`${open}${selection}${close}`);
    return;
  }
  const cursor = editor.getCursor();
  editor.replaceRange(`${open}${close}`, cursor);
  const next = { line: cursor.line, ch: cursor.ch + open.length };
  editor.setCursor(next);
}

function setHeading(editor: Editor, level: number): void {
  const prefix = `${"#".repeat(Math.min(6, Math.max(1, level)))} `;
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  editor.setLine(
    cursor.line,
    `${prefix}${line.replace(/^\s{0,3}#{1,6}\s+/, "")}`
  );
}

function setParagraph(editor: Editor): void {
  const cursor = editor.getCursor();
  editor.setLine(
    cursor.line,
    editor.getLine(cursor.line).replace(/^\s{0,3}#{1,6}\s+/, "")
  );
}

function toggleLinePrefix(editor: Editor, expression: RegExp, prefix: string): void {
  const [start, end] = selectedLineRange(editor);
  let allPrefixed = true;
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    if (!expression.test(editor.getLine(lineNumber))) {
      allPrefixed = false;
      break;
    }
  }
  mapSelectedLines(editor, (line, index) => {
    if (allPrefixed) return line.replace(expression, "");
    const cleaned = line.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
    return prefix.includes("{n}") ? prefix.replace("{n}", String(index - start + 1)) + cleaned : prefix + cleaned;
  });
}

function clearFormatting(editor: Editor): void {
  const selection = editor.getSelection();
  if (selection) {
    editor.replaceSelection(
      selection
        .replace(/(\*\*|__|~~|==|`)(.*?)\1/gs, "$2")
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
        .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
        .replace(/<u>(.*?)<\/u>/gis, "$1")
        .replace(/<span\b[^>]*>(.*?)<\/span>/gis, "$1")
    );
    return;
  }
  setParagraph(editor);
}

// Names are message keys, resolved when a brush pattern is built (this table is created
// at module load, before the interface language is known).
const INLINE_BRUSH_WRAPPERS: ReadonlyArray<{
  nameKey: MessageKey;
  open: string;
  close: string;
}> = [
  { nameKey: "toolbar.format.bold", open: "**", close: "**" },
  { nameKey: "toolbar.format.bold", open: "__", close: "__" },
  { nameKey: "toolbar.format.strikethrough", open: "~~", close: "~~" },
  { nameKey: "toolbar.format.highlight", open: "==", close: "==" },
  { nameKey: "toolbar.format.inlineCode", open: "`", close: "`" },
  { nameKey: "toolbar.format.inlineMath", open: "$", close: "$" },
  { nameKey: "toolbar.format.italic", open: "*", close: "*" },
  { nameKey: "toolbar.format.italic", open: "_", close: "_" }
];

function activeEditor(plugin: Plugin): Editor | null {
  return plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
}

/** Settings the toolbar reads; the plugin passes its live settings object. */
type ToolbarSettings = Pick<
  HanmarkSettings,
  | "toolbarSkinMode"
  | "toolbarSkin"
  | "toolbarCollapsed"
  | "toolbarPeek"
  | "toolbarLook"
  | "toolbarFoldFormatInReading"
  | "toolbarTextColor"
  | "toolbarHighlightColor"
>;

/** What the plugin lends the toolbar (R-028). */
export interface ToolbarServices {
  /** Saves the settings after the toolbar changed one (fold state, last colors). */
  persist?: () => Promise<void>;
  /** The note being edited: the active Markdown view, or the last one while a preview is active. */
  currentMarkdownView?: () => MarkdownView | null;
  activity?: EditorActivityHub;
  jobs?: JobTracker;
}

/** A toolbar item as the "⋯" menu replays it when a narrow pane hides its group. */
type ToolbarItemSpec =
  | { kind: "button"; label: string; icon?: string; run: (event: MouseEvent) => void }
  | { kind: "menu"; label: string; icon?: string; items: readonly ToolbarMenuItem[] };

interface ToolbarGroupRecord {
  id: ToolbarGroupId;
  row: ToolbarRowId;
  element: HTMLElement;
  divider: HTMLElement | null;
  items: ToolbarItemSpec[];
}

type ColorKind = "text" | "highlight";

interface ToolbarInstance {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  root: HTMLElement;
  rows: HTMLElement;
  rowElements: Partial<Record<ToolbarRowId, HTMLElement>>;
  more: Partial<Record<ToolbarRowId, HTMLButtonElement>>;
  groups: ToolbarGroupRecord[];
  handle: HTMLButtonElement | null;
  flow: HTMLElement | null;
  styleSelect: HTMLSelectElement | null;
  inlineButtons: Map<InlineMark, HTMLButtonElement>;
  colors: Array<{ kind: ColorKind; button: HTMLButtonElement; picker: HTMLInputElement }>;
  brushButton: HTMLButtonElement | null;
  resizeObserver: ResizeObserver | null;
  modeObserver: MutationObserver | null;
  lastWidth: number;
  layoutFrame: number | null;
  peekTimer: number | null;
  flashTimer: number | null;
  locale: Locale;
}

const TOOLBAR_COLORS: Readonly<Record<ColorKind, "toolbarTextColor" | "toolbarHighlightColor">> = {
  text: "toolbarTextColor",
  highlight: "toolbarHighlightColor"
};

/** Clicks on these toolbar parts fold or unfold it on double-click (never buttons or fields). */
const FOLD_TARGET_CLASSES = ["hwp-toolbar-container", "hwp-toolbar-rows", "hwp-toolbar-rows-inner", "hwp-toolbar-main", "hwp-toolbar-format", "hwp-toolbar-group"];

/**
 * HanMark's Hangul-style toolbar (R-028): one toolbar per visible Markdown pane, so
 * switching panes or clicking into a preview never makes the note jump. The toolbar
 * of the note being edited is bright, the others dim; a pointer on a dim toolbar
 * activates its pane first. Toolbars fold to a slim strip, keep each row on one line
 * (hidden groups go into a "⋯" menu), follow the cursor (heading level, pressed
 * marks), and show HanMark's running jobs as a flowing bottom edge.
 */
export class ToolbarController {
  private readonly toolbars = new Map<WorkspaceLeaf, ToolbarInstance>();
  private readonly groupRecords = new WeakMap<HTMLElement, ToolbarGroupRecord>();
  private readonly watchedDocuments = new WeakSet<Document>();
  private readonly cleanups: Array<() => void> = [];
  private building: ToolbarInstance | null = null;
  private visible: boolean;
  private serial = 0;
  private jobState: JobState = { active: false };
  private formatBrushActive = false;
  private formatBrushApply: ((value: string) => string) | null = null;
  private formatBrushArmedAt = 0;
  private lastBrushAppliedSelection = "";
  private lastBrushPattern: BrushPattern | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly actions: ToolbarActions,
    visibleOnStartup: boolean,
    private readonly getToolbarSkinSettings: () => Partial<ToolbarSettings> = () =>
      DEFAULT_HANMARK_SETTINGS,
    private readonly services: ToolbarServices = {}
  ) {
    this.visible = visibleOnStartup;
  }

  initialize(): void {
    const workspace = this.plugin.app.workspace;
    this.plugin.registerEvent(workspace.on("active-leaf-change", () => this.sync()));
    this.plugin.registerEvent(workspace.on("layout-change", () => this.sync()));
    this.plugin.registerEvent(workspace.on("resize", () => this.relayoutAll()));
    this.plugin.registerEvent(workspace.on("window-open", (_workspaceWindow, win) => this.watchDocument(win.document)));
    workspace.onLayoutReady(() => this.sync());
    this.watchDocument(document);
    const activity = this.services.activity;
    if (activity) {
      this.cleanups.push(
        activity.subscribe((change) => {
          const toolbar = change.view ? this.toolbars.get(change.view.leaf) : undefined;
          if (toolbar) this.refreshState(toolbar);
        }, 80)
      );
    }
    const jobs = this.services.jobs;
    if (jobs) this.cleanups.push(jobs.subscribe((state) => this.showJobs(state)));
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.sync();
    else this.removeAll();
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  refresh(): void {
    this.refreshSettings();
  }

  /** Applies changed settings to every toolbar; rebuilds them when the interface language changed. */
  refreshSettings(): void {
    const visible = this.visible;
    if (!visible) {
      this.removeAll();
      return;
    }
    for (const [leaf, toolbar] of this.toolbars) {
      if (toolbar.locale !== currentUiLocale()) {
        this.destroyToolbar(toolbar);
        this.toolbars.delete(leaf);
      } else {
        this.applyToolbarSettings(toolbar);
      }
    }
    this.sync();
  }

  /** Folds every toolbar to its slim strip, or unfolds it (remembered). */
  toggleCollapsed(): void {
    const settings = this.toolbarSettings();
    settings.toolbarCollapsed = !settings.toolbarCollapsed;
    for (const toolbar of this.toolbars.values()) this.applyToolbarSettings(toolbar);
    void this.services.persist?.();
  }

  destroy(): void {
    this.removeAll();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.clearFormatBrush(false);
  }

  private toolbarSettings(): Partial<ToolbarSettings> {
    return this.getToolbarSkinSettings();
  }

  private watchDocument(doc: Document): void {
    if (this.watchedDocuments.has(doc)) return;
    this.watchedDocuments.add(doc);
    this.plugin.registerDomEvent(doc, "keydown", (event) => {
      if (event.key === "Escape" && this.formatBrushActive) {
        this.clearFormatBrush(false);
      }
    });
    this.plugin.registerDomEvent(doc, "mouseup", () => {
      this.applyFormatBrushFromSelection();
    });
    this.plugin.registerDomEvent(doc, "keyup", () => {
      this.applyFormatBrushFromSelection();
    });
  }

  private currentView(): MarkdownView | null {
    return this.services.currentMarkdownView?.() ?? this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
  }

  /** Gives every visible Markdown pane its toolbar and removes toolbars of closed panes. */
  private sync(): void {
    if (!this.visible) {
      this.removeAll();
      return;
    }
    const live = new Set<WorkspaceLeaf>();
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || leaf.isDeferred) continue;
      live.add(leaf);
      const existing = this.toolbars.get(leaf);
      if (existing && existing.view === view && existing.root.isConnected && existing.locale === currentUiLocale()) continue;
      if (existing) {
        this.destroyToolbar(existing);
        this.toolbars.delete(leaf);
      }
      if (!view.containerEl.isShown()) continue;
      this.toolbars.set(leaf, this.buildToolbar(leaf, view));
    }
    for (const [leaf, toolbar] of this.toolbars) {
      if (live.has(leaf)) continue;
      this.destroyToolbar(toolbar);
      this.toolbars.delete(leaf);
    }
    const current = this.currentView();
    for (const toolbar of this.toolbars.values()) {
      toolbar.root.toggleClass("is-inactive", this.toolbars.size > 1 && toolbar.view !== current);
      this.updateReading(toolbar);
    }
    const active = current ? this.toolbars.get(current.leaf) : undefined;
    if (active) this.refreshState(active);
  }

  private removeAll(): void {
    for (const toolbar of this.toolbars.values()) this.destroyToolbar(toolbar);
    this.toolbars.clear();
  }

  private destroyToolbar(toolbar: ToolbarInstance): void {
    toolbar.resizeObserver?.disconnect();
    toolbar.modeObserver?.disconnect();
    const win = toolbar.root.win;
    if (toolbar.layoutFrame !== null) win.cancelAnimationFrame(toolbar.layoutFrame);
    if (toolbar.peekTimer !== null) win.clearTimeout(toolbar.peekTimer);
    if (toolbar.flashTimer !== null) win.clearTimeout(toolbar.flashTimer);
    toolbar.root.remove();
  }

  private buildToolbar(leaf: WorkspaceLeaf, view: MarkdownView): ToolbarInstance {
    const root = view.containerEl.createDiv({ cls: "hwp-toolbar-container" });
    view.containerEl.prepend(root);
    this.serial += 1;
    const rowsId = `hanmark-toolbar-rows-${this.serial}`;
    const rows = root.createDiv({ cls: "hwp-toolbar-rows", attr: { id: rowsId } });
    const inner = rows.createDiv({ cls: "hwp-toolbar-rows-inner" });
    const toolbar: ToolbarInstance = {
      leaf,
      view,
      root,
      rows,
      rowElements: {},
      more: {},
      groups: [],
      handle: null,
      flow: null,
      styleSelect: null,
      inlineButtons: new Map(),
      colors: [],
      brushButton: null,
      resizeObserver: null,
      modeObserver: null,
      lastWidth: -1,
      layoutFrame: null,
      peekTimer: null,
      flashTimer: null,
      locale: currentUiLocale()
    };
    this.building = toolbar;
    try {
      toolbar.rowElements.main = inner.createDiv({ cls: "hwp-toolbar-main" });
      this.renderMainToolbar(toolbar.rowElements.main);
      toolbar.more.main = this.addMoreButton(toolbar, "main");
      toolbar.rowElements.format = inner.createDiv({ cls: "hwp-toolbar-format" });
      this.renderFormatToolbar(toolbar.rowElements.format);
      toolbar.more.format = this.addMoreButton(toolbar, "format");
      toolbar.handle = this.addButton(root, {
        icon: "chevron-up",
        label: t("toolbar.collapse"),
        action: () => this.toggleCollapsed()
      });
      toolbar.handle.addClass("hwp-toolbar-handle");
      toolbar.handle.setAttribute("aria-controls", rowsId);
    } finally {
      this.building = null;
    }
    toolbar.flow = root.createDiv({ cls: "hanmark-flow-line", attr: { "aria-hidden": "true" } });
    this.bindToolbarEvents(toolbar);
    this.applyToolbarSettings(toolbar);
    this.showJobState(toolbar, this.jobState, false);
    this.observeToolbar(toolbar);
    return toolbar;
  }

  private bindToolbarEvents(toolbar: ToolbarInstance): void {
    const { root } = toolbar;
    // A dim toolbar belongs to another pane: activate that pane before the click acts on it.
    root.addEventListener(
      "pointerdown",
      () => {
        if (root.hasClass("is-inactive")) this.plugin.app.workspace.setActiveLeaf(toolbar.leaf, { focus: false });
      },
      true
    );
    root.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !FOLD_TARGET_CLASSES.some((name) => target.hasClass(name))) return;
      event.preventDefault();
      this.toggleCollapsed();
    });
    root.addEventListener("click", (event) => {
      // The folded strip itself unfolds the toolbar.
      if (!root.hasClass("is-collapsed") || root.hasClass("is-peeking")) return;
      if (event.target === root) this.toggleCollapsed();
    });
    root.addEventListener("pointerenter", () => {
      const settings = this.toolbarSettings();
      if (!root.hasClass("is-collapsed") || !settings.toolbarPeek) return;
      this.setPeekTimer(toolbar, () => this.setPeeking(toolbar, true), 250);
    });
    root.addEventListener("pointerleave", () => {
      if (toolbar.peekTimer !== null) root.win.clearTimeout(toolbar.peekTimer);
      toolbar.peekTimer = null;
      if (root.hasClass("is-peeking")) this.setPeekTimer(toolbar, () => this.setPeeking(toolbar, false), 400);
    });
  }

  private setPeekTimer(toolbar: ToolbarInstance, run: () => void, delay: number): void {
    const win = toolbar.root.win;
    if (toolbar.peekTimer !== null) win.clearTimeout(toolbar.peekTimer);
    toolbar.peekTimer = win.setTimeout(() => {
      toolbar.peekTimer = null;
      run();
    }, delay);
  }

  private setPeeking(toolbar: ToolbarInstance, peeking: boolean): void {
    toolbar.root.toggleClass("is-peeking", peeking);
    toolbar.rows.toggleAttribute("inert", toolbar.root.hasClass("is-collapsed") && !peeking);
    if (peeking) this.scheduleLayout(toolbar, true);
  }

  private applyToolbarSettings(toolbar: ToolbarInstance): void {
    const settings = this.toolbarSettings();
    const { root } = toolbar;
    applyToolbarSkin(root, settings);
    const minimal = settings.toolbarLook === "minimal";
    root.toggleClass("hwp-toolbar-look-minimal", minimal);
    root.toggleClass("hwp-toolbar-look-classic", !minimal);
    const collapsed = settings.toolbarCollapsed === true;
    root.toggleClass("is-collapsed", collapsed);
    if (!collapsed) root.removeClass("is-peeking");
    toolbar.rows.toggleAttribute("inert", collapsed && !root.hasClass("is-peeking"));
    if (toolbar.handle) {
      const label = collapsed ? t("toolbar.expand") : t("toolbar.collapse");
      toolbar.handle.setAttribute("aria-label", label);
      toolbar.handle.setAttribute("title", label);
      toolbar.handle.setAttribute("aria-expanded", String(!collapsed));
      setIcon(toolbar.handle, collapsed ? "chevron-down" : "chevron-up");
    }
    for (const color of toolbar.colors) this.paintColor(color, this.lastColor(color.kind));
    this.updateReading(toolbar);
    this.scheduleLayout(toolbar, true);
  }

  private updateReading(toolbar: ToolbarInstance): void {
    const fold = this.toolbarSettings().toolbarFoldFormatInReading !== false && toolbar.view.getMode() === "preview";
    toolbar.root.toggleClass("is-reading", fold);
  }

  private observeToolbar(toolbar: ToolbarInstance): void {
    // Observers must come from the toolbar's own window, or they never fire in popout windows.
    const win = toolbar.root.win as Window & {
      ResizeObserver: typeof ResizeObserver;
      MutationObserver: typeof MutationObserver;
    };
    toolbar.resizeObserver = new win.ResizeObserver(() => this.scheduleLayout(toolbar, false));
    toolbar.resizeObserver.observe(toolbar.rows);
    // Switching between editing and reading view toggles these containers' display.
    const modes = toolbar.view.containerEl.querySelectorAll<HTMLElement>(".markdown-reading-view, .markdown-source-view");
    if (!modes.length) return;
    toolbar.modeObserver = new win.MutationObserver(() => this.updateReading(toolbar));
    modes.forEach((element) => toolbar.modeObserver?.observe(element, { attributes: true, attributeFilter: ["style", "class"] }));
  }

  private relayoutAll(): void {
    for (const toolbar of this.toolbars.values()) this.scheduleLayout(toolbar, false);
  }

  private scheduleLayout(toolbar: ToolbarInstance, force: boolean): void {
    if (force) toolbar.lastWidth = -1;
    if (toolbar.layoutFrame !== null) return;
    toolbar.layoutFrame = toolbar.root.win.requestAnimationFrame(() => {
      toolbar.layoutFrame = null;
      this.layout(toolbar);
    });
  }

  /** Moves the lowest-priority groups of each row into its "⋯" menu until the row fits. */
  private layout(toolbar: ToolbarInstance): void {
    const { root } = toolbar;
    if (!root.isConnected || (root.hasClass("is-collapsed") && !root.hasClass("is-peeking"))) return;
    const width = toolbar.rows.clientWidth;
    if (width === toolbar.lastWidth) return;
    toolbar.lastWidth = width;
    for (const row of ["main", "format"] as const) this.layoutRow(toolbar, row);
  }

  private layoutRow(toolbar: ToolbarInstance, row: ToolbarRowId): void {
    const rowElement = toolbar.rowElements[row];
    const more = toolbar.more[row];
    if (!rowElement || !more) return;
    const groups = toolbar.groups.filter((group) => group.row === row);
    for (const group of groups) {
      group.element.removeClass("is-overflowed");
      group.divider?.removeClass("is-overflowed");
    }
    more.removeClass("is-needed");
    if (rowElement.scrollWidth <= rowElement.clientWidth + 1) return;
    more.addClass("is-needed");
    const moreWidth = more.getBoundingClientRect().width + 6;
    const measured = groups.map((group) => ({
      id: group.id,
      width:
        group.element.getBoundingClientRect().width +
        2 +
        (group.divider ? group.divider.getBoundingClientRect().width + 10 : 0),
      priority: toolbarGroup(group.id).priority
    }));
    const hidden = chooseHiddenGroups(measured, rowElement.clientWidth - 4, moreWidth);
    for (const group of groups) {
      if (!hidden.has(group.id)) continue;
      group.element.addClass("is-overflowed");
      group.divider?.addClass("is-overflowed");
    }
    // A row never starts with a divider.
    const first = Array.from(rowElement.children).find((child) => !child.hasClass("is-overflowed"));
    if (first instanceof HTMLElement && first.hasClass("hwp-toolbar-divider")) first.addClass("is-overflowed");
    more.toggleClass("is-needed", hidden.size > 0);
  }

  private addMoreButton(toolbar: ToolbarInstance, row: ToolbarRowId): HTMLButtonElement {
    const rowElement = toolbar.rowElements[row];
    if (!rowElement) throw new Error("Toolbar row missing");
    const more = this.addButton(rowElement, {
      icon: "more-horizontal",
      label: t("toolbar.more"),
      action: () => this.showOverflow(toolbar, row, more)
    });
    more.addClass("hwp-toolbar-more");
    return more;
  }

  private showOverflow(toolbar: ToolbarInstance, row: ToolbarRowId, anchor: HTMLElement): void {
    const sections: OverflowSection[] = toolbar.groups
      .filter((group) => group.row === row && group.element.hasClass("is-overflowed"))
      .map((group) => ({
        title: tKey(toolbarGroup(group.id).label),
        entries: group.items.map((item) =>
          item.kind === "button"
            ? { label: item.label, icon: item.icon, run: (event: MouseEvent | KeyboardEvent) => item.run(event as MouseEvent) }
            : {
                label: item.label,
                icon: item.icon,
                children: item.items
                  .filter((option) => !option.divider && option.label)
                  .map((option) => ({
                    label: option.label ?? "",
                    icon: option.icon,
                    run: () => this.runMenuItem(option)
                  }))
              }
        )
      }));
    if (sections.length) showToolbarOverflow(anchor, sections);
  }

  /** Follows the cursor: the heading level in the style box and pressed inline buttons. */
  private refreshState(toolbar: ToolbarInstance): void {
    if (toolbar.view.getMode() === "preview") return;
    const editor = toolbar.view.editor;
    const cursor = editor.getCursor("head");
    const line = editor.getLine(cursor.line);
    const level = headingLevelOf(line);
    if (toolbar.styleSelect) toolbar.styleSelect.value = level ? `h${level}` : "p";
    const marks = inlineMarksAt(line, cursor.ch);
    for (const [mark, button] of toolbar.inlineButtons) {
      const on = marks.has(mark);
      button.toggleClass("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  private showJobs(state: JobState): void {
    this.jobState = state;
    for (const toolbar of this.toolbars.values()) this.showJobState(toolbar, state, true);
  }

  private showJobState(toolbar: ToolbarInstance, state: JobState, flash: boolean): void {
    const flow = toolbar.flow;
    if (!flow) return;
    flow.setAttribute("data-active", String(state.active));
    if (!flash || state.active || !state.finished) return;
    const win = toolbar.root.win;
    flow.setAttribute("data-flash", "true");
    if (toolbar.flashTimer !== null) win.clearTimeout(toolbar.flashTimer);
    toolbar.flashTimer = win.setTimeout(() => {
      toolbar.flashTimer = null;
      flow.removeAttribute("data-flash");
    }, 750);
  }

  private runCommand(id: string): boolean {
    return commandManager(this.plugin).executeCommandById(id);
  }

  private runPluginCommand(id: string): boolean {
    return this.runCommand(`${this.plugin.manifest.id}:${id}`);
  }

  private runFirstCommand(ids: readonly string[], fallback?: string): boolean {
    for (const id of ids) {
      if (this.runCommand(id)) return true;
    }
    return fallback ? this.runPluginCommand(fallback) : false;
  }

  private runMenuItem(option: ToolbarMenuItem): void {
    if (option.run) option.run();
    else if (option.commandId) this.runPluginCommand(option.commandId);
  }

  /** Marks a group element as a toolbar group: its items can move into the row's "⋯" menu. */
  private registerGroup(element: HTMLElement, id: ToolbarGroupId): HTMLElement {
    const toolbar = this.building;
    if (!toolbar) return element;
    const previous = element.previousElementSibling;
    const record: ToolbarGroupRecord = {
      id,
      row: toolbarGroup(id).row,
      element,
      divider: previous instanceof HTMLElement && previous.hasClass("hwp-toolbar-divider") ? previous : null,
      items: []
    };
    element.setAttribute("data-group", id);
    toolbar.groups.push(record);
    this.groupRecords.set(element, record);
    return element;
  }

  private addButton(root: HTMLElement, options: ToolbarButtonOptions): HTMLButtonElement {
    const button = root.createEl("button", {
      cls: "hwp-toolbar-btn",
      attr: {
        type: "button",
        "aria-label": options.label,
        title: options.label
      }
    });
    if (options.icon) setIcon(button, options.icon);
    if (options.text) button.createSpan({ cls: "hwp-toolbar-btn-label", text: options.text });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      options.action(event);
    });
    this.groupRecords.get(root)?.items.push({ kind: "button", label: options.label, icon: options.icon, run: options.action });
    return button;
  }

  private lastColor(kind: ColorKind): string {
    const settings = this.toolbarSettings();
    const fallback = DEFAULT_HANMARK_SETTINGS[TOOLBAR_COLORS[kind]];
    return normalizeToolbarHex(settings[TOOLBAR_COLORS[kind]], fallback);
  }

  private paintColor(color: { button: HTMLButtonElement; picker: HTMLInputElement }, value: string): void {
    color.button.setCssProps({ "--hwp-swatch": value });
    color.picker.value = value;
  }

  private rememberColor(kind: ColorKind, value: string): void {
    const color = normalizeToolbarHex(value, this.lastColor(kind));
    const settings = this.toolbarSettings();
    settings[TOOLBAR_COLORS[kind]] = color;
    for (const toolbar of this.toolbars.values()) {
      for (const entry of toolbar.colors) if (entry.kind === kind) this.paintColor(entry, color);
    }
    void this.services.persist?.();
  }

  /**
   * A split color button: the body applies the last color at once, the caret opens
   * the color picker; the chosen color is remembered for every toolbar (R-028).
   */
  private addColorButton(
    root: HTMLElement,
    options: {
      icon: string;
      label: string;
      text: string;
      kind: ColorKind;
      apply: (editor: Editor, color: string) => void;
    }
  ): HTMLButtonElement {
    const picker = root.createEl("input", {
      type: "color",
      attr: {
        "aria-label": t("toolbar.color.picker", { label: options.label })
      }
    });
    picker.value = this.lastColor(options.kind);
    picker.hidden = true;
    picker.addEventListener("change", () => {
      const editor = activeEditor(this.plugin);
      if (editor) options.apply(editor, picker.value);
      this.rememberColor(options.kind, picker.value);
    });
    const button = this.addButton(root, {
      icon: options.icon,
      label: t("toolbar.color.applyLast", { label: options.label }),
      text: options.text,
      action: () => {
        const editor = activeEditor(this.plugin);
        if (editor) options.apply(editor, this.lastColor(options.kind));
      }
    });
    button.addClass("hwp-toolbar-color");
    const caret = this.addButton(root, {
      icon: "chevron-down",
      label: options.label,
      action: () => picker.click()
    });
    caret.addClass("hwp-toolbar-caret");
    const entry = { kind: options.kind, button, picker };
    this.building?.colors.push(entry);
    this.paintColor(entry, this.lastColor(options.kind));
    return button;
  }

  private addMenuButton(
    root: HTMLElement,
    label: string,
    text: string,
    items: readonly ToolbarMenuItem[],
    icon?: string
  ): HTMLButtonElement {
    const button = this.addButton(root, {
      icon,
      label,
      text,
      action: (event) => {
        const menu = new Menu();
        for (const option of items) {
          if (option.divider) {
            menu.addSeparator();
            continue;
          }
          if ((!option.commandId && !option.run) || !option.label) continue;
          menu.addItem((item) => {
            item.setTitle(option.label ?? "");
            if (option.icon) item.setIcon(option.icon);
            item.onClick(() => {
              this.runMenuItem(option);
            });
          });
        }
        menu.showAtMouseEvent(event);
      }
    });
    // In the "⋯" menu a menu button is replayed as its items.
    const record = this.groupRecords.get(root);
    if (record) record.items[record.items.length - 1] = { kind: "menu", label, icon, items };
    return button;
  }

  private addDivider(root: HTMLElement): void {
    root.createDiv({ cls: "hwp-toolbar-divider" });
  }

  private openTableGrid(anchor: HTMLElement): void {
    const toolbar = [...this.toolbars.values()].find((item) => item.root.contains(anchor));
    const visible = anchor.isShown() ? anchor : toolbar?.more.main ?? anchor;
    openTableGrid(visible, (size) => {
      const editor = activeEditor(this.plugin);
      if (!editor) return;
      editor.replaceRange(markdownTable(size.rows, size.cols, tableLabels()), editor.getCursor());
      editor.focus();
    });
  }

  private buildBrushPattern(
    headingLevel: number | null,
    wrappers: ReadonlyArray<{ nameKey: MessageKey; open: string; close: string }>
  ): BrushPattern {
    const names = [
      headingLevel ? t("toolbar.headingLevel", { level: headingLevel }) : "",
      ...wrappers.map((wrapper) => tKey(wrapper.nameKey))
    ].filter(Boolean);
    return {
      name: names.join(" + "),
      apply: (value) => {
        let result = value;
        let changed = true;
        while (changed && result.length > 1) {
          changed = false;
          for (const wrapper of INLINE_BRUSH_WRAPPERS) {
            if (
              result.length > wrapper.open.length + wrapper.close.length &&
              result.startsWith(wrapper.open) &&
              result.endsWith(wrapper.close)
            ) {
              result = result.slice(wrapper.open.length, -wrapper.close.length);
              changed = true;
              break;
            }
          }
        }
        for (const wrapper of wrappers) {
          result = `${wrapper.open}${result}${wrapper.close}`;
        }
        if (headingLevel) {
          const prefix = `${"#".repeat(headingLevel)} `;
          result = result
            .split(/\r?\n/)
            .map((line) => `${prefix}${line.replace(/^\s{0,3}#{1,6}\s+/, "")}`)
            .join("\n");
        }
        return result;
      }
    };
  }

  private detectBrushPattern(value: string): BrushPattern | null {
    let remaining = value.trim();
    if (!remaining) return null;
    const heading = remaining.match(/^(#{1,6})\s+([\s\S]*)$/);
    const headingLevel = heading ? heading[1].length : null;
    if (heading) remaining = heading[2];
    const wrappers: Array<{ nameKey: MessageKey; open: string; close: string }> = [];
    let changed = true;
    while (changed && remaining.length > 1) {
      changed = false;
      for (const wrapper of INLINE_BRUSH_WRAPPERS) {
        if (
          remaining.length > wrapper.open.length + wrapper.close.length &&
          remaining.startsWith(wrapper.open) &&
          remaining.endsWith(wrapper.close)
        ) {
          remaining = remaining.slice(wrapper.open.length, -wrapper.close.length);
          wrappers.push(wrapper);
          changed = true;
          break;
        }
      }
    }
    if (!headingLevel && wrappers.length === 0) return null;
    wrappers.reverse();
    return this.buildBrushPattern(headingLevel, wrappers);
  }

  private detectBrushPatternFromEditorContext(editor: Editor): BrushPattern | null {
    const [from, to] = orderedPositions(
      editor.getCursor("from"),
      editor.getCursor("to")
    );
    if (from.line !== to.line || from.ch === to.ch) return null;
    const line = editor.getLine(from.line);
    const before = line.slice(0, from.ch);
    const selected = line.slice(from.ch, to.ch);
    const after = line.slice(to.ch);
    if (!selected) return null;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+/);
    const headingLevel =
      heading && from.ch >= heading[0].length ? heading[1].length : null;
    const wrappers: Array<{ nameKey: MessageKey; open: string; close: string }> = [];
    let left = before;
    let right = after;
    let changed = true;
    while (changed) {
      changed = false;
      for (const wrapper of INLINE_BRUSH_WRAPPERS) {
        if (left.endsWith(wrapper.open) && right.startsWith(wrapper.close)) {
          wrappers.push(wrapper);
          left = left.slice(0, -wrapper.open.length);
          right = right.slice(wrapper.close.length);
          changed = true;
          break;
        }
      }
    }
    if (!headingLevel && wrappers.length === 0) return null;
    wrappers.reverse();
    return this.buildBrushPattern(headingLevel, wrappers);
  }

  private rememberHeadingBrush(level: number): void {
    this.lastBrushPattern = this.buildBrushPattern(level, []);
  }

  private rememberInlineBrush(
    nameKey: MessageKey,
    open: string,
    close: string
  ): void {
    this.lastBrushPattern = this.buildBrushPattern(null, [{ nameKey, open, close }]);
  }

  private showBrush(active: boolean): void {
    for (const toolbar of this.toolbars.values()) toolbar.brushButton?.toggleClass("is-active", active);
  }

  private toggleFormatBrush(): void {
    if (this.formatBrushActive) {
      this.clearFormatBrush(true);
      return;
    }
    const editor = activeEditor(this.plugin);
    if (!editor) {
      new Notice(t("toolbar.brush.noEditor"));
      return;
    }
    const selection = editor.getSelection();
    const pattern =
      this.detectBrushPatternFromEditorContext(editor) ??
      (selection.trim() ? this.detectBrushPattern(selection) : null) ??
      this.lastBrushPattern;
    if (!pattern) {
      new Notice(t("toolbar.brush.noPattern"));
      return;
    }
    this.formatBrushActive = true;
    this.formatBrushApply = pattern.apply;
    this.formatBrushArmedAt = Date.now();
    this.lastBrushAppliedSelection = "";
    this.showBrush(true);
    new Notice(t("toolbar.brush.on", { format: pattern.name }));
  }

  private applyFormatBrushFromSelection(): void {
    if (
      !this.formatBrushActive ||
      !this.formatBrushApply ||
      Date.now() - this.formatBrushArmedAt < 180
    ) {
      return;
    }
    const editor = activeEditor(this.plugin);
    if (!editor) return;
    const selection = editor.getSelection();
    if (!selection.trim()) return;
    const cursor = editor.getCursor();
    const signature = `${cursor.line}:${cursor.ch}:${selection}`;
    if (signature === this.lastBrushAppliedSelection) return;
    this.lastBrushAppliedSelection = signature;
    editor.replaceSelection(this.formatBrushApply(selection));
  }

  private clearFormatBrush(showNotice: boolean): void {
    this.formatBrushActive = false;
    this.formatBrushApply = null;
    this.formatBrushArmedAt = 0;
    this.lastBrushAppliedSelection = "";
    this.showBrush(false);
    if (showNotice) new Notice(t("toolbar.brush.off"));
  }

  private renderMainToolbar(root: HTMLElement): void {
    const files = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "files");
    this.addButton(files, {
      icon: "file-plus",
      label: t("toolbar.file.new"),
      action: () => void this.runCommand("file-explorer:new-file")
    });
    this.addButton(files, {
      icon: "folder-open",
      label: t("toolbar.file.open"),
      action: () => void this.runCommand("switcher:open")
    });
    this.addButton(files, {
      icon: "file-input",
      label: t("toolbar.file.import"),
      action: this.actions.importDocument
    });
    this.addButton(files, {
      icon: "save",
      label: t("toolbar.file.save"),
      action: () => void this.runCommand("editor:save-file")
    });

    this.addDivider(root);
    const exports = root.createDiv({
      cls: "hwp-toolbar-group hwp-toolbar-export-group"
    });
    this.registerGroup(exports, "exports");
    this.addButton(exports, {
      icon: "file-output",
      label: t("toolbar.export.hwpx"),
      text: "HWPX",
      action: this.actions.openHwpxExport
    });
    this.addButton(exports, {
      icon: "file-text",
      label: t("toolbar.export.docx"),
      text: "DOCX",
      action: this.actions.openDocxExport
    });
    this.addButton(exports, {
      icon: "code",
      label: t("toolbar.export.html"),
      text: "HTML",
      action: this.actions.openHtmlExport
    });
    this.addButton(exports, {
      icon: "printer",
      label: t("toolbar.export.pdf"),
      text: "PDF",
      action: this.actions.openPdfExport
    });

    this.addDivider(root);
    const history = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "history");
    this.addButton(history, {
      icon: "undo",
      label: t("toolbar.history.undo"),
      action: () => void this.runCommand("editor:undo")
    });
    this.addButton(history, {
      icon: "redo",
      label: t("toolbar.history.redo"),
      action: () => void this.runCommand("editor:redo")
    });

    this.addDivider(root);
    const inserts = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "inserts");
    const table = this.addButton(inserts, {
      icon: "table",
      label: t("toolbar.insert.table"),
      action: () => this.openTableGrid(table)
    });
    table.setAttribute("aria-haspopup", "dialog");
    this.addButton(inserts, {
      icon: "minus",
      label: t("toolbar.insert.hr"),
      action: () => void this.runPluginCommand("insert-hr")
    });
    this.addButton(inserts, {
      icon: "square-code",
      label: t("toolbar.insert.codeBlock"),
      action: () => void this.runPluginCommand("insert-codeblock")
    });
    this.addButton(inserts, {
      icon: "paperclip",
      label: t("toolbar.insert.attachment"),
      action: () =>
        void this.runFirstCommand(["editor:attach-file"], "insert-embed")
    });

    this.addDivider(root);
    const previews = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "previews");
    this.addButton(previews, {
      icon: "columns-2",
      label: t("toolbar.preview.hwpx"),
      text: t("toolbar.preview.hwpxShort"),
      action: this.actions.toggleHwpxPreview
    });
    if (this.actions.toggleDocxPreview) {
      this.addButton(previews, {
        icon: "file-search",
        label: t("toolbar.preview.docx"),
        text: t("toolbar.preview.docx"),
        action: this.actions.toggleDocxPreview
      });
    }

    this.addDivider(root);
    const templates = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "templates");
    this.addButton(templates, {
      icon: "file-check",
      label: t("toolbar.template.hwpx"),
      text: t("toolbar.template.hwpxShort"),
      action: this.actions.openTemplateManager
    });
    if (this.actions.openWordTemplateEditor) {
      this.addButton(templates, {
        icon: "file-cog",
        label: t("toolbar.template.word"),
        text: t("toolbar.template.wordShort"),
        action: this.actions.openWordTemplateEditor
      });
    }
    this.addButton(templates, {
      icon: "settings",
      label: t("toolbar.settings"),
      action: this.actions.openSettings
    });
  }

  private renderFormatToolbar(root: HTMLElement): void {
    const styleGroup = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "style");
    const style = styleGroup.createEl("select", {
      cls: "hwp-style-dropdown",
      attr: { "aria-label": t("toolbar.style.label") }
    });
    [
      ["p", t("toolbar.style.body")],
      ["h1", t("toolbar.headingLevel", { level: 1 })],
      ["h2", t("toolbar.headingLevel", { level: 2 })],
      ["h3", t("toolbar.headingLevel", { level: 3 })],
      ["h4", t("toolbar.headingLevel", { level: 4 })],
      ["h5", t("toolbar.headingLevel", { level: 5 })],
      ["h6", t("toolbar.headingLevel", { level: 6 })]
    ].forEach(([value, label]) => style.createEl("option", { value, text: label }));
    // The box shows the cursor line's style (R-028); choosing one applies it.
    style.addEventListener("change", () => {
      const editor = activeEditor(this.plugin);
      if (!editor) return;
      if (style.value === "p") setParagraph(editor);
      else {
        const level = Number(style.value.slice(1));
        setHeading(editor, level);
        this.rememberHeadingBrush(level);
      }
    });
    if (this.building) this.building.styleSelect = style;

    this.addDivider(root);
    const headings = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "headings");
    const brush = this.addButton(headings, {
      icon: "paintbrush",
      label: t("toolbar.brush.button"),
      action: () => this.toggleFormatBrush()
    });
    brush.toggleClass("is-active", this.formatBrushActive);
    if (this.building) this.building.brushButton = brush;
    this.addButton(headings, {
      icon: "eraser",
      label: t("toolbar.clearFormatting"),
      action: () =>
        void this.runFirstCommand(
          ["editor:clear-formatting"],
          "clear-formatting"
        )
    });
    for (const level of [2, 3]) {
      this.addButton(headings, {
        label: t("toolbar.headingLevel", { level }),
        text: `H${level}`,
        action: () => this.applyHeading(level)
      });
    }
    this.addMenuButton(
      headings,
      t("toolbar.moreHeadings"),
      "Hn",
      [1, 4, 5, 6].map((level) => ({
        label: t("toolbar.headingLevel", { level }),
        run: () => this.applyHeading(level)
      }))
    );

    this.addDivider(root);
    const inline = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "inline");
    const inlineButtons: Array<[
      MessageKey,
      string,
      string,
      string,
      readonly string[],
      string | undefined,
      InlineMark
    ]> = [
      ["toolbar.format.bold", "B", "**", "**", ["editor:toggle-bold"], undefined, "bold"],
      ["toolbar.format.italic", "I", "*", "*", ["editor:toggle-italics"], undefined, "italic"],
      ["toolbar.format.strikethrough", "S", "~~", "~~", ["editor:toggle-strikethrough"], undefined, "strikethrough"],
      ["toolbar.format.underline", "U", "<u>", "</u>", [], "toggle-underline", "underline"],
      ["toolbar.format.highlight", "H", "==", "==", ["editor:toggle-highlight"], undefined, "highlight"],
      ["toolbar.format.inlineCode", "<>", "`", "`", ["editor:toggle-code"], undefined, "code"],
      ["toolbar.format.inlineMath", "∑", "$", "$", [], "toggle-inline-math", "math"]
    ];
    for (const [labelKey, text, open, close, commandIds, fallback, mark] of inlineButtons) {
      const button = this.addButton(inline, {
        label: tKey(labelKey),
        text,
        action: () => {
          const applied =
            commandIds.length > 0
              ? this.runFirstCommand(commandIds, fallback)
              : fallback
                ? this.runPluginCommand(fallback)
                : false;
          if (!applied) {
            const editor = activeEditor(this.plugin);
            if (editor) wrapSelection(editor, open, close);
          }
          this.rememberInlineBrush(labelKey, open, close);
        }
      });
      // Each button shows its own style (bold B, italic I, underlined U…) and a pressed state.
      button.querySelector(".hwp-toolbar-btn-label")?.addClass(`hwp-glyph-${mark}`);
      button.setAttribute("aria-pressed", "false");
      this.building?.inlineButtons.set(mark, button);
    }

    this.addDivider(root);
    const blocks = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "blocks");
    this.addButton(blocks, {
      icon: "list",
      label: t("toolbar.list.bullet"),
      action: () => {
        if (!this.runCommand("editor:toggle-bullet-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) toggleLinePrefix(editor, /^\s*[-+*]\s+/, "- ");
        }
      }
    });
    this.addButton(blocks, {
      icon: "list-ordered",
      label: t("toolbar.list.numbered"),
      action: () => {
        if (!this.runCommand("editor:toggle-numbered-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) toggleLinePrefix(editor, /^\s*\d+[.)]\s+/, "{n}. ");
        }
      }
    });
    this.addButton(blocks, {
      icon: "list-checks",
      label: t("toolbar.list.task"),
      action: () => void this.runPluginCommand("cycle-list-checklist")
    });
    this.addButton(blocks, {
      icon: "check-check",
      label: t("toolbar.list.toggleTask"),
      action: () => void this.runCommand("editor:toggle-checklist-status")
    });
    this.addButton(blocks, {
      icon: "quote",
      label: t("toolbar.quote"),
      action: () => void this.runPluginCommand("toggle-blockquote")
    });
    this.addMenuButton(
      blocks,
      t("toolbar.callout.menu"),
      t("toolbar.callout.menu"),
      [
        {
          label: t("toolbar.callout.note"),
          commandId: "insert-callout-note",
          icon: "message-square"
        },
        {
          label: t("toolbar.callout.warning"),
          commandId: "insert-callout-warning",
          icon: "message-square-warning"
        }
      ],
      "message-square-warning"
    );

    this.addDivider(root);
    const tools = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "tools");
    this.addMenuButton(
      tools,
      t("toolbar.insertMenu.label"),
      t("toolbar.insertMenu.text"),
      [
        { label: t("toolbar.insertMenu.markdownLink"), commandId: "insert-link", icon: "link" },
        { label: t("toolbar.insertMenu.wikilink"), commandId: "insert-wikilink", icon: "file-symlink" },
        { label: t("toolbar.insertMenu.image"), commandId: "insert-image", icon: "image" },
        { label: t("toolbar.insertMenu.embed"), commandId: "insert-embed", icon: "paperclip" },
        { divider: true },
        { label: t("toolbar.insertMenu.table"), commandId: "insert-table", icon: "table" },
        { label: t("toolbar.insertMenu.codeBlock"), commandId: "insert-codeblock", icon: "square-code" },
        { label: t("toolbar.insertMenu.mathBlock"), commandId: "insert-mathblock", icon: "sigma" },
        { label: t("toolbar.format.inlineMath"), commandId: "toggle-inline-math", icon: "function-square" },
        { label: t("toolbar.insertMenu.superscript"), commandId: "superscript", icon: "superscript" },
        { label: t("toolbar.insertMenu.subscript"), commandId: "subscript", icon: "subscript" },
        { label: t("toolbar.insertMenu.hr"), commandId: "insert-hr", icon: "minus" }
      ],
      "plus-circle"
    );
    this.addMenuButton(
      tools,
      t("toolbar.align.menu"),
      t("toolbar.align.menu"),
      [
        { label: t("toolbar.align.left"), commandId: "align-left", icon: "align-left" },
        { label: t("toolbar.align.center"), commandId: "align-center", icon: "align-center" },
        { label: t("toolbar.align.right"), commandId: "align-right", icon: "align-right" },
        { label: t("toolbar.align.justify"), commandId: "align-justify", icon: "align-justify" }
      ],
      "align-justify"
    );
    this.addColorButton(tools, {
      icon: "palette",
      label: t("toolbar.color.text"),
      text: t("toolbar.color.text"),
      kind: "text",
      apply: applyFontColorValue
    });
    this.addColorButton(tools, {
      icon: "paint-bucket",
      label: t("toolbar.color.background"),
      text: t("toolbar.color.background"),
      kind: "highlight",
      apply: applyBackgroundColorValue
    });
    this.addMenuButton(
      tools,
      t("toolbar.textTools.menu"),
      t("toolbar.textTools.menu"),
      [
        { label: t("toolbar.textTools.plain"), commandId: "text-get-plain" },
        { label: t("toolbar.textTools.width"), commandId: "text-smart-symbols" },
        { divider: true },
        { label: t("toolbar.textTools.insertBlankLines"), commandId: "text-insert-blank-lines" },
        { label: t("toolbar.textTools.removeBlankLines"), commandId: "text-remove-blank-lines" },
        { label: t("toolbar.textTools.splitLines"), commandId: "text-split-lines" },
        { label: t("toolbar.textTools.joinLines"), commandId: "text-merge-lines" },
        { label: t("toolbar.textTools.dedupeLines"), commandId: "text-dedupe-lines" },
        { divider: true },
        { label: t("toolbar.textTools.addWrap"), commandId: "text-add-wrap" },
        { label: t("toolbar.textTools.numberLines"), commandId: "text-number-lines" },
        { label: t("toolbar.textTools.trimLineEnds"), commandId: "text-trim-line-ends" },
        { label: t("toolbar.textTools.compressSpaces"), commandId: "text-compress-spaces" },
        { label: t("toolbar.textTools.removeWhitespace"), commandId: "text-remove-all-whitespace" },
        { divider: true },
        { label: t("toolbar.textTools.listToTable"), commandId: "text-list-to-table" },
        { label: t("toolbar.textTools.tableToList"), commandId: "text-table-to-list" },
        { label: t("toolbar.textTools.extractBetween"), commandId: "text-extract-between" }
      ],
      "wrench"
    );

    this.addDivider(root);
    const indent = this.registerGroup(root.createDiv({ cls: "hwp-toolbar-group" }), "indent");
    this.addButton(indent, {
      icon: "indent-increase",
      label: t("toolbar.indent.increase"),
      action: () => {
        if (!this.runCommand("editor:indent-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) mapSelectedLines(editor, (line) => `  ${line}`);
        }
      }
    });
    this.addButton(indent, {
      icon: "indent-decrease",
      label: t("toolbar.indent.decrease"),
      action: () => {
        if (!this.runCommand("editor:unindent-list")) {
          const editor = activeEditor(this.plugin);
          if (editor) {
            mapSelectedLines(editor, (line) =>
              line.replace(/^(?: {1,2}|\t)/, "")
            );
          }
        }
      }
    });
  }

  private applyHeading(level: number): void {
    if (this.runFirstCommand([`editor:set-heading-${level}`], `set-heading-${level}`)) {
      this.rememberHeadingBrush(level);
    }
  }
}

export const editorFormatting = {
  clearFormatting,
  setHeading,
  setParagraph,
  toggleLinePrefix,
  wrapSelection
};
