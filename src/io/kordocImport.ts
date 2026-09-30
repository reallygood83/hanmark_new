import {
  App,
  Modal,
  Notice,
  TFile,
  normalizePath,
  requestUrl,
  requireApiVersion
} from "obsidian";
import { CLOUD_STAGING_FOLDER, type PersistedCloudImage } from "./importImages";
import {
  bridgeActiveNoteImagesThroughCmdsEagle,
  buildCmdsEagleStagingMarkdown,
  type CmdsEagleBridgeImage,
  type CmdsEagleBridgeDependencies
} from "./cmdsEagleBridge";
import {
  markdownImageTokens,
  transformMarkdownImageTokens
} from "./markdownImageTokens";
import { R2UploadError, uploadImageToR2 } from "./r2ImageUpload";
import { uploadBatchWithSingleAuthenticationRefresh } from "./r2BatchUpload";
import {
  normalizeImportedImageDestination,
  normalizeImportedImageFolder,
  type ImportedImageDestination
} from "../legacy-port/settings";
import { t } from "../i18n";

export type ImportImageDestination = Exclude<ImportedImageDestination, "ask">;

export interface ImportCloudSettings {
  destination: ImportedImageDestination;
  localFolder: string;
  workerUrl: string;
  publicUrl: string;
  executeCommandById?: (id: string) => boolean;
}

interface CloudImportResult {
  uploaded: number;
  warnings: string[];
}

interface CloudCleanupResult {
  removed: number;
  warnings: string[];
}

interface LegacyVaultTrash {
  trash(file: TFile, system: boolean): Promise<void>;
}

const sessionR2Keys = new Map<string, string>();
let cmdsStagingSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cloud-image settings read from the plugin host (never another plugin's private data). */
export function importCloudSettings(plugin: unknown): ImportCloudSettings {
  const host = isRecord(plugin) ? plugin : {};
  const settings = isRecord(host.settings) ? host.settings : {};
  const command = host.executeCommandById;
  const executeCommandById =
    typeof command === "function"
      ? (id: string): boolean => command.call(host, id) === true
      : undefined;
  return {
    destination: normalizeImportedImageDestination(
      settings.importedImageDestination
    ),
    localFolder: normalizeImportedImageFolder(settings.importedImageFolder),
    workerUrl:
      typeof settings.cmdsEagleWorkerUrl === "string"
        ? settings.cmdsEagleWorkerUrl.trim()
        : "",
    publicUrl:
      typeof settings.cmdsEaglePublicUrl === "string"
        ? settings.cmdsEaglePublicUrl.trim()
        : "",
    executeCommandById
  };
}

export function chooseImportImageDestination(
  app: App
): Promise<ImportImageDestination | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ImportImageDestination | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(t("import.imageDestination.title"));
    modal.contentEl.createEl("p", { text: t("import.imageDestination.desc") });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const local = row.createEl("button", {
      text: t("import.imageDestination.vault"),
      attr: { type: "button" }
    });
    local.onclick = () => {
      finish("vault");
      modal.close();
    };
    const cloud = row.createEl("button", {
      text: t("import.imageDestination.cloud"),
      attr: { type: "button" }
    });
    cloud.classList.add("mod-cta");
    cloud.setCssStyles({ marginLeft: "8px" });
    cloud.onclick = () => {
      finish("cmds-eagle-r2");
      modal.close();
    };
    const cancel = row.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.setCssStyles({ marginLeft: "8px" });
    cancel.onclick = () => {
      finish(null);
      modal.close();
    };
    modal.onClose = () => finish(null);
    modal.open();
  });
}

function requestSessionR2Key(
  app: App,
  workerUrl: string,
  forceReplacement = false
): Promise<string | null> {
  const cached = forceReplacement ? undefined : sessionR2Keys.get(workerUrl);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = new Modal(app);
    modal.titleEl.setText(t("import.r2Key.title"));
    modal.contentEl.createEl("p", { text: t("import.r2Key.desc") });
    let inputValue = "";
    const setting = modal.contentEl.createDiv();
    const label = setting.createEl("label", {
      text: t("import.r2Key.label")
    });
    const input = setting.createEl("input", {
      attr: {
        type: "password",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": t("import.r2Key.aria")
      }
    });
    label.setCssStyles({ display: "block", marginBottom: "6px" });
    input.setCssStyles({ width: "100%" });
    input.addEventListener("input", () => {
      inputValue = input.value;
    });
    const row = modal.contentEl.createDiv();
    row.setCssStyles({ marginTop: "12px" });
    const submit = row.createEl("button", {
      text: t("import.r2Key.useForSession"),
      attr: { type: "button" }
    });
    submit.classList.add("mod-cta");
    const submitValue = (): void => {
      if (!inputValue) {
        new Notice(t("import.r2Key.required"));
        return;
      }
      finish(inputValue);
      input.value = "";
      inputValue = "";
      modal.close();
    };
    submit.onclick = submitValue;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitValue();
      }
    });
    const cancel = row.createEl("button", {
      text: t("common.cancel"),
      attr: { type: "button" }
    });
    cancel.setCssStyles({ marginLeft: "8px" });
    cancel.onclick = () => {
      input.value = "";
      inputValue = "";
      finish(null);
      modal.close();
    };
    modal.onClose = () => {
      input.value = "";
      inputValue = "";
      finish(null);
    };
    modal.open();
    input.focus();
  });
}

function bridgeDependencies(
  app: App,
  stagingNote: TFile,
  executeCommandById: ((id: string) => boolean) | undefined
): CmdsEagleBridgeDependencies {
  return {
    triggerWorkspaceEvent: (eventName, request) => {
      app.workspace.trigger(eventName, request);
    },
    executeCommandById: (commandId) => {
      // CMDS Eagle resolves its target from the active file at command
      // execution time. Re-check immediately before dispatch so a user
      // switching tabs during capability discovery cannot mutate another note.
      if (app.workspace.getActiveFile()?.path !== stagingNote.path) return false;
      return executeCommandById?.(commandId) ?? false;
    },
    readActiveNote: () => app.vault.read(stagingNote),
    writeActiveNote: (markdown) => app.vault.modify(stagingNote, markdown),
    scheduleTimeout: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    cancelTimeout: (handle) => {
      if (typeof handle === "number") window.clearTimeout(handle);
    }
  };
}

function replaceStagedImageUrls(
  markdown: string,
  replacements: ReadonlyMap<string, string>
): {
  markdown: string;
  appliedSources: ReadonlySet<string>;
} {
  const appliedSources = new Set<string>();
  const rewritten = transformMarkdownImageTokens(markdown, (token) => {
    const remoteUrl = replacements.get(token.source);
    if (!remoteUrl) return token.raw;
    appliedSources.add(token.source);
    const escapedAlt = token.alt
      .replace(/\\/gu, "\\\\")
      .replace(/\]/gu, "\\]");
    return `![${escapedAlt}](${remoteUrl})`;
  });
  return { markdown: rewritten, appliedSources };
}

function uniqueCmdsBridgeImages(
  candidates: readonly PersistedCloudImage[]
): CmdsEagleBridgeImage[] {
  const sources = new Set<string>();
  const images: CmdsEagleBridgeImage[] = [];
  for (const candidate of candidates) {
    if (sources.has(candidate.markdownUrl)) continue;
    sources.add(candidate.markdownUrl);
    images.push({
      localSource: candidate.markdownUrl,
      fileName:
        candidate.vaultPath.split("/").pop() || "hanmark-imported-image.png",
      mimeType: candidate.mimeType,
      bytes: candidate.data
    });
  }
  return images;
}

function uniqueCmdsStagingPath(app: App): string {
  const seed = `${Date.now().toString(36)}-${(++cmdsStagingSequence).toString(36)}`;
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const path = normalizePath(
      `HanMark-Imported-Images/HanMark-CMDS-Staging-${seed}${suffix}.md`
    );
    if (!app.vault.getAbstractFileByPath(path)) return path;
    attempt += 1;
  }
}

async function createCmdsStagingNote(
  app: App,
  images: readonly CmdsEagleBridgeImage[]
): Promise<TFile> {
  const path = uniqueCmdsStagingPath(app);
  return app.vault.create(path, `${buildCmdsEagleStagingMarkdown(images)}\n`);
}

async function deleteCmdsStagingNote(
  app: App,
  stagingNote: TFile
): Promise<boolean> {
  try {
    // Do not permanently delete even this plugin-owned staging note. Older
    // supported Obsidian versions lack FileManager.trashFile, so retain it and
    // surface the cleanup warning instead of bypassing the user's trash policy.
    if (requireApiVersion("1.6.6")) {
      await app.fileManager.trashFile(stagingNote);
      return true;
    }
    // Vault.trash is the public, recoverable predecessor used only on the
    // explicitly supported 1.5.x compatibility path.
    const legacyVault = app.vault as unknown as LegacyVaultTrash;
    await legacyVault.trash(stagingNote, false);
    return true;
  } catch {
    return false;
  }
}

function comparableVaultReference(value: string): string {
  let decoded = value.trim().replace(/^<|>$/gu, "").replace(/\\/gu, "/");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURI(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return normalizePath(decoded.replace(/^\.\//u, "").replace(/[?#].*$/u, ""))
    .normalize("NFC");
}

function markdownReferencesVaultFile(
  app: App,
  markdown: string,
  notePath: string,
  target: TFile
): boolean {
  const targetPath = normalizePath(target.path).normalize("NFC");
  const refersToTarget = (source: string): boolean => {
    if (comparableVaultReference(source) === targetPath) return true;
    return app.metadataCache.getFirstLinkpathDest(source, notePath)?.path
      === target.path;
  };
  if (markdownImageTokens(markdown).some((token) => refersToTarget(token.source))) {
    return true;
  }
  const wikiEmbed = /!\[\[([^\]]+)\]\]/gu;
  for (const match of markdown.matchAll(wikiEmbed)) {
    const source = (match[1] ?? "").split("|", 1)[0].split("#", 1)[0];
    if (source && refersToTarget(source)) return true;
  }
  return false;
}

function hasOtherResolvedReference(
  app: App,
  targetPath: string,
  excludedSourcePaths: ReadonlySet<string>
): boolean {
  for (const [sourcePath, destinations] of Object.entries(
    app.metadataCache.resolvedLinks
  )) {
    if (excludedSourcePaths.has(sourcePath)) continue;
    if ((destinations[targetPath] ?? 0) > 0) return true;
  }
  return false;
}

function bytesMatch(expected: Uint8Array, actual: ArrayBuffer): boolean {
  const current = new Uint8Array(actual);
  if (current.byteLength !== expected.byteLength) return false;
  for (let index = 0; index < current.byteLength; index += 1) {
    if (current[index] !== expected[index]) return false;
  }
  return true;
}

function isOwnedCloudStagingPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized.startsWith(`${CLOUD_STAGING_FOLDER}/hanmark-`);
}

/**
 * Remove only the disposable image files that this import just created and
 * whose remote URL was verified in the final note. A byte mismatch or any
 * remaining reference turns cleanup into a warning rather than a deletion.
 */
async function cleanupVerifiedCloudImages(
  app: App,
  note: TFile,
  candidates: readonly PersistedCloudImage[],
  verifiedSources: ReadonlySet<string>,
  excludedSourcePaths: ReadonlySet<string>
): Promise<CloudCleanupResult> {
  if (!verifiedSources.size) return { removed: 0, warnings: [] };
  const warnings: string[] = [];
  let removed = 0;
  const currentNote = await app.vault.read(note);
  const excluded = new Set(excludedSourcePaths);
  excluded.add(note.path);

  for (const candidate of candidates) {
    if (!verifiedSources.has(candidate.markdownUrl)) continue;
    const abstract = app.vault.getAbstractFileByPath(candidate.vaultPath);
    if (!candidate.ownedStagingFile || !isOwnedCloudStagingPath(candidate.vaultPath)) {
      warnings.push(t("import.cloud.ownershipUnknown", { path: candidate.vaultPath }));
      continue;
    }
    if (!(abstract instanceof TFile)) {
      // A missing file is already outside the Vault and needs no further work.
      if (!abstract) removed += 1;
      else {
        warnings.push(t("import.cloud.notAFile", { path: candidate.vaultPath }));
      }
      continue;
    }
    if (
      markdownReferencesVaultFile(app, currentNote, note.path, abstract)
      || hasOtherResolvedReference(app, abstract.path, excluded)
    ) {
      warnings.push(t("import.cloud.stillReferenced", { path: abstract.path }));
      continue;
    }
    if (
      abstract.stat.size !== candidate.data.byteLength
      || !bytesMatch(candidate.data, await app.vault.readBinary(abstract))
    ) {
      warnings.push(t("import.cloud.changedAfterCreate", { path: abstract.path }));
      continue;
    }
    try {
      // These are fresh, content-verified HanMark staging files rather than
      // user-authored attachments. Prefer the operating-system trash so an
      // internal Vault trash folder cannot retain a second cloud copy.
      const systemTrash = (app.vault as unknown as LegacyVaultTrash).trash.bind(app.vault);
      await systemTrash(abstract, true);
      removed += 1;
    } catch {
      warnings.push(t("import.cloud.cleanupFailed", { path: abstract.path }));
    }
  }
  return { removed, warnings };
}

async function waitForCommandStagingToSettle(
  app: App,
  stagingNote: TFile
): Promise<boolean> {
  let previous: string;
  try {
    previous = await app.vault.read(stagingNote);
  } catch {
    return false;
  }
  let stableReads = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 250);
    });
    if (app.vault.getAbstractFileByPath(stagingNote.path) !== stagingNote) {
      return false;
    }
    let current: string;
    try {
      current = await app.vault.read(stagingNote);
    } catch {
      return false;
    }
    if (current === previous) stableReads += 1;
    else stableReads = 0;
    previous = current;
  }
  return stableReads >= 2;
}

async function applyVerifiedCloudReplacements(
  app: App,
  note: TFile,
  entries: readonly { localSource: string; remoteUrl: string }[]
): Promise<ReadonlySet<string>> {
  if (!entries.length) return new Set<string>();
  const replacements = new Map(
    entries.map((entry) => [entry.localSource, entry.remoteUrl])
  );
  const current = await app.vault.read(note);
  const rewritten = replaceStagedImageUrls(current, replacements);
  if (rewritten.markdown !== current) {
    await app.vault.modify(note, rewritten.markdown);
  }
  return rewritten.appliedSources;
}

async function directR2Fallback(
  app: App,
  note: TFile,
  candidates: readonly PersistedCloudImage[],
  settings: ImportCloudSettings,
  allowLocalCleanup: boolean
): Promise<CloudImportResult> {
  if (!settings.workerUrl || !settings.publicUrl) {
    return {
      uploaded: 0,
      warnings: [t("import.cloud.noFallbackUrl")]
    };
  }
  const batch = await uploadBatchWithSingleAuthenticationRefresh(candidates, {
    requestInitialKey: () => requestSessionR2Key(app, settings.workerUrl),
    requestReplacementKey: () =>
      requestSessionR2Key(app, settings.workerUrl, true),
    upload: async (candidate, apiKey) => {
      const filename =
        candidate.vaultPath.split("/").pop() || "hanmark-imported-image.png";
      const uploaded = await uploadImageToR2(
        async (request) => {
          const response = await requestUrl(request);
          return { status: response.status, text: response.text };
        },
        {
          workerUrl: settings.workerUrl,
          publicUrl: settings.publicUrl,
          apiKey
        },
        {
          data: candidate.data,
          filename,
          contentType: candidate.mimeType
        }
      );
      return uploaded.publicUrl;
    },
    isAuthenticationFailure: (error) =>
      error instanceof R2UploadError
      && error.code === "http-error"
      && (error.status === 401 || error.status === 403),
    cacheAuthenticatedKey: (apiKey) => {
      // Cache only a key that completed an authenticated upload.
      sessionR2Keys.set(settings.workerUrl, apiKey);
    },
    clearRejectedKey: () => {
      sessionR2Keys.delete(settings.workerUrl);
    }
  });

  if (batch.initialKeyCancelled) {
    return {
      uploaded: 0,
      warnings: [t("import.cloud.r2Cancelled")]
    };
  }

  const replacements = new Map(
    batch.successes.map(({ item, remoteUrl }) => [item.markdownUrl, remoteUrl])
  );
  const warnings = batch.failures.map(({ item, kind }) =>
    kind === "authentication"
      ? t("import.cloud.r2AuthFailed", { file: item.filename })
      : t("import.cloud.r2UploadFailed", { file: item.filename })
  );
  if (batch.replacementKeyCancelled) {
    warnings.push(t("import.cloud.r2KeyCancelled"));
  }

  const appliedSources = await applyVerifiedCloudReplacements(
    app,
    note,
    [...replacements].map(([localSource, remoteUrl]) => ({
      localSource,
      remoteUrl
    }))
  );
  if (appliedSources.size !== replacements.size) {
    warnings.push(t("import.cloud.urlsNotApplied"));
  }
  if (allowLocalCleanup) {
    const cleanup = await cleanupVerifiedCloudImages(
      app,
      note,
      candidates,
      appliedSources,
      new Set<string>()
    );
    warnings.push(...cleanup.warnings);
  } else if (appliedSources.size > 0) {
    warnings.push(t("import.cloud.stagingCleanupFailedKeepImages"));
  }
  return { uploaded: replacements.size, warnings };
}

/** Hand freshly saved images to CMDS Eagle (or the direct R2 fallback) and verify every URL. */
export async function moveImportedImagesToCloud(
  app: App,
  note: TFile,
  candidates: readonly PersistedCloudImage[],
  settings: ImportCloudSettings
): Promise<CloudImportResult> {
  const progress = new Notice(t("import.cloud.uploading", { count: candidates.length }), 0);
  try {
    const images = uniqueCmdsBridgeImages(candidates);
    const stagingNote = await createCmdsStagingNote(app, images);
    await app.workspace.getLeaf(false).openFile(stagingNote);
    const targetIsActive =
      app.workspace.getActiveFile()?.path === stagingNote.path;
    const bridge = await bridgeActiveNoteImagesThroughCmdsEagle(
      bridgeDependencies(app, stagingNote, settings.executeCommandById),
      images,
      {
        allowCommandFallback: targetIsActive,
        commandTimeoutMs: Math.min(
          15 * 60_000,
          Math.max(60_000, candidates.length * 20_000)
        )
      }
    );
    const appliedSources = await applyVerifiedCloudReplacements(
      app,
      note,
      bridge.replacements
    );
    const allVerifiedReplacementsApplied =
      appliedSources.size === bridge.replacements.length;

    if (bridge.status === "success") {
      const warnings: string[] = [];
      if (allVerifiedReplacementsApplied) {
        const commandSettled =
          !bridge.commandDispatched
          || await waitForCommandStagingToSettle(app, stagingNote);
        if (!commandSettled) {
          warnings.push(t("import.cloud.lateWriteKept", { path: stagingNote.path }));
        } else if (!(await deleteCmdsStagingNote(app, stagingNote))) {
          warnings.push(t("import.cloud.stagingCleanupFailed", { path: stagingNote.path }));
        } else {
          const cleanup = await cleanupVerifiedCloudImages(
            app,
            note,
            candidates,
            appliedSources,
            new Set([stagingNote.path])
          );
          warnings.push(...cleanup.warnings);
        }
      } else {
        warnings.push(t("import.cloud.verifiedNotApplied", { path: stagingNote.path }));
      }
      await app.workspace.getLeaf(false).openFile(note);
      return { uploaded: bridge.replacements.length, warnings };
    }
    if (bridge.commandDispatched) {
      await app.workspace.getLeaf(false).openFile(note);
      return {
        uploaded: bridge.replacements.length,
        warnings: [
          t("import.cloud.commandUnconfirmed", {
            count: bridge.unresolvedSources.length,
            path: stagingNote.path
          })
        ]
      };
    }
    if (bridge.eventUploadAttempted) {
      await app.workspace.getLeaf(false).openFile(note);
      return {
        uploaded: bridge.replacements.length,
        warnings: [
          t("import.cloud.eventUnconfirmed", {
            count: bridge.unresolvedSources.length,
            path: stagingNote.path
          })
        ]
      };
    }

    const cleanupWarnings: string[] = [];
    let stagingNoteRemoved = false;
    if (bridge.status === "unavailable") {
      stagingNoteRemoved = await deleteCmdsStagingNote(app, stagingNote);
      if (!stagingNoteRemoved) {
        cleanupWarnings.push(t("import.cloud.unusedStagingCleanupFailed", { path: stagingNote.path }));
      }
    } else {
      // A partial result is deliberately recoverable even when neither public
      // event nor command reported dispatch (for example, cancellation).
      cleanupWarnings.push(t("import.cloud.partialKept", { path: stagingNote.path }));
    }
    await app.workspace.getLeaf(false).openFile(note);
    const unresolved = new Set(bridge.unresolvedSources);
    const remaining = candidates.filter((candidate) =>
      unresolved.has(candidate.markdownUrl)
    );
    if (bridge.status !== "unavailable") {
      return {
        uploaded: bridge.replacements.length,
        warnings: cleanupWarnings
      };
    }
    const direct = await directR2Fallback(
      app,
      note,
      remaining,
      settings,
      stagingNoteRemoved
    );
    return {
      uploaded: bridge.replacements.length + direct.uploaded,
      warnings: [...cleanupWarnings, ...direct.warnings]
    };
  } finally {
    progress.hide();
  }
}
