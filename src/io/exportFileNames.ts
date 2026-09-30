/**
 * File names of official-document exports (R-028): the form goes into the name, so
 * "무제 - 업무보고.hwpx" says which form made it instead of "무제 공문서 (9).hwpx".
 */

/** Longest form label written into a file name (a user's own form name can be long). */
export const FILE_LABEL_MAX = 40;

/**
 * A label safe in file names on every system and in wikilinks: path separators,
 * reserved characters, `# ^ [ ]`, and control characters become spaces.
 */
export function safeFileLabel(value: string, max = FILE_LABEL_MAX): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/gu, " ")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, max).join("").trim();
}

/** `{note} - {form}`; the note name alone when the form has no usable label. */
export function gongmunVaultStem(noteName: string, label: string): string {
  return label ? `${noteName} - ${label}` : noteName;
}

/** Notes imported from a Hangul file: `{source}_{form}_{time}{ext}` beside the usual `_변환_` names. */
export function sourceContractGongmunName(stem: string, label: string, stamp: string, extension = ".hwpx"): string {
  return label ? `${stem}_${label}_${stamp}${extension}` : `${stem}_${stamp}${extension}`;
}

/**
 * The first free vault path `{folder}{stem}{ext}`, then `{stem} (1){ext}`, `(2)`…
 * `folder` is "" or ends with "/". `exists` decides what is taken; pass a
 * case-insensitive check so "A.hwpx" and "a.hwpx" never both appear on case-insensitive disks.
 */
export function freeVaultPath(folder: string, stem: string, extension: string, exists: (path: string) => boolean): string {
  let candidate = `${folder}${stem}${extension}`;
  for (let index = 1; exists(candidate); index += 1) candidate = `${folder}${stem} (${index})${extension}`;
  return candidate;
}
