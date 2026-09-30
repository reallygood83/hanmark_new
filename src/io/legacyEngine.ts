import { VERSION as KORDOC_VERSION } from "kordoc";
import type { HwpSourceContract } from "./frontmatter";
import { t } from "../i18n";

/** Report line explaining why an old note was saved as a new file. */
export function legacyEngineNote(): string {
  return t("save.legacyEngine.note");
}

/**
 * Original-format patching is only safe when the note was imported by the engine that
 * will patch it: a newer Kordoc reads the same original differently, and the patcher
 * would write those differences into the original as if they were the user's edits.
 * Notes carrying an older (or no) `hwp-kordoc` value are generated anew (R-018).
 */
export function importedByCurrentEngine(
  contract: Pick<HwpSourceContract, "hwp-kordoc">,
  engineVersion: string = String(KORDOC_VERSION)
): boolean {
  return contract["hwp-kordoc"].trim() === engineVersion;
}
