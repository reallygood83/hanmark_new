import { App, Modal, Notice } from "obsidian";
import { t } from "../i18n";
import { errorMessage, isRecord } from "../utils/errors";

export interface PatchSkipLike {
  reason?: string;
  before?: string;
  after?: string;
}

export interface SaveReportArgs {
  title: string;
  applied?: number;
  skipped?: PatchSkipLike[];
  verification?: unknown;
  outputPath?: string;
  note?: string;
  /**
   * If provided, renders a "➕ 추가 내용까지 넣어 새 한글 파일로 저장" button.
   * Generates a fresh .hwpx from the FULL edited body (kordoc default style — the
   * original's formatting is not preserved on this path) and returns the saved path.
   */
  generateFull?: () => Promise<string>;
}

/** Surfaces a 저장 result — applied / skipped[].reason / verification — with paths. */
export class HwpSaveReportModal extends Modal {
  constructor(app: App, private readonly args: SaveReportArgs) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.args.title });

    if (this.args.note) contentEl.createEl("p", { text: this.args.note });

    if (typeof this.args.applied === "number") {
      contentEl.createEl("p", { text: t("hwpReport.applied", { count: this.args.applied }) });
    }

    const skipped = this.args.skipped ?? [];
    if (skipped.length) {
      contentEl.createEl("p", {
        text: t("hwpReport.skipped", { count: skipped.length })
      });
      const ul = contentEl.createEl("ul");
      for (const s of skipped.slice(0, 50)) {
        ul.createEl("li", { text: s.reason || t("hwpReport.noReason") });
      }
      if (skipped.length > 50) ul.createEl("li", { text: t("hwpReport.more", { count: skipped.length - 50 }) });
    }

    if (this.args.verification !== undefined) {
      const verification = this.args.verification;
      const stats = isRecord(verification) && verification.stats !== undefined
        ? verification.stats
        : verification;
      try {
        const serialized = JSON.stringify(stats);
        if (serialized) contentEl.createEl("p", { text: t("hwpReport.verification", { details: serialized.slice(0, 400) }) });
      } catch {
        /* ignore non-serializable verification payloads */
      }
    }

    if (this.args.outputPath) contentEl.createEl("p", { text: t("hwpReport.outputFile", { path: this.args.outputPath }) });
    const generateFull = this.args.generateFull;
    if (generateFull) {
      const genWrap = contentEl.createDiv();
      genWrap.setCssStyles({
        marginTop: "14px",
        paddingTop: "12px",
        borderTop: "1px solid var(--background-modifier-border)"
      });
      const hint = genWrap.createEl("p", {
        text: t("hwpReport.generateFull.hint")
      });
      hint.setCssStyles({ fontSize: "0.9em", opacity: "0.8" });
      const genBtn = genWrap.createEl("button", { text: t("hwpReport.generateFull.button") });
      genBtn.classList.add("mod-cta");
      const resultEl = genWrap.createEl("p");
      resultEl.setCssStyles({ fontSize: "0.9em", marginTop: "8px" });
      genBtn.onclick = async () => {
        const original = genBtn.textContent || "";
        genBtn.disabled = true;
        genBtn.textContent = t("hwpReport.generateFull.creating");
        try {
          const savedPath = await generateFull();
          const name = savedPath.split(/[\\/]/).pop() || savedPath;
          new Notice(t("hwpReport.generateFull.created", { name }));
          resultEl.setText(`✅ ${savedPath}`);
          genBtn.textContent = t("hwpReport.generateFull.done");
        } catch (error: unknown) {
          const message = errorMessage(error);
          new Notice(t("hwpReport.generateFull.failed", { detail: message }));
          resultEl.setText(`⚠️ ${message}`);
          genBtn.disabled = false;
          genBtn.textContent = original;
        }
      };
    }

    const row = contentEl.createDiv();
    row.setCssStyles({ marginTop: "14px" });
    const close = row.createEl("button", { text: t("common.close") });
    close.onclick = () => this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
