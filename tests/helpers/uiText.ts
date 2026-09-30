import { ko } from "../../src/i18n/ko";

/**
 * Interface text lives in src/i18n (2.7.0 W9). A source file "shows" a Korean text
 * when it contains the text itself (not yet migrated) or references a message key
 * whose Korean text matches. Source-level UI tests use this instead of matching the
 * Korean literal, so they keep testing what the user sees in either language.
 */
export function showsText(source: string, pattern: RegExp): boolean {
  if (pattern.test(source)) return true;
  return Object.entries(ko).some(
    ([key, text]) => pattern.test(text) && source.includes(`"${key}"`)
  );
}

/** Message keys whose Korean text matches `pattern`. */
export function keysForText(pattern: RegExp): string[] {
  return Object.entries(ko)
    .filter(([, text]) => pattern.test(text))
    .map(([key]) => key);
}
