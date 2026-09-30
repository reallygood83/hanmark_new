import type { MessageKey } from "../i18n";

/**
 * Toolbar groups and their priorities (R-028). When a row is narrower than its
 * groups, the lowest-priority groups move into the row's "⋯" menu so each row stays
 * one line; priority 100 groups never move.
 */
export type ToolbarRowId = "main" | "format";

export type ToolbarGroupId =
  | "files"
  | "exports"
  | "history"
  | "inserts"
  | "previews"
  | "templates"
  | "style"
  | "headings"
  | "inline"
  | "blocks"
  | "tools"
  | "indent";

export interface ToolbarGroupSpec {
  id: ToolbarGroupId;
  row: ToolbarRowId;
  priority: number;
  /** Section title in the "⋯" menu. */
  label: MessageKey;
}

export const PINNED_GROUP_PRIORITY = 100;

export const TOOLBAR_GROUPS: readonly ToolbarGroupSpec[] = [
  { id: "files", row: "main", priority: 90, label: "toolbar.group.files" },
  // Exports go last: even they move into the menu when a pane is too narrow for them.
  { id: "exports", row: "main", priority: 99, label: "toolbar.group.exports" },
  { id: "history", row: "main", priority: 70, label: "toolbar.group.history" },
  { id: "inserts", row: "main", priority: 60, label: "toolbar.group.inserts" },
  { id: "previews", row: "main", priority: 80, label: "toolbar.group.previews" },
  { id: "templates", row: "main", priority: 40, label: "toolbar.group.templates" },
  { id: "style", row: "format", priority: 100, label: "toolbar.group.style" },
  { id: "headings", row: "format", priority: 90, label: "toolbar.group.headings" },
  { id: "inline", row: "format", priority: 95, label: "toolbar.group.inline" },
  { id: "blocks", row: "format", priority: 80, label: "toolbar.group.blocks" },
  { id: "tools", row: "format", priority: 70, label: "toolbar.group.tools" },
  { id: "indent", row: "format", priority: 50, label: "toolbar.group.indent" }
];

export function toolbarGroup(id: ToolbarGroupId): ToolbarGroupSpec {
  const spec = TOOLBAR_GROUPS.find((group) => group.id === id);
  if (!spec) throw new Error(`Unknown toolbar group ${id}`);
  return spec;
}

export interface MeasuredGroup {
  id: string;
  /** Width of the group with its divider, in CSS pixels. */
  width: number;
  priority: number;
}

/**
 * Groups to move into the "⋯" menu so the rest fits `available` pixels, leaving room
 * for the "⋯" button (`overflowWidth`). Lowest priority goes first; among equal
 * priorities, the group further right goes first. Pinned groups always stay.
 */
export function chooseHiddenGroups(
  groups: readonly MeasuredGroup[],
  available: number,
  overflowWidth: number
): Set<string> {
  const hidden = new Set<string>();
  let total = groups.reduce((sum, group) => sum + group.width, 0);
  if (total <= available) return hidden;
  const order = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.priority < PINNED_GROUP_PRIORITY)
    .sort((left, right) => left.group.priority - right.group.priority || right.index - left.index);
  for (const { group } of order) {
    if (total + overflowWidth <= available) break;
    hidden.add(group.id);
    total -= group.width;
  }
  return hidden;
}
