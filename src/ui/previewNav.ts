import { setIcon } from "obsidian";
import { t } from "../i18n";
import { setPhase } from "./motion";

/**
 * The previews' navigation row (R-028): previous/next page with "3 / 12", zoom out /
 * fit width / zoom in, "follow the cursor", and a status chip that rings while the
 * preview is drawn. Built once when a preview opens; the view only updates it, so the
 * row never flickers while the preview redraws.
 */
export type PreviewStatus = "ready" | "working" | "paused" | "failed";

const STATUS_TEXT = {
  ready: "preview.nav.status.ready",
  working: "preview.nav.status.working",
  paused: "preview.nav.status.paused",
  failed: "preview.nav.status.failed"
} as const satisfies Record<PreviewStatus, string>;

export interface PreviewNavHandlers {
  /** -1 for the previous page, 1 for the next. */
  page: (delta: -1 | 1) => void;
  /** -1 zooms out, 1 zooms in, 0 fits the pane width. */
  zoom: (direction: -1 | 0 | 1) => void;
  /** Present when the preview can follow the cursor. */
  follow?: (on: boolean) => void;
  /** Adds the status chip (the DOCX preview has its own). */
  status?: boolean;
}

function iconButton(parent: HTMLElement, icon: string, label: string, run: () => void): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "clickable-icon hanmark-preview-nav-button",
    attr: { type: "button", "aria-label": label, title: label }
  });
  setIcon(button, icon);
  button.onclick = run;
  return button;
}

export class PreviewNav {
  readonly el: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly pageLabel: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly zoomGroup: HTMLElement;
  private readonly zoomOut: HTMLButtonElement;
  private readonly zoomValue: HTMLButtonElement;
  private readonly zoomIn: HTMLButtonElement;
  private readonly followButton: HTMLButtonElement | null = null;
  private readonly chip: HTMLElement | null = null;

  constructor(parent: HTMLElement, handlers: PreviewNavHandlers) {
    this.el = parent.createDiv({ cls: "hanmark-preview-nav", attr: { role: "toolbar", "aria-label": t("preview.nav.label") } });
    this.pages = this.el.createDiv({ cls: "hanmark-preview-nav-group" });
    this.previous = iconButton(this.pages, "chevron-left", t("preview.nav.previous"), () => handlers.page(-1));
    this.pageLabel = this.pages.createSpan({ cls: "hanmark-preview-nav-page" });
    this.next = iconButton(this.pages, "chevron-right", t("preview.nav.next"), () => handlers.page(1));

    this.zoomGroup = this.el.createDiv({ cls: "hanmark-preview-nav-group" });
    this.zoomOut = iconButton(this.zoomGroup, "minus", t("preview.nav.zoomOut"), () => handlers.zoom(-1));
    this.zoomValue = this.zoomGroup.createEl("button", {
      cls: "hanmark-preview-nav-zoom",
      attr: { type: "button", title: t("preview.nav.fitTitle") }
    });
    this.zoomValue.onclick = () => handlers.zoom(0);
    this.zoomIn = iconButton(this.zoomGroup, "plus", t("preview.nav.zoomIn"), () => handlers.zoom(1));

    const follow = handlers.follow;
    if (follow) {
      const button = iconButton(this.el, "locate", t("preview.nav.follow"), () => {
        const on = button.getAttribute("aria-pressed") !== "true";
        this.setFollow(on);
        follow(on);
      });
      this.followButton = button;
    }
    if (handlers.status !== false) {
      this.chip = this.el.createSpan({ cls: "hanmark-preview-chip", attr: { role: "status", "aria-live": "polite" } });
      this.setStatus("ready");
    }
    this.setPages(0, 0);
  }

  /** Shows "page / total"; hides the page buttons when there are no pages. */
  setPages(page: number, total: number): void {
    this.pages.toggleClass("is-hidden", total < 1);
    this.pageLabel.setText(t("preview.nav.page", { page, total }));
    this.previous.disabled = page <= 1;
    this.next.disabled = page >= total;
  }

  setZoom(fitted: boolean, percent: number, canZoomOut: boolean, canZoomIn: boolean): void {
    this.zoomValue.setText(fitted ? t("preview.nav.fit") : `${Math.round(percent)}%`);
    this.zoomValue.toggleClass("is-on", !fitted);
    this.zoomValue.setAttribute("aria-label", fitted ? t("preview.nav.fitTitle") : t("preview.nav.zoomReset", { percent: Math.round(percent) }));
    this.zoomOut.disabled = !canZoomOut;
    this.zoomIn.disabled = !canZoomIn;
  }

  setZoomVisible(visible: boolean): void {
    this.zoomGroup.toggleClass("is-hidden", !visible);
  }

  setFollow(on: boolean): void {
    if (!this.followButton) return;
    this.followButton.setAttribute("aria-pressed", String(on));
    this.followButton.toggleClass("is-on", on);
  }

  /** The chip rings while the preview is drawn; `text` replaces the state's words (image progress). */
  setStatus(state: PreviewStatus, text?: string): void {
    const chip = this.chip;
    if (!chip) return;
    chip.dataset.state = state;
    chip.setText(text ?? t(STATUS_TEXT[state]));
    setPhase(chip, state === "working" ? "waiting" : null);
  }
}
