import { Notice } from "obsidian";
import {
  hwpxToProfile,
  isKnownFont,
  validateHwpx,
  type FormatProfile
} from "kordoc";
import {
  documentStyleSummary,
  extractDocumentStyleProfile,
  normalizeDocumentStyleProfile,
  type DocumentStyleProfile
} from "./documentStyle";
import { pickHwpxFile } from "./tableStyle";
import type { HanmarkDocumentStylePresetId } from "./documentStylePresets";
import {
  activeTemplateItem,
  availableTemplateName,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  isBuiltInTemplateId,
  listTemplateItems,
  migrateTemplateLibrarySettingsInMemory,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory,
  templateDisplayName,
  templateDocumentStyle,
  type HanmarkTemplateItem,
  type HanmarkTemplateRecord,
  type TemplateLibraryHost
} from "./templateLibrary";
import { bytesAsArrayBuffer } from "./fileGateway";
import type { HanmarkSettingsPlugin } from "./tableStyle";
import { t } from "../i18n";

export function migrateDocumentStyleSettingsInMemory(
  plugin?: Pick<TemplateLibraryHost, "settings">
): boolean {
  return migrateTemplateLibrarySettingsInMemory(plugin?.settings);
}

/** Compatibility view for older callers; custom profiles map to `custom`. */
export function activeDocumentStylePreset(
  plugin: TemplateLibraryHost
): HanmarkDocumentStylePresetId {
  const id = getTemplateLibrary(plugin).activeId;
  if (id === "builtin:korean-communication") return "korean-communication";
  if (id === "builtin:youth-studies") return "youth-studies";
  if (id === "builtin:kordoc-default") return "kordoc-default";
  return "custom";
}

export function activeDocumentStyle(
  plugin: TemplateLibraryHost
): DocumentStyleProfile | undefined {
  return templateDocumentStyle(plugin);
}

export function activeDocumentStyleName(plugin: TemplateLibraryHost): string {
  return activeTemplateItem(plugin).name;
}

export function activeTemplateId(plugin: TemplateLibraryHost): string {
  return getTemplateLibrary(plugin).activeId;
}

export function availableDocumentTemplates(plugin: TemplateLibraryHost): HanmarkTemplateItem[] {
  return listTemplateItems(plugin);
}

export function activeDocumentTemplate(plugin: TemplateLibraryHost): HanmarkTemplateItem {
  return activeTemplateItem(plugin);
}

export async function setActiveDocumentTemplate(
  plugin: HanmarkSettingsPlugin,
  id: string
): Promise<HanmarkTemplateItem> {
  const item = setActiveTemplateInMemory(plugin, id);
  await plugin.saveSettings();
  return item;
}

export async function setDocumentStylePreset(
  plugin: HanmarkSettingsPlugin,
  preset: HanmarkDocumentStylePresetId
): Promise<void> {
  const id = preset === "korean-communication"
    ? "builtin:korean-communication"
    : preset === "youth-studies"
      ? "builtin:youth-studies"
      : preset === "custom"
        ? Object.keys(getTemplateLibrary(plugin).customTemplates)[0]
        : "builtin:kordoc-default";
  if (!id) throw new Error(t("docStyle.template.noCustom"));
  await setActiveDocumentTemplate(plugin, id);
}

export async function createDocumentTemplate(
  plugin: HanmarkSettingsPlugin,
  name: string,
  documentStyle?: DocumentStyleProfile,
  tableStyle?: FormatProfile,
  sourceName?: string
): Promise<HanmarkTemplateRecord> {
  const record = newTemplateRecord(plugin, name, documentStyle, tableStyle, sourceName);
  const saved = putTemplateRecord(plugin, record);
  setActiveTemplateInMemory(plugin, saved.id);
  await plugin.saveSettings();
  return saved;
}

export async function duplicateDocumentTemplate(
  plugin: HanmarkSettingsPlugin,
  id: string
): Promise<HanmarkTemplateRecord> {
  const source = listTemplateItems(plugin).find((item) => item.id === id);
  if (!source) throw new Error(t("docStyle.template.duplicateNotFound"));
  return createDocumentTemplate(
    plugin,
    availableTemplateName(plugin, t("docStyle.template.copyName", { name: templateDisplayName(source) })),
    source.documentStyle,
    source.tableStyle,
    source.sourceName
  );
}

export async function renameDocumentTemplate(
  plugin: HanmarkSettingsPlugin,
  id: string,
  name: string
): Promise<HanmarkTemplateRecord> {
  if (isBuiltInTemplateId(id)) throw new Error(t("docStyle.template.renameBuiltIn"));
  const library = getTemplateLibrary(plugin);
  const current = library.customTemplates[id];
  if (!current) throw new Error(t("docStyle.template.renameNotFound"));
  const saved = putTemplateRecord(plugin, { ...current, name });
  await plugin.saveSettings();
  return saved;
}

export async function deleteDocumentTemplate(
  plugin: HanmarkSettingsPlugin,
  id: string
): Promise<boolean> {
  const deleted = deleteTemplateRecordInMemory(plugin, id);
  if (deleted) await plugin.saveSettings();
  return deleted;
}

export async function saveDocumentStyle(
  plugin: HanmarkSettingsPlugin,
  profile: DocumentStyleProfile
): Promise<HanmarkTemplateRecord> {
  const normalized = normalizeDocumentStyleProfile(profile);
  const active = activeTemplateItem(plugin);
  let record: HanmarkTemplateRecord;
  if (active.builtIn) {
    record = newTemplateRecord(plugin, normalized.name || t("docStyle.template.customizedName", { name: templateDisplayName(active) }), normalized, active.tableStyle, normalized.sourceName);
  } else {
    const library = getTemplateLibrary(plugin);
    const existing = library.customTemplates[active.id];
    if (!existing) throw new Error(t("docStyle.template.editNotFound"));
    record = { ...existing, name: normalized.name || existing.name, documentStyle: normalized };
  }
  const saved = putTemplateRecord(plugin, record);
  setActiveTemplateInMemory(plugin, saved.id);
  await plugin.saveSettings();
  new Notice(t("docStyle.template.saved", { name: saved.name, summary: documentStyleSummary(normalized) }));
  return saved;
}

export async function importDocumentStyle(plugin: HanmarkSettingsPlugin): Promise<boolean> {
  const selected = await pickHwpxFile(
    plugin.app,
    plugin,
    t("docStyle.template.importPickTitle")
  );
  if (!selected) return false;
  const buffer = bytesAsArrayBuffer(selected.bytes);
  const validation = await validateHwpx(buffer);
  const sourceName = selected.name;
  const profile = await extractDocumentStyleProfile(selected.bytes, sourceName);
  const format = validation.ok ? await hwpxToProfile(buffer) : { tables: [] };
  const tableStyle = format.tables.length ? format : undefined;
  const record = await createDocumentTemplate(plugin, profile.name || sourceName, profile, tableStyle, sourceName);

  // Kordoc's own font warning is Korean-only; HanMark words it in the interface language.
  const unknownFonts = [
    ...new Set(
      Object.values(profile.roles)
        .map((style) => style?.character?.fontFamily?.trim() ?? "")
        .filter((name) => name && !isKnownFont(name))
    )
  ];
  new Notice(
    tableStyle
      ? t("docStyle.template.addedWithTables", { name: record.name, count: tableStyle.tables.length })
      : t("docStyle.template.added", { name: record.name })
  );
  if (!validation.ok) {
    new Notice(t("docStyle.template.legacyImported"), 8_000);
  }
  if (unknownFonts.length) {
    new Notice(t("docStyle.template.unknownFonts", { fonts: unknownFonts.slice(0, 5).join(", ") }), 10_000);
  }
  return true;
}

/** Older command compatibility: delete only the active custom template. */
export async function clearDocumentStyle(plugin: HanmarkSettingsPlugin): Promise<void> {
  const active = activeTemplateItem(plugin);
  if (active.builtIn) return;
  if (await deleteDocumentTemplate(plugin, active.id)) new Notice(t("docStyle.template.clearedToDefault"));
}

/** Inert compatibility hook retained for callers from HanMark 2.4.2 and earlier. */
export async function synchronizeLegacyTemplateCache(_plugin: unknown): Promise<boolean> {
  return false;
}
