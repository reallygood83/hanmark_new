import { Menu } from "obsidian";

/**
 * The "⋯" menu of a toolbar row (R-028): the groups a narrow pane hides, as sections.
 * Obsidian has no public submenu API, so a menu button becomes "Name ▸" and opens a
 * second menu at the same place.
 */
export interface OverflowAction {
  label: string;
  icon?: string;
  run: (event: MouseEvent | KeyboardEvent) => void;
}

export interface OverflowEntry {
  label: string;
  icon?: string;
  run?: (event: MouseEvent | KeyboardEvent) => void;
  children?: readonly OverflowAction[];
}

export interface OverflowSection {
  title: string;
  entries: readonly OverflowEntry[];
}

const SUBMENU_MARK = " ▸";

function menuPosition(anchor: HTMLElement): { x: number; y: number } {
  const rect = anchor.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.bottom + 2) };
}

export function showOverflowActions(anchor: HTMLElement, actions: readonly OverflowAction[], position = menuPosition(anchor)): void {
  const menu = new Menu();
  for (const action of actions) {
    menu.addItem((item) => {
      item.setTitle(action.label);
      if (action.icon) item.setIcon(action.icon);
      item.onClick((event) => action.run(event));
    });
  }
  menu.showAtPosition(position, anchor.doc);
}

export function showToolbarOverflow(anchor: HTMLElement, sections: readonly OverflowSection[]): void {
  const position = menuPosition(anchor);
  const menu = new Menu();
  sections.forEach((section, index) => {
    if (index > 0) menu.addSeparator();
    menu.addItem((item) => item.setTitle(section.title).setIsLabel(true));
    for (const entry of section.entries) {
      menu.addItem((item) => {
        item.setTitle(entry.children ? `${entry.label}${SUBMENU_MARK}` : entry.label);
        if (entry.icon) item.setIcon(entry.icon);
        item.onClick((event) => {
          const children = entry.children;
          if (children) {
            // Let the first menu close before the second one opens.
            anchor.win.setTimeout(() => showOverflowActions(anchor, children, position), 0);
            return;
          }
          entry.run?.(event);
        });
      });
    }
  });
  menu.showAtPosition(position, anchor.doc);
}
