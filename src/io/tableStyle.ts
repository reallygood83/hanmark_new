import { Notice, type App } from "obsidian";
import { hwpxToProfile, validateHwpx, type FormatProfile } from "kordoc";
import {
  activeTemplateItem,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  newTemplateRecord,
  putTemplateRecord,
  setActiveTemplateInMemory,
  templateTableStyle,
  type TemplateLibraryHost
} from "./templateLibrary";
import {
  bytesAsArrayBuffer,
  createFileGateway,
  type SelectedExternalFile
} from "./fileGateway";
import { t } from "../i18n";

export interface HanmarkSettingsPlugin extends TemplateLibraryHost {
  app: App;
  manifest?: { id: string };
}

export async function pickHwpxFile(
  app: App,
  plugin?: unknown,
  title = t("tableStyle.pickTitle")
): Promise<SelectedExternalFile | null> {
  const selected = await createFileGateway(app, plugin).pickFiles({
    title,
    extensions: ["hwpx"],
    multiple: false
  });
  return selected[0] ?? null;
}

export function activeTableProfile(
  plugin: TemplateLibraryHost
): FormatProfile | undefined {
  return templateTableStyle(plugin);
}

export function activeTableProfileName(plugin: TemplateLibraryHost): string | undefined {
  const active = activeTemplateItem(plugin);
  return active.tableStyle?.tables?.length ? active.name : undefined;
}

/** Import only table border/shading/width/font information, never the document body. */
export async function importTableStyle(plugin: HanmarkSettingsPlugin): Promise<boolean> {
  const selected = await pickHwpxFile(
    plugin.app,
    plugin,
    t("tableStyle.pickTableTitle")
  );
  if (!selected) return false;
  const buffer = bytesAsArrayBuffer(selected.bytes);
  const validation = await validateHwpx(buffer);
  if (!validation.ok) {
    throw new Error(
      t("tableStyle.validationFailed", {
        detail: validation.issues[0]?.message || t("tableStyle.invalidHwpx")
      })
    );
  }
  const profile = await hwpxToProfile(buffer);
  if (!profile.tables.length) throw new Error(t("tableStyle.noTables"));

  const active = activeTemplateItem(plugin);
  const sourceName = selected.name;
  if (active.builtIn) {
    const record = newTemplateRecord(
      plugin,
      `${active.name} + ${sourceName}`,
      active.documentStyle,
      profile,
      sourceName
    );
    putTemplateRecord(plugin, record);
    setActiveTemplateInMemory(plugin, record.id);
  } else {
    const record = getTemplateLibrary(plugin).customTemplates[active.id];
    if (!record) throw new Error(t("tableStyle.activeNotFound"));
    putTemplateRecord(plugin, { ...record, tableStyle: profile, sourceName });
  }
  await plugin.saveSettings();
  new Notice(
    t("tableStyle.added", { file: sourceName, count: profile.tables.length })
  );
  return true;
}

export async function clearTableStyle(plugin: HanmarkSettingsPlugin): Promise<void> {
  const active = activeTemplateItem(plugin);
  if (active.builtIn || !active.tableStyle) return;
  const record = getTemplateLibrary(plugin).customTemplates[active.id];
  if (!record) return;
  if (record.documentStyle) putTemplateRecord(plugin, { ...record, tableStyle: undefined });
  else deleteTemplateRecordInMemory(plugin, record.id);
  await plugin.saveSettings();
  new Notice(t("tableStyle.removed"));
}
