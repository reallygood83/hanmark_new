import { isSameOrInside, movedPath } from "./formMemory";

/**
 * Files HanMark recently wrote into the vault (R-028), newest first, for the start
 * panel of an empty tab. Only vault paths are kept: files saved elsewhere through a
 * save dialog cannot be reopened without asking the user again.
 */
export type RecentExportFormat = "hwpx" | "docx" | "html";

export interface RecentExport {
  path: string;
  format: RecentExportFormat;
  /** Milliseconds since the epoch. */
  at: number;
}

export const RECENT_EXPORT_LIMIT = 8;

const FORMATS: readonly RecentExportFormat[] = ["hwpx", "docx", "html"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecentExportFormat(value: unknown): value is RecentExportFormat {
  return FORMATS.includes(value as RecentExportFormat);
}

export function normalizeRecentExports(value: unknown, limit = RECENT_EXPORT_LIMIT): RecentExport[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: RecentExport[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.path !== "string" || !item.path.trim() || !isRecentExportFormat(item.format)) continue;
    const path = item.path.trim();
    if (seen.has(path)) continue;
    seen.add(path);
    list.push({ path, format: item.format, at: typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0 });
    if (list.length >= limit) break;
  }
  return list;
}

export function recordRecentExport(
  list: readonly RecentExport[],
  entry: RecentExport,
  limit = RECENT_EXPORT_LIMIT
): RecentExport[] {
  return [entry, ...list.filter((item) => item.path !== entry.path)].slice(0, limit);
}

export function renameRecentExports(list: readonly RecentExport[], oldPath: string, newPath: string): RecentExport[] {
  return list.map((item) => {
    const path = movedPath(item.path, oldPath, newPath);
    return path ? { ...item, path } : { ...item };
  });
}

export function forgetRecentExports(list: readonly RecentExport[], path: string): RecentExport[] {
  return list.filter((item) => !isSameOrInside(item.path, path)).map((item) => ({ ...item }));
}
