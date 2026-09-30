import { FuzzySuggestModal, Modal, Notice, Setting, TFile, type App } from "obsidian";
import { compareNoteBaseName, renderCompareNote } from "../io/compareNote";
import { compareDocuments } from "../io/documentDiff";
import { IMPORT_EXTENSIONS, isImportableExtension, uniqueNotePath } from "../io/importRunner";
import type { FileGateway } from "../io/fileGateway";
import { normalizeImportedImageFolder } from "../legacy-port/settings";
import type { ChangeMark } from "../io/wordDiff";
import { errorMessage } from "../utils/errors";
import { resolveOutputLocale, t, type LanguagePreference } from "../i18n";

/** One side of the comparison: a Vault file or an external file read into memory. */
export interface CompareSource {
  name: string;
  bytes: Uint8Array;
}

export interface CompareHost {
  app: App;
  gateway: FileGateway;
  /** Folder for the comparison note (import destination policy). */
  folderFor(source?: CompareSource & { vaultPath?: string }): string;
  outputLanguage(): LanguagePreference;
}

class VaultDocumentSuggest extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly choose: (file: TFile) => void) {
    super(app);
    this.setPlaceholder(t("compare.pickVaultPlaceholder"));
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => isImportableExtension(file.extension));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.choose(file);
  }
}

/**
 * Compare two documents (2.7.0 W7): HWP, HWPX, PDF, DOCX, XLSX in any combination.
 * The result is a new note with an old–new comparison table.
 */
export class CompareModal extends Modal {
  private sources: Array<(CompareSource & { vaultPath?: string }) | null> = [null, null];
  private includeUnchanged = false;
  private mark: ChangeMark = "bold";
  private running = false;

  constructor(private readonly host: CompareHost, first?: TFile) {
    super(host.app);
    if (first) void this.useVaultFile(0, first);
  }

  onOpen(): void {
    this.modalEl.addClass("hanmark-compare-modal");
    this.titleEl.setText(t("compare.title"));
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async useVaultFile(slot: 0 | 1, file: TFile): Promise<void> {
    try {
      this.sources[slot] = {
        name: file.name,
        bytes: new Uint8Array(await this.app.vault.readBinary(file)),
        vaultPath: file.path
      };
      this.render();
    } catch (error: unknown) {
      new Notice(errorMessage(error));
    }
  }

  private async pickExternal(slot: 0 | 1): Promise<void> {
    try {
      const [picked] = await this.host.gateway.pickFiles({ extensions: [...IMPORT_EXTENSIONS], multiple: false });
      if (!picked) return;
      this.sources[slot] = { name: picked.name, bytes: picked.bytes };
      this.render();
    } catch (error: unknown) {
      new Notice(errorMessage(error));
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { cls: "setting-item-description", text: t("compare.desc") });
    const slots: Array<[0 | 1, string]> = [[0, t("compare.before")], [1, t("compare.after")]];
    for (const [slot, label] of slots) {
      const source = this.sources[slot];
      new Setting(contentEl)
        .setName(label)
        .setDesc(source ? source.name : t("compare.notSelected"))
        .addButton((button) =>
          button.setButtonText(t("compare.pickVault")).setDisabled(this.running).onClick(() => {
            new VaultDocumentSuggest(this.app, (file) => void this.useVaultFile(slot, file)).open();
          })
        )
        .addButton((button) =>
          button.setButtonText(t("import.modal.pickFiles")).setDisabled(this.running).onClick(() => void this.pickExternal(slot))
        );
    }
    new Setting(contentEl)
      .setName(t("compare.includeUnchanged"))
      .addToggle((toggle) => toggle.setValue(this.includeUnchanged).onChange((value) => (this.includeUnchanged = value)));
    new Setting(contentEl)
      .setName(t("compare.mark.name"))
      .setDesc(t("compare.mark.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bold", t("compare.mark.bold"))
          .addOption("highlight", t("compare.mark.highlight"))
          .setValue(this.mark)
          .onChange((value) => (this.mark = value === "highlight" ? "highlight" : "bold"))
      );
    const actions = contentEl.createDiv({ cls: "hanmark-dialog-actions" });
    actions.createEl("button", { text: t("common.cancel") }).onclick = () => this.close();
    const run = actions.createEl("button", { text: this.running ? t("compare.running") : t("compare.run") });
    run.classList.add("mod-cta");
    run.disabled = this.running || !this.sources[0] || !this.sources[1];
    run.onclick = () => void this.run();
  }

  private async run(): Promise<void> {
    const [before, after] = this.sources;
    if (!before || !after || this.running) return;
    this.running = true;
    this.render();
    try {
      const result = await compareDocuments(before, after);
      const sample = result.diffs
        .map((diff) => `${diff.before?.text ?? ""}${diff.after?.text ?? ""}`)
        .join("")
        .slice(0, 4000);
      const locale = resolveOutputLocale(this.host.outputLanguage(), sample);
      const markdown = renderCompareNote(result, {
        beforeName: before.name,
        afterName: after.name,
        includeUnchanged: this.includeUnchanged,
        mark: this.mark,
        locale
      });
      const folder = normalizeImportedImageFolder(this.host.folderFor(before));
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const path = uniqueNotePath(this.app, folder, compareNoteBaseName(before.name, after.name, locale), new Set());
      const note = await this.app.vault.create(path, markdown);
      await this.app.workspace.getLeaf(true).openFile(note);
      new Notice(t("compare.done", {
        path,
        added: result.stats.added,
        removed: result.stats.removed,
        modified: result.stats.modified
      }));
      this.close();
    } catch (error: unknown) {
      new Notice(t("compare.failed", { detail: errorMessage(error) }), 8_000);
      this.running = false;
      this.render();
    }
  }
}
