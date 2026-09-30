import { en } from "./en";
import { ko } from "./ko";

/**
 * HanMark's two interface languages (2.7.0 W9).
 *
 * `ko.ts` is the source of truth: every key and every `{placeholder}` starts there.
 * `en.ts` must satisfy {@link MessageTable}, so a missing or extra English key is a
 * compile error, and `scripts/check-i18n.mjs` rejects placeholder drift between them.
 *
 * Two languages are resolved separately:
 * - the UI language (menus, dialogs, notices, reports) follows Obsidian's language
 *   unless the user pins one in settings;
 * - the output language (callout labels, placeholders written into the exported
 *   document) belongs to the document, so "auto" reads the document itself and never
 *   depends on the machine it is exported on.
 */
export type Locale = "ko" | "en";

/** Stored setting: follow the environment ("auto") or pin one language. */
export type LanguagePreference = "auto" | Locale;

export type MessageKey = keyof typeof ko;

/** English plural forms, selected by the `count` parameter. */
export interface PluralMessage {
  readonly one: string;
  readonly other: string;
}

export type MessageTable = { readonly [K in MessageKey]: string | PluralMessage };

type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type MessageParams<K extends MessageKey> = {
  readonly [P in Placeholders<(typeof ko)[K]>]: string | number;
};

/** Messages with placeholders require their parameters; others take none. */
export type MessageArgs<K extends MessageKey> = [Placeholders<(typeof ko)[K]>] extends [never]
  ? []
  : [params: MessageParams<K>];

type LooseParams = Readonly<Record<string, string | number>>;

const TABLES: Readonly<Record<Locale, MessageTable>> = { ko, en };
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/gu;
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/u;

let uiLocale: Locale = "ko";

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === "ko" || value === "en" ? value : "auto";
}

/**
 * Korean when Obsidian runs in Korean, English otherwise, unless pinned.
 * `obsidianLanguage` is the value of Obsidian's `getLanguage()`.
 */
export function resolveUiLocale(preference: unknown, obsidianLanguage: unknown): Locale {
  const pinned = normalizeLanguagePreference(preference);
  if (pinned !== "auto") return pinned;
  if (typeof obsidianLanguage !== "string") return "en";
  const language = obsidianLanguage.trim().toLowerCase();
  return language === "ko" || language.startsWith("ko-") || language.startsWith("ko_") ? "ko" : "en";
}

/**
 * "auto" writes Korean labels into documents that contain Hangul and English labels
 * otherwise. The decision depends only on the document and the setting, so the same
 * note exports identically on every computer (product contract 3).
 */
export function resolveOutputLocale(preference: unknown, documentText: string): Locale {
  const pinned = normalizeLanguagePreference(preference);
  if (pinned !== "auto") return pinned;
  return containsHangul(documentText) ? "ko" : "en";
}

export function containsHangul(text: string): boolean {
  return HANGUL.test(text);
}

export function setUiLocale(locale: Locale): void {
  uiLocale = locale;
}

export function currentUiLocale(): Locale {
  return uiLocale;
}

export function messageTable(locale: Locale): MessageTable {
  return TABLES[locale];
}

/**
 * Untyped lookup for keys chosen at runtime (for example from a code table).
 * Prefer {@link t}, which checks placeholders at compile time.
 */
export function translate(locale: Locale, key: MessageKey, params?: LooseParams): string {
  const entry = TABLES[locale][key] ?? ko[key];
  const template =
    typeof entry === "string"
      ? entry
      : Number(params?.count) === 1
        ? entry.one
        : entry.other;
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  );
}

/** Interface text in the current UI language. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>): string {
  return translate(uiLocale, key, args[0]);
}

/** Interface text for a key chosen at runtime (placeholders are not type-checked). */
export function tKey(key: MessageKey, params?: LooseParams): string {
  return translate(uiLocale, key, params);
}

/** Document text in an explicitly resolved output language. */
export function tOut<K extends MessageKey>(locale: Locale, key: K, ...args: MessageArgs<K>): string {
  return translate(locale, key, args[0]);
}
