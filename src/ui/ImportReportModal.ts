import { Modal, Notice, TFile, type App } from "obsidian";
import type { ImportResult, ImportWarning } from "../io/importRunner";
import { promptSecret } from "./dialogs";
import { errorMessage } from "../utils/errors";
import { t } from "../i18n";

const MAX_LISTED = 50;
const MAX_OPEN_ALL = 20;

export interface ImportReportOptions {
  results: ImportResult[];
  /** Convert one failed file again, optionally with an open password (memory only). */
  retry?(result: ImportResult, password?: string): Promise<ImportResult>;
  /** Show a newly created note in the operating-system file manager. */
  reveal?(notePath: string): Promise<void>;
}

/** Formats the page information of a successful conversion. */
export function describeImportedPages(result: ImportResult): string {
  const count = result.pageCount;
  if (!count) return "";
  if (result.fileType === "xlsx" || result.fileType === "xls") return t("import.report.sheets", { count });
  if (result.pageMode === "section") return t("import.report.sections", { count });
  if (result.pageMode === "layout" || result.fileType === "pdf") return t("import.report.pages", { count });
  return "";
}

function formatName(result: ImportResult): string {
  return result.fileType ? result.fileType.toUpperCase().replace("HWP3", "HWP 3") : "";
}

export function describeImportWarningLine(warning: ImportWarning): string {
  return warning.page ? t("import.report.pagePrefix", { page: warning.page, text: warning.text }) : warning.text;
}

/**
 * One report for single and bulk imports (2.7.0 W3): note links, page basis,
 * saved images, page-numbered warnings, and fixes (password, retry) for failures.
 */
export class ImportReportModal extends Modal {
  private readonly results: ImportResult[];
  private busy = false;

  constructor(app: App, private readonly options: ImportReportOptions) {
    super(app);
    this.results = [...options.results];
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-import-report");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(t("import.report.title"));

    const ok = this.results.filter((result) => result.ok);
    const failed = this.results.filter((result) => !result.ok && !result.cancelled);
    const cancelled = this.results.filter((result) => result.cancelled);
    const warned = ok.filter((result) => result.warnings.length > 0);
    let summary = t("import.report.summary", {
      ok: ok.length,
      warned: warned.length,
      failed: failed.length,
      total: this.results.length
    });
    if (cancelled.length) summary += t("import.report.cancelledCount", { count: cancelled.length });
    contentEl.createEl("p", { cls: "hanmark-import-report-summary", text: summary });

    const list = contentEl.createDiv({ cls: "hanmark-import-report-list" });
    const ordered = [...failed, ...warned, ...ok.filter((result) => !result.warnings.length), ...cancelled];
    for (const result of ordered.slice(0, MAX_LISTED)) this.renderEntry(list, result);
    if (ordered.length > MAX_LISTED) {
      list.createEl("p", { text: t("import.report.more", { count: ordered.length - MAX_LISTED }) });
    }

    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    const notes = ok.map((result) => result.notePath).filter((path): path is string => Boolean(path));
    if (notes.length > 1) {
      actions.createEl("button", { text: t("import.report.openAll") }).onclick = () => {
        void this.openNotes(notes.slice(0, MAX_OPEN_ALL));
      };
    }
    if (notes.length && this.options.reveal) {
      actions.createEl("button", { text: t("import.report.reveal") }).onclick = () => {
        void this.options.reveal?.(notes[0]).catch((error: unknown) => new Notice(errorMessage(error)));
      };
    }
    const close = actions.createEl("button", { text: t("common.close") });
    close.classList.add("mod-cta");
    close.onclick = () => this.close();
  }

  private renderEntry(container: HTMLElement, result: ImportResult): void {
    const entry = container.createDiv({ cls: "hanmark-import-report-entry" });
    if (result.cancelled) {
      entry.addClass("is-cancelled");
      entry.createEl("strong", { text: result.source });
      entry.createEl("p", { text: t("import.report.cancelled") });
      return;
    }
    if (!result.ok) {
      entry.addClass("is-failed");
      entry.createEl("strong", { text: result.source });
      entry.createEl("p", { text: result.errorTitle ?? t("common.unknownError") });
      if (result.errorFix) entry.createEl("p", { cls: "hanmark-import-report-fix", text: result.errorFix });
      if (result.errorOriginal) this.renderOriginal(entry, result.errorOriginal);
      if (this.options.retry && result.input) {
        const buttons = entry.createDiv({ cls: "hanmark-import-report-buttons" });
        if (result.passwordHelps) {
          const password = buttons.createEl("button", { text: t("import.report.enterPassword") });
          password.classList.add("mod-cta");
          password.onclick = () => void this.retryWithPassword(result);
        }
        buttons.createEl("button", { text: t("import.report.retry") }).onclick = () => void this.retry(result);
      }
      return;
    }

    entry.addClass(result.warnings.length ? "is-warned" : "is-ok");
    const title = entry.createDiv({ cls: "hanmark-import-report-title" });
    if (result.notePath) {
      const link = title.createEl("a", { text: result.notePath, href: "#" });
      link.onclick = (event) => {
        event.preventDefault();
        void this.openNotes([result.notePath ?? ""]);
      };
    }
    title.createSpan({ cls: "hanmark-import-report-source", text: ` ← ${result.source}` });
    const facts = [
      formatName(result),
      describeImportedPages(result),
      result.tables ? t("import.report.tables", { count: result.tables }) : "",
      result.images ? t("import.report.images", { count: result.images }) : "",
      result.cloudImages ? t("import.report.cloudImages", { count: result.cloudImages }) : ""
    ].filter(Boolean);
    if (facts.length) entry.createEl("p", { cls: "hanmark-import-report-facts", text: facts.join(" · ") });
    if (result.warnings.length) {
      const warnings = entry.createEl("ul", { cls: "hanmark-import-report-warnings" });
      for (const warning of result.warnings.slice(0, MAX_LISTED)) {
        const item = warnings.createEl("li", { text: describeImportWarningLine(warning) });
        if (warning.original && warning.original !== warning.text) this.renderOriginal(item, warning.original);
      }
      if (result.warnings.length > MAX_LISTED) {
        warnings.createEl("li", { text: t("import.report.more", { count: result.warnings.length - MAX_LISTED }) });
      }
    }
  }

  private renderOriginal(container: HTMLElement, original: string): void {
    const details = container.createEl("details", { cls: "hanmark-import-report-original" });
    details.createEl("summary", { text: t("import.report.originalMessage") });
    details.createEl("code", { text: original });
  }

  private async retryWithPassword(result: ImportResult): Promise<void> {
    let current = result;
    let error: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const password = await promptSecret(this.app, {
        title: t("import.password.title"),
        label: t("import.password.label", { file: current.source }),
        description: t("import.password.desc"),
        error,
        confirmText: t("import.password.submit")
      });
      if (password === null) return;
      const next = await this.retry(current, password);
      if (!next || next.ok || !next.passwordHelps) return;
      current = next;
      error = t("import.password.wrong");
    }
  }

  private async retry(result: ImportResult, password?: string): Promise<ImportResult | null> {
    if (this.busy || !this.options.retry) return null;
    this.busy = true;
    const progress = new Notice(t("import.report.retrying"), 0);
    try {
      const next = await this.options.retry(result, password);
      const index = this.results.indexOf(result);
      if (index >= 0) this.results[index] = next;
      this.render();
      return next;
    } catch (error: unknown) {
      new Notice(errorMessage(error));
      return null;
    } finally {
      progress.hide();
      this.busy = false;
    }
  }

  private async openNotes(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
    }
  }
}
