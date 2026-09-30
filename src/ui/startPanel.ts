import { setIcon, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { RecentExport } from "../io/recentExports";

/**
 * HanMark's section on empty tabs (R-028): start a note, import a document, and reopen
 * the files HanMark exported recently. Only tabs in the main area and pop-out windows
 * get it (not the sidebars); it is removed when turned off or when HanMark unloads.
 */
export interface StartPanelHost {
  app: App;
  enabled: () => boolean;
  recentExports: () => RecentExport[];
  importDocument: () => void;
  newNote: () => void;
  /** Opens an exported HWPX in HanMark's viewer, in the empty tab. */
  openHwpx: (file: TFile, leaf: WorkspaceLeaf) => void;
  /** Shows a DOCX or HTML file in the operating-system file manager (desktop only). */
  reveal?: (path: string) => void;
}

const RECENT_SHOWN = 5;

export class StartPanels {
  private readonly panels = new Set<HTMLElement>();

  constructor(private readonly host: StartPanelHost) {}

  /** Adds the section to every empty tab, refreshes the recent files, or removes it all when off. */
  sync(): void {
    if (!this.host.enabled()) {
      this.removeAll();
      return;
    }
    const { workspace } = this.host.app;
    for (const leaf of workspace.getLeavesOfType("empty")) {
      const root = leaf.getRoot();
      if (root === workspace.leftSplit || root === workspace.rightSplit) continue;
      const container = leaf.view.containerEl;
      const place =
        container.querySelector<HTMLElement>(".empty-state-container") ?? container.querySelector<HTMLElement>(".view-content");
      if (!place) continue;
      let panel = place.querySelector<HTMLElement>(".hanmark-start-panel");
      if (!panel) {
        panel = place.createDiv({ cls: "hanmark-start-panel hanmark-arrive" });
        this.panels.add(panel);
      }
      this.render(panel, leaf);
    }
    for (const panel of this.panels) if (!panel.isConnected) this.panels.delete(panel);
  }

  removeAll(): void {
    for (const panel of this.panels) panel.remove();
    this.panels.clear();
  }

  private recentFiles(): Array<{ item: RecentExport; file: TFile }> {
    const found: Array<{ item: RecentExport; file: TFile }> = [];
    for (const item of this.host.recentExports()) {
      const file = this.host.app.vault.getAbstractFileByPath(item.path);
      if (file instanceof TFile) found.push({ item, file });
      if (found.length >= RECENT_SHOWN) break;
    }
    return found;
  }

  private render(panel: HTMLElement, leaf: WorkspaceLeaf): void {
    const recent = this.recentFiles();
    // Redraw only when the list changed, so moving between tabs does not rebuild it.
    const signature = JSON.stringify(recent.map(({ file, item }) => [file.path, item.format]));
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    panel.empty();
    panel.createDiv({ cls: "hanmark-start-title", text: t("startPanel.title") });
    const actions = panel.createDiv({ cls: "hanmark-start-actions" });
    this.action(actions, "file-input", t("startPanel.import"), () => this.host.importDocument());
    this.action(actions, "file-plus", t("startPanel.newNote"), () => this.host.newNote());
    if (!recent.length) return;

    panel.createDiv({ cls: "hanmark-start-heading", text: t("startPanel.recent") });
    const list = panel.createEl("ul", { cls: "hanmark-start-recent" });
    for (const { item, file } of recent) {
      const button = list.createEl("li").createEl("button", {
        cls: "hanmark-start-file",
        attr: { type: "button", title: file.path }
      });
      button.createSpan({ cls: "hanmark-start-format", text: item.format.toUpperCase() });
      button.createSpan({ cls: "hanmark-start-name", text: file.name });
      if (file.parent && !file.parent.isRoot()) button.createSpan({ cls: "hanmark-start-folder", text: file.parent.path });
      const reveal = this.host.reveal;
      if (item.format === "hwpx") {
        button.setAttribute("aria-label", t("startPanel.openHwpx", { name: file.name }));
        button.onclick = () => this.host.openHwpx(file, leaf);
      } else if (reveal) {
        button.setAttribute("aria-label", t("startPanel.reveal", { name: file.name }));
        button.onclick = () => reveal(file.path);
      } else {
        button.disabled = true;
      }
    }
  }

  private action(parent: HTMLElement, icon: string, label: string, run: () => void): void {
    const button = parent.createEl("button", { cls: "hanmark-start-action", attr: { type: "button" } });
    setIcon(button.createSpan({ cls: "hanmark-start-action-icon" }), icon);
    button.createSpan({ text: label });
    button.onclick = run;
  }
}
