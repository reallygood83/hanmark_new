import { Modal, Notice, type App, type Editor } from "obsidian";
import {
  lintGongmunText,
  lintMuncheText,
  usesGaejosikMunche,
  type GongmunLintFinding,
  type GongmunPreset,
  type MuncheLintFinding
} from "kordoc";
import { gongmunAutoCleanups, type AutoCleanupKind } from "../io/gongmunStyle";
import { bodyLineOffset, extractEditableBody } from "../io/frontmatter";
import { t, tKey, type MessageKey } from "../i18n";

const CLEANUP_LABELS: Readonly<Record<AutoCleanupKind, MessageKey>> = {
  "law-code": "gongmun.lint.cleanup.law-code",
  "system-code": "gongmun.lint.cleanup.system-code",
  "region-code": "gongmun.lint.cleanup.region-code",
  "tool-note": "gongmun.lint.cleanup.tool-note"
};

const MAX_FINDINGS = 200;

interface LintSnapshot {
  offset: number;
  cleanups: ReturnType<typeof gongmunAutoCleanups>;
  notation: GongmunLintFinding[];
  munche: MuncheLintFinding[];
}

/**
 * Official-style notation check (2.7.0 W5): advisory findings from Kordoc's
 * manual-based rules, never a gate on export. Clicking a finding moves the cursor;
 * a suggestion is applied only when the user presses its button, one at a time.
 */
export class GongmunLintModal extends Modal {
  private snapshot: LintSnapshot | null = null;

  constructor(app: App, private readonly editor: Editor, private readonly preset: GongmunPreset) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-gongmun-lint");
    this.titleEl.setText(t("gongmun.lint.title"));
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private lint(): LintSnapshot {
    const raw = this.editor.getValue();
    const body = extractEditableBody(raw);
    return {
      offset: bodyLineOffset(raw),
      cleanups: gongmunAutoCleanups(body),
      notation: lintGongmunText(body, { document: true }).slice(0, MAX_FINDINGS),
      munche: usesGaejosikMunche(this.preset) ? lintMuncheText(body).slice(0, MAX_FINDINGS) : []
    };
  }

  private refresh(): void {
    this.snapshot = this.lint();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { cls: "setting-item-description", text: t("gongmun.lint.subtitle") });
    const { cleanups, notation, munche } = this.snapshot;
    if (!cleanups.length && !notation.length && !munche.length) {
      contentEl.createEl("p", { text: t("gongmun.lint.none") });
    }
    if (cleanups.length) {
      contentEl.createEl("h4", { text: t("gongmun.lint.cleanups") });
      const list = contentEl.createEl("ul", { cls: "hanmark-gongmun-lint-list" });
      for (const cleanup of cleanups) {
        const item = list.createEl("li");
        this.lineButton(item, cleanup.line);
        item.createSpan({ text: ` ${tKey(CLEANUP_LABELS[cleanup.kind])}: ` });
        item.createEl("code", { text: cleanup.match });
      }
    }
    this.renderFindings(t("gongmun.lint.notation"), notation);
    this.renderFindings(t("gongmun.lint.munche"), munche);
  }

  private renderFindings(title: string, findings: ReadonlyArray<GongmunLintFinding | MuncheLintFinding>): void {
    if (!findings.length) return;
    this.contentEl.createEl("h4", { text: title });
    const list = this.contentEl.createEl("ul", { cls: "hanmark-gongmun-lint-list" });
    for (const finding of findings) {
      const item = list.createEl("li", { cls: `is-${finding.severity}` });
      this.lineButton(item, finding.line);
      item.createSpan({
        cls: "hanmark-gongmun-lint-severity",
        text: ` ${finding.severity === "error" ? t("gongmun.lint.error") : t("gongmun.lint.warning")} · `
      });
      item.createSpan({ text: finding.message });
      if (finding.match) item.createEl("code", { text: finding.match });
      if (finding.suggest) {
        const suggest = item.createDiv({ cls: "hanmark-gongmun-lint-suggest" });
        suggest.createSpan({ text: t("gongmun.lint.suggest", { text: finding.suggest }) });
        const apply = suggest.createEl("button", { text: t("gongmun.lint.apply") });
        apply.onclick = () => this.applySuggestion(finding);
      }
    }
  }

  private lineButton(container: HTMLElement, line: number): void {
    const button = container.createEl("button", {
      cls: "hanmark-gongmun-lint-line",
      text: t("gongmun.lint.line", { line }),
      attr: { "aria-label": t("gongmun.lint.goTo") }
    });
    button.onclick = () => this.goTo(line);
  }

  private editorLine(line: number): number {
    return (this.snapshot?.offset ?? 0) + line - 1;
  }

  private goTo(line: number): void {
    const target = this.editorLine(line);
    this.editor.setCursor({ line: target, ch: 0 });
    this.editor.scrollIntoView({ from: { line: target, ch: 0 }, to: { line: target, ch: 0 } }, true);
    this.editor.focus();
  }

  private applySuggestion(finding: GongmunLintFinding | MuncheLintFinding): void {
    if (!finding.suggest || !finding.match) return;
    const target = this.editorLine(finding.line);
    const text = target < this.editor.lineCount() ? this.editor.getLine(target) : "";
    const at = text.indexOf(finding.match);
    if (at < 0) {
      new Notice(t("gongmun.lint.stale"));
      this.refresh();
      return;
    }
    this.editor.replaceRange(
      finding.suggest,
      { line: target, ch: at },
      { line: target, ch: at + finding.match.length }
    );
    new Notice(t("gongmun.lint.applied", { line: finding.line }));
    this.refresh();
  }
}
