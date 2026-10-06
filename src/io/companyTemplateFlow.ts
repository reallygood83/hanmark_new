import { MarkdownView, Notice, TFile, type App } from "obsidian";
import { hwpxToProfile, type FormatProfile, type GongmunPreset } from "kordoc";
import type { HanmarkSettings } from "../legacy-port/settings";
import { t } from "../i18n";
import { errorMessage } from "../utils/errors";
import { confirmAction, promptSecret } from "../ui/dialogs";
import { promptCompanyTemplateChoice, promptCompanyTemplateRegistration } from "../ui/CompanyTemplateModal";
import { QUICK_HWPX_PREVIEW_VIEW, QuickHwpxPreviewView } from "../ui/QuickHwpxPreviewView";
import { bytesAsArrayBuffer, createFileGateway, splitFilename } from "./fileGateway";
import { DEFAULT_IMPORT_OPTIONS } from "./importOptions";
import { importOne, uniqueNotePath, type ImportJob, type ImportResult } from "./importRunner";
import { extractDocumentStyleProfile } from "./documentStyle";
import {
  approvalNames,
  gongmunDraftFromDocumentStyle,
  newCompanyTemplateId,
  suggestGongmunPreset,
  withoutCompanyTemplateFlags,
  type CompanyTemplateRecord
} from "./companyTemplate";
import { normalizeFormMemory, rememberNoteForm } from "./formMemory";
import {
  GONGMUN_PRESET_KOREAN_NAMES,
  GONGMUN_PRESET_PROPERTY_KEY,
  GONGMUN_PROPERTIES,
  gongmunPropertyKeysFor
} from "./gongmunProperties";
import { normalizeGongmunStyleOptions } from "./gongmunStyle";
import type { HanmarkSettingsPlugin } from "./tableStyle";
import {
  companyTemplateByNotePath,
  deleteGongmunTemplateInMemory,
  deleteTemplateRecordInMemory,
  getTemplateLibrary,
  listCompanyTemplates,
  newGongmunTemplateRecord,
  newTemplateRecord,
  putCompanyTemplate,
  putGongmunTemplateInMemory,
  putTemplateRecord,
  rememberCompanyTemplate,
  removeCompanyTemplate
} from "./templateLibrary";

export interface CompanyTemplatePlugin extends HanmarkSettingsPlugin {
  settings: HanmarkSettings;
}

const DRAFT_FLAG = "hanmark-template-draft";
const REGISTERED_FLAG = "hanmark-company-template";

function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function pinActiveTemplates(plugin: CompanyTemplatePlugin): () => void {
  const library = getTemplateLibrary(plugin);
  const activeId = library.activeId;
  const activeGongmunId = library.activeGongmunId;
  const activeGongmunPreset = library.activeGongmunPreset;
  return () => {
    const current = getTemplateLibrary(plugin);
    current.activeId = activeId;
    current.activeGongmunId = activeGongmunId;
    current.activeGongmunPreset = activeGongmunPreset;
    plugin.settings.hanmarkTemplateLibrary = current;
  };
}

function gongmunPresetOf(plugin: CompanyTemplatePlugin, record: CompanyTemplateRecord): GongmunPreset {
  const stored = record.gongmunTemplateId
    ? getTemplateLibrary(plugin).gongmunTemplates[record.gongmunTemplateId]
    : undefined;
  return stored?.preset ?? "report";
}

function linkNote(plugin: CompanyTemplatePlugin, path: string, record: CompanyTemplateRecord): void {
  rememberCompanyTemplate(plugin, path, record.id);
  if (!record.gongmunTemplateId) return;
  plugin.settings.gongmunFormByNote = rememberNoteForm(
    normalizeFormMemory(plugin.settings.gongmunFormByNote),
    path,
    record.gongmunTemplateId
  );
}

async function addMissingGongmunProperties(app: App, file: TFile, preset: GongmunPreset): Promise<void> {
  const keys = new Set(gongmunPropertyKeysFor(preset));
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const presetSpec = GONGMUN_PROPERTIES.find((spec) => spec.key === GONGMUN_PRESET_PROPERTY_KEY);
    if (!(GONGMUN_PRESET_PROPERTY_KEY in frontmatter) && !(presetSpec && presetSpec.alias in frontmatter)) {
      frontmatter[GONGMUN_PRESET_PROPERTY_KEY] = GONGMUN_PRESET_KOREAN_NAMES[preset];
    }
    for (const spec of GONGMUN_PROPERTIES) {
      if (!keys.has(spec.key) || spec.key in frontmatter || spec.alias in frontmatter) continue;
      frontmatter[spec.key] = spec.kind === "list" ? [] : "";
    }
  });
}

async function openGongmunPreview(plugin: CompanyTemplatePlugin, preset: GongmunPreset, formId?: string): Promise<void> {
  plugin.settings.hwpxPreviewMode = "gongmun";
  const mode = { kind: "gongmun" as const, preset, formId };
  const existing = plugin.app.workspace.getLeavesOfType(QUICK_HWPX_PREVIEW_VIEW);
  if (existing.length) {
    if (existing[0].view instanceof QuickHwpxPreviewView) existing[0].view.setMode(mode);
    return;
  }
  const leaf = plugin.app.workspace.getLeaf("split", "vertical");
  await leaf.setViewState({ type: QUICK_HWPX_PREVIEW_VIEW, active: false });
  if (leaf.view instanceof QuickHwpxPreviewView) leaf.view.setMode(mode);
}

async function importWithPassword(
  app: App,
  input: { name: string; bytes: Uint8Array },
  job: Omit<ImportJob, "inputs">
): Promise<ImportResult> {
  let result = await importOne(app, input, job, new Set());
  let error: string | undefined;
  for (let attempt = 0; attempt < 3 && !result.ok && result.passwordHelps; attempt += 1) {
    const password = await promptSecret(app, {
      title: t("import.password.title"),
      label: t("import.password.label", { file: input.name }),
      description: t("import.password.desc"),
      error,
      confirmText: t("import.password.submit")
    });
    if (password === null) return result;
    result = await importOne(app, input, job, new Set(), password);
    error = t("import.password.wrong");
  }
  return result;
}

/** HWPX → template note, document style, and official-document draft. Does not activate either globally. */
export async function createCompanyTemplate(plugin: CompanyTemplatePlugin, beside: TFile | null): Promise<void> {
  const picked = (
    await createFileGateway(plugin.app, plugin).pickFiles({
      title: t("command.createCompanyTemplate"),
      extensions: ["hwpx", "hwp"],
      multiple: false
    })
  )[0];
  if (!picked) return;
  if (splitFilename(picked.name).extension.toLowerCase() !== "hwpx") {
    new Notice(t("companyTemplate.hwpRejected"));
    return;
  }

  let profile;
  try {
    profile = await extractDocumentStyleProfile(picked.bytes, picked.name);
  } catch {
    new Notice(t("companyTemplate.styleUnread"));
    return;
  }
  let tableStyle: FormatProfile | undefined;
  try {
    const format = await hwpxToProfile(bytesAsArrayBuffer(picked.bytes));
    if (format.tables.length) tableStyle = format;
  } catch {
    tableStyle = undefined;
  }

  const stem = splitFilename(picked.name).stem.trim() || t("import.defaultNoteName");
  const folder = parentFolder(beside?.path ?? "");
  const job: Omit<ImportJob, "inputs"> = {
    options: { ...DEFAULT_IMPORT_OPTIONS, preset: "form" },
    folderFor: () => folder,
    imageDestination: "vault",
    cloudSettings: { destination: "vault", localFolder: "", workerUrl: "", publicUrl: "" }
  };
  const imported = await importWithPassword(
    plugin.app,
    { name: `${stem} ${t("companyTemplate.noteSuffix")}.hwpx`, bytes: picked.bytes },
    job
  );
  if (!imported.ok || !imported.notePath) {
    new Notice(imported.errorTitle || t("companyTemplate.createFailed"));
    return;
  }
  const note = plugin.app.vault.getAbstractFileByPath(imported.notePath);
  if (!(note instanceof TFile)) {
    new Notice(t("companyTemplate.createFailed"));
    return;
  }

  try {
    await plugin.app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
      frontmatter[DRAFT_FLAG] = true;
    });
    const pin = pinActiveTemplates(plugin);
    const style = putTemplateRecord(plugin, newTemplateRecord(plugin, stem, profile, tableStyle, picked.name));
    const gongmun = putGongmunTemplateInMemory(
      plugin,
      newGongmunTemplateRecord(plugin, stem, gongmunDraftFromDocumentStyle(profile))
    );
    putCompanyTemplate(plugin, {
      id: newCompanyTemplateId(),
      name: stem,
      notePath: note.path,
      documentStyleId: style.id,
      gongmunTemplateId: gongmun.id,
      sourceName: picked.name,
      registered: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    pin();
    await plugin.saveSettings();
  } catch (error) {
    const failed = Object.values(getTemplateLibrary(plugin).companyTemplates).find((item) => item.notePath === note.path);
    if (failed?.documentStyleId) deleteTemplateRecordInMemory(plugin, failed.documentStyleId);
    if (failed?.gongmunTemplateId) deleteGongmunTemplateInMemory(plugin, failed.gongmunTemplateId);
    if (failed) removeCompanyTemplate(plugin, failed.id);
    await plugin.app.fileManager.trashFile(note);
    new Notice(errorMessage(error));
    return;
  }

  const body = profile.roles.body;
  new Notice(t("companyTemplate.created", {
    font: body?.character?.fontFamily || "-",
    size: body?.character?.fontSizePt === undefined ? "-" : String(body.character.fontSizePt),
    spacing: body?.paragraph?.lineSpacingPercent === undefined ? "-" : String(body.paragraph.lineSpacingPercent)
  }));
  await plugin.app.workspace.getLeaf(false).openFile(note);
}

/** Confirms the name, type, organization, and approval line for the open template note. */
export async function registerCompanyTemplate(plugin: CompanyTemplatePlugin, file: TFile | null): Promise<void> {
  if (!file) {
    new Notice(t("companyTemplate.registerNeedNote"));
    return;
  }
  const existing = companyTemplateByNotePath(plugin, file.path);
  if (!existing) {
    new Notice(t("companyTemplate.registerNeedNote"));
    return;
  }
  const gongmun = existing.gongmunTemplateId
    ? getTemplateLibrary(plugin).gongmunTemplates[existing.gongmunTemplateId]
    : undefined;
  const answer = await promptCompanyTemplateRegistration(plugin.app, {
    name: existing.name,
    preset: gongmun?.preset ?? suggestGongmunPreset(`${file.basename} ${existing.sourceName ?? ""}`),
    org: gongmun?.options.org ?? "",
    approval: (gongmun?.options.approval ?? []).join(", ")
  });
  if (!answer) return;

  const pin = pinActiveTemplates(plugin);
  if (existing.documentStyleId) {
    const style = getTemplateLibrary(plugin).customTemplates[existing.documentStyleId];
    if (style) {
      putTemplateRecord(plugin, {
        ...style,
        name: answer.name,
        documentStyle: style.documentStyle ? { ...style.documentStyle, name: answer.name } : undefined,
        sourceName: style.sourceName
      });
    }
  }
  if (gongmun) {
    putGongmunTemplateInMemory(plugin, {
      ...gongmun,
      name: answer.name,
      preset: answer.preset,
      options: normalizeGongmunStyleOptions({
        ...gongmun.options,
        org: answer.org || undefined,
        approval: approvalNames(answer.approval)
      })
    });
  }
  const saved = putCompanyTemplate(plugin, { ...existing, name: answer.name, registered: true });
  pin();
  await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    delete frontmatter[DRAFT_FLAG];
    frontmatter[REGISTERED_FLAG] = true;
  });
  linkNote(plugin, file.path, saved);
  await plugin.saveSettings();
  new Notice(t("companyTemplate.registerSaved", { name: answer.name }));
}

/** Copies a registered template into a new note and opens the official-document preview. */
export async function newDocumentFromCompanyTemplate(plugin: CompanyTemplatePlugin, id?: string): Promise<void> {
  const records = listCompanyTemplates(plugin).filter((record) => record.notePath);
  if (!records.length) {
    new Notice(t("companyTemplate.none"));
    return;
  }
  const chosen = id ? records.find((record) => record.id === id) ?? null : await promptCompanyTemplateChoice(plugin.app, records);
  if (!chosen) {
    if (id) new Notice(t("companyTemplate.broken"));
    return;
  }
  const template = plugin.app.vault.getAbstractFileByPath(chosen.notePath);
  if (!(template instanceof TFile)) {
    new Notice(t("companyTemplate.broken"));
    return;
  }
  const markdown = withoutCompanyTemplateFlags(await plugin.app.vault.read(template));
  const base = chosen.name.replace(/[\\/:*?"<>|#^[\]]/gu, " ").replace(/\s+/gu, " ").trim() || t("import.defaultNoteName");
  const preset = gongmunPresetOf(plugin, chosen);
  let created: TFile | undefined;
  try {
    const path = uniqueNotePath(plugin.app, parentFolder(template.path), base, new Set());
    created = await plugin.app.vault.create(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    await addMissingGongmunProperties(plugin.app, created, preset);
    linkNote(plugin, created.path, chosen);
    await plugin.saveSettings();
  } catch (error) {
    if (created) await plugin.app.fileManager.trashFile(created).catch(() => undefined);
    new Notice(errorMessage(error));
    return;
  }
  if (!created) return;
  await plugin.app.workspace.getLeaf(false).openFile(created);
  await openGongmunPreview(plugin, preset, chosen.gongmunTemplateId);
}

/** Adds missing official-document properties to the open note and links the template. The body stays. */
export async function applyCompanyTemplate(plugin: CompanyTemplatePlugin, id: string, file: TFile | null): Promise<void> {
  const record = getTemplateLibrary(plugin).companyTemplates[id];
  if (!record?.registered) {
    new Notice(t("companyTemplate.broken"));
    return;
  }
  if (!file) {
    new Notice(t("companyTemplate.applyNeedNote"));
    return;
  }
  if (file.path === record.notePath) {
    new Notice(t("companyTemplate.applyIsTemplate"));
    return;
  }
  if (!record.notePath || !(plugin.app.vault.getAbstractFileByPath(record.notePath) instanceof TFile)) {
    new Notice(t("companyTemplate.broken"));
    return;
  }
  const preset = gongmunPresetOf(plugin, record);
  await addMissingGongmunProperties(plugin.app, file, preset);
  linkNote(plugin, file.path, record);
  await plugin.saveSettings();
  await openGongmunPreview(plugin, preset, record.gongmunTemplateId);
  new Notice(t("companyTemplate.applied", { name: record.name }));
}

/** Drops the link. Notes and style records stay. */
export async function deleteCompanyTemplate(plugin: CompanyTemplatePlugin, id: string): Promise<boolean> {
  const confirmed = await confirmAction(plugin.app, {
    title: t("companyTemplate.deleteTitle"),
    message: t("companyTemplate.deleteMessage"),
    confirmText: t("companyTemplate.delete"),
    warning: true
  });
  if (!confirmed) return false;
  removeCompanyTemplate(plugin, id);
  await plugin.saveSettings();
  return true;
}

export function activeCompanyTemplateFile(app: App): TFile | null {
  return app.workspace.getActiveViewOfType(MarkdownView)?.file ?? null;
}
