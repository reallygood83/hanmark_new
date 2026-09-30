import { t } from "../i18n";

export interface EditorialPdfLayout {
  mode: "single" | "two-column-a" | "two-column-b";
  columnGapMm: 8 | 10 | 12;
  sectionPageBreaks: boolean;
  tableWidth: "auto" | "column" | "full";
}

export const DEFAULT_EDITORIAL_PDF_LAYOUT: Readonly<EditorialPdfLayout> = Object.freeze({
  mode: "single", columnGapMm: 10, sectionPageBreaks: false, tableWidth: "auto"
});

export function normalizeEditorialPdfLayout(value: unknown): EditorialPdfLayout {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    mode: data.mode === "two-column-a" || data.mode === "two-column-b" ? data.mode : "single",
    columnGapMm: data.columnGapMm === 8 || data.columnGapMm === 12 ? data.columnGapMm : 10,
    sectionPageBreaks: data.sectionPageBreaks === true,
    tableWidth: data.tableWidth === "column" || data.tableWidth === "full" ? data.tableWidth : "auto"
  };
}

/** Dropdown labels in the interface language, keyed by stored layout mode. */
export function editorialPdfLayoutChoices(): Record<EditorialPdfLayout["mode"], string> {
  return {
    single: t("pdf.layout.single"),
    "two-column-a": t("pdf.layout.twoColumnA"),
    "two-column-b": t("pdf.layout.twoColumnB")
  };
}

/** Dropdown labels in the interface language, keyed by stored table width. */
export function editorialPdfTableWidthChoices(): Record<EditorialPdfLayout["tableWidth"], string> {
  return {
    auto: t("pdf.tableWidth.auto"),
    column: t("pdf.tableWidth.column"),
    full: t("pdf.tableWidth.full")
  };
}
