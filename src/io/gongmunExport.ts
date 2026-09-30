import type { App, TFile } from "obsidian";
import { incompatibleGongmunWarnings, type FormatProfile, type GongmunOptions, type GongmunPreset } from "kordoc";
import type { AdapterWarning } from "./markdownAdapter";
import { readGongmunProperties, type GongmunPropertyIssue } from "./gongmunProperties";
import { applyTypeFrame, resolveGongmunOptions, withCoverDate } from "./gongmunStyle";
import {
  activeGongmunTemplate,
  getTemplateLibrary,
  gongmunStyleById,
  isGongmunPreset,
  listGongmunStyleChoices,
  setActiveGongmunPresetInMemory,
  setActiveGongmunTemplateInMemory,
  type GongmunStyleChoice,
  type TemplateLibraryHost
} from "./templateLibrary";
import { builtinGongmunStyle } from "./institutionStyles";
import { safeFileLabel } from "./exportFileNames";
import type { GongmunFinishSpec } from "./hwpxFinish";
import type { GongmunOutlineStyle } from "./gongmunOutline";
import type { GenerateHwpxOptions } from "./kordocEngine";
import { t, tKey, translate, type Locale, type MessageKey } from "../i18n";

export const DEFAULT_GONGMUN_PRESET: GongmunPreset = "report";

/** Kordoc's eight official-document presets, in menu order; `fileLabel` names exported files (R-028). */
export const GONGMUN_PRESETS: ReadonlyArray<{
  value: GongmunPreset;
  label: MessageKey;
  description: MessageKey;
  fileLabel: MessageKey;
}> = [
  { value: "official", label: "gongmun.preset.official", description: "gongmun.presetDesc.official", fileLabel: "gongmun.fileName.official" },
  { value: "report", label: "gongmun.preset.report", description: "gongmun.presetDesc.report", fileLabel: "gongmun.fileName.report" },
  { value: "plan", label: "gongmun.preset.plan", description: "gongmun.presetDesc.plan", fileLabel: "gongmun.fileName.plan" },
  { value: "notice", label: "gongmun.preset.notice", description: "gongmun.presetDesc.notice", fileLabel: "gongmun.fileName.notice" },
  { value: "minutes", label: "gongmun.preset.minutes", description: "gongmun.presetDesc.minutes", fileLabel: "gongmun.fileName.minutes" },
  { value: "gaejosik", label: "gongmun.preset.gaejosik", description: "gongmun.presetDesc.gaejosik", fileLabel: "gongmun.fileName.gaejosik" },
  { value: "press", label: "gongmun.preset.press", description: "gongmun.presetDesc.press", fileLabel: "gongmun.fileName.press" },
  { value: "ministry", label: "gongmun.preset.ministry", description: "gongmun.presetDesc.ministry", fileLabel: "gongmun.fileName.ministry" }
];

export function gongmunPresetLabel(preset: GongmunPreset): string {
  const entry = GONGMUN_PRESETS.find((item) => item.value === preset);
  return entry ? tKey(entry.label) : preset;
}

/**
 * One official-document form (R-026): a standard type, a built-in institution form,
 * or the user's own. Choosing a form decides both the document type and the look,
 * so the export window and the preview need a single list instead of a type list
 * plus a style list whose precedence the user could not see.
 */
export interface GongmunFormOption {
  /** "preset:<type>" for a standard type, else the style id. */
  id: string;
  name: string;
  kind: "standard" | "builtin" | "custom";
  /** List group: the institution, "standard", or "mine". */
  group: string;
  preset: GongmunPreset;
  description?: string;
}

const FORM_PRESET_PREFIX = "preset:";

export function gongmunFormId(preset: GongmunPreset): string {
  return `${FORM_PRESET_PREFIX}${preset}`;
}

/** The standard type of a "preset:<type>" form id, else undefined. */
export function presetOfFormId(id: string): GongmunPreset | undefined {
  if (!id.startsWith(FORM_PRESET_PREFIX)) return undefined;
  const preset = id.slice(FORM_PRESET_PREFIX.length);
  return isGongmunPreset(preset) ? preset : undefined;
}

/** A form picked by id: a standard type has no style; an unknown id resolves to nothing. */
function resolveGongmunForm(
  host: TemplateLibraryHost,
  id: string
): { style?: GongmunStyleChoice; preset?: GongmunPreset } | undefined {
  const preset = presetOfFormId(id);
  if (preset) return { preset };
  const style = gongmunStyleById(host, id);
  return style ? { style, preset: style.preset } : undefined;
}

function presetFileLabel(preset: GongmunPreset, locale: Locale): string {
  const entry = GONGMUN_PRESETS.find((item) => item.value === preset);
  return entry ? translate(locale, entry.fileLabel) : preset;
}

/**
 * The form's name in exported file names (R-028), in the note's output language so
 * the same note gets the same name on every computer: the standard type's short
 * name, a built-in form's short name, or the user's own form name (cleaned).
 */
export function gongmunFileLabel(host: TemplateLibraryHost, formId: string, locale: Locale): string {
  const preset = presetOfFormId(formId);
  if (preset) return presetFileLabel(preset, locale);
  const builtin = builtinGongmunStyle(formId);
  if (builtin) return translate(locale, builtin.fileLabel);
  const style = gongmunStyleById(host, formId);
  if (!style) return "";
  return safeFileLabel(style.name) || (style.preset ? presetFileLabel(style.preset, locale) : "");
}

/** Built-in institution forms, then the eight standard types, then the user's forms. */
export function listGongmunForms(host: TemplateLibraryHost): GongmunFormOption[] {
  const fallback = getTemplateLibrary(host).activeGongmunPreset;
  const choices = listGongmunStyleChoices(host);
  const builtIn = choices
    .filter((choice) => choice.builtIn)
    .map<GongmunFormOption>((choice) => ({
      id: choice.id,
      name: choice.name,
      kind: "builtin",
      group: choice.group ?? "",
      preset: choice.preset ?? fallback,
      description: choice.description
    }));
  const standard = GONGMUN_PRESETS.map<GongmunFormOption>((item) => ({
    id: gongmunFormId(item.value),
    name: tKey(item.label),
    kind: "standard",
    group: t("gongmun.form.group.standard"),
    preset: item.value,
    description: tKey(item.description)
  }));
  const mine = choices
    .filter((choice) => !choice.builtIn)
    .map<GongmunFormOption>((choice) => ({
      id: choice.id,
      name: choice.name,
      kind: "custom",
      group: t("gongmun.form.group.mine"),
      preset: choice.preset ?? fallback,
      description: t("gongmun.form.customDesc", { preset: gongmunPresetLabel(choice.preset ?? fallback) })
    }));
  return [...builtIn, ...standard, ...mine];
}

/** The form an export starts with: the active institution form, else the note's type, else the last type. */
export function currentGongmunFormId(host: TemplateLibraryHost, notePreset?: GongmunPreset): string {
  const library = getTemplateLibrary(host);
  return library.activeGongmunId || gongmunFormId(notePreset ?? library.activeGongmunPreset);
}

/** Makes a form the active one (in memory; the caller saves) and returns its document type. */
export function selectGongmunFormInMemory(host: TemplateLibraryHost, id: string): GongmunPreset {
  if (id.startsWith(FORM_PRESET_PREFIX)) {
    const preset = id.slice(FORM_PRESET_PREFIX.length);
    if (!isGongmunPreset(preset)) throw new Error(t("template.error.notFound"));
    setActiveGongmunTemplateInMemory(host, "");
    setActiveGongmunPresetInMemory(host, preset);
    return preset;
  }
  setActiveGongmunTemplateInMemory(host, id);
  return activeGongmunTemplate(host)?.preset ?? getTemplateLibrary(host).activeGongmunPreset;
}

export interface GongmunExportPlan {
  preset: GongmunPreset;
  options: GongmunOptions;
  /** Table look of the active institution style (none = Kordoc's preset look). */
  profile?: FormatProfile;
  warnings: AdapterWarning[];
  /** Document title used when the note has no leading `#` heading (R-024). */
  title: string;
  /** Finishing of a built-in institution style (hwpxFinish.ts). */
  finish?: GongmunFinishSpec;
  /** Engine notes the institution style makes irrelevant. */
  quietEngineNotes?: readonly string[];
  /** Heading and list mapping of a built-in institution style. */
  outline?: GongmunOutlineStyle;
  /** The form the plan was made with ("preset:<type>" or a style id). */
  formId: string;
}

/** The note's `title` property, else its file name: the title of a document without `#`. */
export function noteDocumentTitle(frontmatter: Readonly<Record<string, unknown>> | undefined, file: { basename: string }): string {
  const title = frontmatter?.title;
  return typeof title === "string" && title.trim() ? title.trim() : file.basename;
}

/** Generation options of a plan, shared by the export and the preview. */
export function gongmunGenerateOptions(
  plan: GongmunExportPlan
): Pick<GenerateHwpxOptions, "gongmun" | "profile" | "gongmunTitle" | "gongmunFinish" | "gongmunOutline" | "quietEngineNotes"> {
  return {
    gongmun: plan.options,
    profile: plan.profile,
    gongmunTitle: plan.title,
    gongmunFinish: plan.finish,
    gongmunOutline: plan.outline,
    quietEngineNotes: plan.quietEngineNotes
  };
}

function propertyWarning(issue: GongmunPropertyIssue): AdapterWarning {
  const message =
    issue.code === "conflict"
      ? t("gongmun.property.conflict", { key: issue.key, alias: issue.alias })
      : issue.code === "unknown"
        ? t("gongmun.property.unknown", { key: issue.key })
        : t("gongmun.property.invalid", { key: issue.key });
  return { code: "gongmun-property", message, count: 1 };
}

/** The preset a note asks for through its properties, if any. */
export function notePresetHint(app: App, file: TFile | null | undefined): GongmunPreset | undefined {
  if (!file) return undefined;
  return readGongmunProperties(app.metadataCache.getFileCache(file)?.frontmatter).preset;
}

/**
 * Official-document options for one export: the chosen preset, the note's
 * properties, and the institution style (in that order of precedence).
 *
 * `formId` names the form explicitly (R-028: the preview, a note's remembered form,
 * several forms at once); without it, or when it is no longer a form, the globally
 * active form applies as before.
 */
export function planGongmunExport(
  app: App,
  file: TFile,
  host: TemplateLibraryHost,
  requestedPreset?: GongmunPreset,
  formId?: string
): GongmunExportPlan {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  const explicit = formId ? resolveGongmunForm(host, formId) : undefined;
  const style = explicit ? explicit.style : activeGongmunTemplate(host);
  if (explicit && !explicit.style && explicit.preset) requestedPreset = explicit.preset;
  const named = readGongmunProperties(frontmatter).preset;
  // An institution form is made for one document type and always uses it (R-025,
  // R-026); otherwise the window's choice > the note's 공문_종류 > the last type.
  const fixed = style?.preset;
  const preset = fixed ?? requestedPreset ?? named ?? getTemplateLibrary(host).activeGongmunPreset ?? DEFAULT_GONGMUN_PRESET;
  const properties = readGongmunProperties(frontmatter, preset);
  const today = new Date();
  const frame = applyTypeFrame(resolveGongmunOptions({ preset, style: style?.options, note: properties.options }), {
    today,
    org: style?.options.org
  });
  const options = withCoverDate(frame.options, today, style?.coverDate);
  const warnings = properties.issues.map(propertyWarning);
  const asked = [requestedPreset, named].find((item) => item !== undefined && item !== fixed);
  if (style && fixed && asked) {
    warnings.push({
      code: "gongmun-property",
      message: t("gongmun.property.styleType", {
        style: style.name,
        preset: gongmunPresetLabel(fixed),
        asked: gongmunPresetLabel(asked)
      }),
      count: 1
    });
  }
  for (const message of incompatibleGongmunWarnings(options)) {
    warnings.push({ code: "engine-note", message, count: 1 });
  }
  const outline = style?.outline || frame.closing ? { ...style?.outline, closing: frame.closing } : undefined;
  return {
    preset,
    options,
    profile: style?.tableStyle,
    warnings,
    title: noteDocumentTitle(frontmatter, file),
    finish: style?.finish,
    quietEngineNotes: style?.quietEngineNotes,
    outline,
    formId: style?.id ?? gongmunFormId(preset)
  };
}
