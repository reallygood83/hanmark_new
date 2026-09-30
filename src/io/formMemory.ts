/**
 * The official-document form last chosen for each note (R-028).
 *
 * Stored in the plugin settings as `{ notePath: formId }`. Insertion order is the
 * least-recently-used order: remembering a note moves it to the end, and the oldest
 * entries are dropped beyond the limit. Every function returns a new object.
 */
export type FormMemory = Record<string, string>;

export const FORM_MEMORY_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeFormMemory(value: unknown, limit = FORM_MEMORY_LIMIT): FormMemory {
  const memory: FormMemory = {};
  if (!isRecord(value)) return memory;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => entry[0].trim() !== "" && typeof entry[1] === "string" && entry[1].trim() !== ""
  );
  for (const [path, id] of entries.slice(Math.max(0, entries.length - limit))) memory[path] = id.trim();
  return memory;
}

export function rememberNoteForm(
  memory: Readonly<FormMemory>,
  path: string,
  formId: string,
  limit = FORM_MEMORY_LIMIT
): FormMemory {
  const next: FormMemory = {};
  for (const [key, value] of Object.entries(memory)) if (key !== path) next[key] = value;
  next[path] = formId;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) delete next[key];
  return next;
}

/** The remembered form of a note, when it is still one of the forms (`isKnown`). */
export function rememberedNoteForm(
  memory: Readonly<FormMemory>,
  path: string,
  isKnown: (formId: string) => boolean
): string | undefined {
  const id = memory[path];
  return id && isKnown(id) ? id : undefined;
}

/** Where `path` lives after `oldPath` (a file or a folder) became `newPath`; null when unaffected. */
export function movedPath(path: string, oldPath: string, newPath: string): string | null {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
  return null;
}

/** True when `path` is `target` or lies inside the folder `target`. */
export function isSameOrInside(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`);
}

/** Follows a rename of a note or a folder; entries keep their place in the order. */
export function renameNotePaths(memory: Readonly<FormMemory>, oldPath: string, newPath: string): FormMemory {
  const next: FormMemory = {};
  for (const [key, value] of Object.entries(memory)) next[movedPath(key, oldPath, newPath) ?? key] = value;
  return next;
}

/** Forgets a deleted note, or every note inside a deleted folder. */
export function forgetNotePaths(memory: Readonly<FormMemory>, path: string): FormMemory {
  const next: FormMemory = {};
  for (const [key, value] of Object.entries(memory)) if (!isSameOrInside(key, path)) next[key] = value;
  return next;
}
