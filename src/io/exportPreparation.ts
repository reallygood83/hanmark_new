import type { AdapterWarning, AdapterWarningCode } from "./markdownAdapter";
import { assembleNote, type AssemblyHost, type AssemblyIssue, type AssemblyIssueCode } from "./noteAssembly";
import { resolveOutputLocale, t, type LanguagePreference } from "../i18n";

/**
 * The single step every export path runs on a note body before converting it
 * (HWPX, DOCX, HTML, Editorial PDF, and both previews), so all formats agree.
 */
export interface ExportPreparationOptions {
  /** Setting `assembleEmbeds` (default on). */
  assembleEmbeds: boolean;
  outputLanguage: LanguagePreference;
}

export interface PreparedExportMarkdown {
  markdown: string;
  /** Assembly messages in the adapter's warning shape, ready for any report. */
  warnings: AdapterWarning[];
}

const ISSUE_WARNINGS: Readonly<Record<AssemblyIssueCode, AdapterWarningCode>> = {
  missing: "embed-missing",
  cycle: "embed-cycle",
  depth: "embed-depth",
  section: "embed-section"
};

export function assemblyWarnings(issues: readonly AssemblyIssue[]): AdapterWarning[] {
  const grouped = new Map<AssemblyIssueCode, string[]>();
  for (const issue of issues) {
    const names = grouped.get(issue.code) ?? [];
    if (!names.includes(issue.target)) names.push(issue.target);
    grouped.set(issue.code, names);
  }
  const warnings: AdapterWarning[] = [];
  for (const [code, names] of grouped) {
    const list = names.join(", ");
    const message =
      code === "missing"
        ? t("assembly.warning.missing", { names: list })
        : code === "cycle"
          ? t("assembly.warning.cycle", { names: list })
          : code === "depth"
            ? t("assembly.warning.depth", { names: list })
            : t("assembly.warning.section", { names: list });
    warnings.push({ code: ISSUE_WARNINGS[code], message, count: issues.filter((issue) => issue.code === code).length });
  }
  return warnings;
}

export async function prepareExportMarkdown(
  host: AssemblyHost | null,
  body: string,
  sourcePath: string,
  options: ExportPreparationOptions
): Promise<PreparedExportMarkdown> {
  if (!options.assembleEmbeds || !host) return { markdown: body, warnings: [] };
  const locale = resolveOutputLocale(options.outputLanguage, body);
  const assembled = await assembleNote(host, body, sourcePath, { locale });
  return { markdown: assembled.markdown, warnings: assemblyWarnings(assembled.issues) };
}

/** One-line summary for exports that report through a notice (HTML, PDF, DOCX). */
export function assemblyNotice(warnings: readonly AdapterWarning[]): string | null {
  if (!warnings.length) return null;
  const count = warnings.reduce((sum, warning) => sum + warning.count, 0);
  return t("assembly.notice", { count, first: warnings[0].message });
}

/** Reads `assembleEmbeds` from stored settings; unknown or missing means on. */
export function assembleEmbedsSetting(settings: Record<string, unknown>): boolean {
  return settings.assembleEmbeds !== false;
}
