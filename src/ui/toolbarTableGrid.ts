import { t } from "../i18n";
import { moveGridSelection, type GridSize } from "./toolbarState";

/**
 * Table-size picker of the toolbar (R-028): hover or use the arrow keys over an 8 × 8
 * grid, then click or press Enter. The popover lives in the anchor's own document
 * (popout windows) and closes on Escape, on a choice, or on a click elsewhere.
 */
const GRID_MAX = 8;
const GRID_WIDTH = 8 * 18 + 7 * 3 + 16;

let current: { close(): void } | null = null;

export function openTableGrid(anchor: HTMLElement, onChoose: (size: GridSize) => void): void {
  current?.close();
  const doc = anchor.doc;
  const win = anchor.win;
  const rect = anchor.getBoundingClientRect();
  const popover = doc.body.createDiv({
    cls: "hanmark-table-grid hanmark-arrive",
    attr: { role: "dialog", "aria-label": t("toolbar.table.label"), tabindex: "-1" }
  });
  const left = Math.max(8, Math.min(Math.round(rect.left), win.innerWidth - GRID_WIDTH - 8));
  popover.setCssProps({ "--hanmark-grid-left": `${left}px`, "--hanmark-grid-top": `${Math.round(rect.bottom + 4)}px` });
  const grid = popover.createDiv({ cls: "hanmark-table-grid-cells" });
  const status = popover.createDiv({ cls: "hanmark-table-grid-status", attr: { role: "status", "aria-live": "polite" } });
  let size: GridSize = { rows: 3, cols: 3 };
  const cells: Array<{ element: HTMLElement; row: number; col: number }> = [];

  const paint = (): void => {
    for (const cell of cells) cell.element.toggleClass("is-selected", cell.row <= size.rows && cell.col <= size.cols);
    status.setText(t("toolbar.table.size", { rows: size.rows, cols: size.cols }));
  };
  const close = (): void => {
    doc.removeEventListener("pointerdown", outside, true);
    popover.remove();
    if (current === handle) current = null;
  };
  const choose = (): void => {
    close();
    onChoose({ ...size });
  };
  const outside = (event: PointerEvent): void => {
    if (!popover.contains(event.target as Node)) close();
  };
  const handle = { close };

  for (let row = 1; row <= GRID_MAX; row += 1) {
    for (let col = 1; col <= GRID_MAX; col += 1) {
      const element = grid.createDiv({ cls: "hanmark-table-grid-cell" });
      element.addEventListener("pointerenter", () => {
        size = { rows: row, cols: col };
        paint();
      });
      element.addEventListener("click", choose);
      cells.push({ element, row, col });
    }
  }
  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      anchor.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose();
      return;
    }
    const next = moveGridSelection(size, event.key, GRID_MAX);
    if (next) {
      event.preventDefault();
      size = next;
      paint();
    }
  });
  doc.addEventListener("pointerdown", outside, true);
  current = handle;
  paint();
  popover.focus();
}
