import { TFile, type App } from "obsidian";
import type { AssemblyHost } from "./noteAssembly";
import { t } from "../i18n";

/** Note assembly backed by Obsidian's link resolution and cached Vault reads. */
export function createVaultAssemblyHost(app: App): AssemblyHost {
  return {
    resolve(linkpath, sourcePath) {
      const file =
        app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) ??
        app.vault.getAbstractFileByPath(linkpath);
      return file instanceof TFile ? { path: file.path, extension: file.extension.toLowerCase() } : null;
    },
    async read(path) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(t("assembly.warning.missing", { names: path }));
      return app.vault.cachedRead(file);
    }
  };
}
