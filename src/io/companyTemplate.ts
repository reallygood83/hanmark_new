import type { GongmunPreset } from "kordoc";
import type { DocumentStyleProfile } from "./documentStyle";
import { isSameOrInside, movedPath } from "./formMemory";
import { normalizeGongmunStyleOptions, type GongmunStyleOptions } from "./gongmunStyle";

/**
 * Company templates (기관 템플릿): one registered note, its document style, and its
 * official-document form. This module is pure — it does not import Obsidian, read
 * the vault, or change the global active template.
 *
 * Page margins in a document style are HWP units. The style editor uses the same
 * divisor (src/ui/DocumentStyleModal.ts).
 */
export const HU_PER_MM = 283.4646;

export const COMPANY_TEMPLATE_LIMIT = 100;

const DRAFT_FLAG = "hanmark-template-draft";
const REGISTERED_FLAG = "hanmark-company-template";

export interface CompanyTemplateRecord {
  id: string;
  name: string;
  /** Vault path of the template note. Empty after that note is deleted. */
  notePath: string;
  documentStyleId?: string;
  gongmunTemplateId?: string;
  sourceName?: string;
  /** False while the imported note is still a draft. */
  registered: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CompanyExportDecision =
  | "global"
  | "abort"
  | { documentStyleId?: string; gongmunTemplateId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, 80);
  return name || undefined;
}

function cleanId(value: unknown, fallback: string | undefined): string | undefined {
  const id = (typeof value === "string" && value.trim() ? value : fallback ?? "").trim();
  return /^company:[A-Za-z0-9-]{8,80}$/u.test(id) ? id : undefined;
}

function cleanPath(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 400) : "";
}

function optionalId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return id ? id.slice(0, 80) : undefined;
}

/** Keeps a well-formed record. Unknown fields are dropped. */
export function normalizeCompanyTemplateRecord(value: unknown, fallbackId?: string): CompanyTemplateRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = cleanId(value.id, fallbackId);
  const name = cleanName(value.name);
  if (!id || !name) return undefined;
  const createdAt = typeof value.createdAt === "string" && value.createdAt ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : createdAt;
  return {
    id,
    name,
    notePath: cleanPath(value.notePath),
    documentStyleId: optionalId(value.documentStyleId),
    gongmunTemplateId: optionalId(value.gongmunTemplateId),
    sourceName: cleanName(value.sourceName),
    registered: value.registered === true,
    createdAt,
    updatedAt
  };
}

export function normalizeCompanyTemplates(value: unknown): Record<string, CompanyTemplateRecord> {
  const result: Record<string, CompanyTemplateRecord> = {};
  if (!isRecord(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    const record = normalizeCompanyTemplateRecord(raw, key);
    if (!record) continue;
    result[record.id] = record;
    if (Object.keys(result).length >= COMPANY_TEMPLATE_LIMIT) break;
  }
  return result;
}

export function newCompanyTemplateId(): string {
  return `company:${crypto.randomUUID()}`;
}

function bodyFontKind(family: string | undefined): "myeongjo" | "gothic" | undefined {
  if (!family) return undefined;
  // i18n-data-begin: font-name fragments, not interface text
  if (family.includes("고딕")) return "gothic";
  if (family.includes("명조") || family.includes("바탕")) return "myeongjo";
  // i18n-data-end
  return undefined;
}

function marginsMm(profile: DocumentStyleProfile): GongmunStyleOptions["margins"] | undefined {
  const margins = profile.page?.margins;
  if (!margins) return undefined;
  const sides = {
    top: Math.round(margins.top / HU_PER_MM),
    bottom: Math.round(margins.bottom / HU_PER_MM),
    left: Math.round(margins.left / HU_PER_MM),
    right: Math.round(margins.right / HU_PER_MM)
  };
  if (Object.values(sides).some((side) => side < 5 || side > 60)) return undefined;
  return sides;
}

/**
 * The part of a document style that an official-document form can store.
 * Type, organization, approval, bands, and a cover are left for the user to confirm.
 */
export function gongmunDraftFromDocumentStyle(profile: DocumentStyleProfile): GongmunStyleOptions {
  const body = profile.roles.body?.character;
  const heading = profile.roles.h1?.character ?? body;
  const fonts: NonNullable<GongmunStyleOptions["fonts"]> = {};
  if (body?.fontFamily) fonts.body = body.fontFamily;
  if (heading?.fontFamily) fonts.heading = heading.fontFamily;
  const bodyPt = body?.fontSizePt;
  const spacing = profile.roles.body?.paragraph?.lineSpacingPercent;
  const kind = bodyFontKind(body?.fontFamily);
  return normalizeGongmunStyleOptions({
    fonts: fonts.body || fonts.heading ? fonts : undefined,
    bodyFont: kind,
    bodyPt: bodyPt !== undefined && bodyPt >= 8 && bodyPt <= 24 ? bodyPt : undefined,
    lineSpacing: spacing !== undefined && spacing >= 100 && spacing <= 250 ? spacing : undefined,
    margins: marginsMm(profile)
  });
}

/** A file name may suggest a document type. It never confirms one. 업무보고 is checked before 보고. */
export function suggestGongmunPreset(text: string): GongmunPreset {
  // i18n-data-begin: document-type words matched in a file name
  const hints: ReadonlyArray<readonly [string, GongmunPreset]> = [
    ["업무보고", "ministry"],
    ["회의록", "minutes"],
    ["기안", "official"],
    ["계획", "plan"],
    ["통지", "notice"],
    ["보도", "press"],
    ["보고", "report"]
  ];
  // i18n-data-end
  for (const [word, preset] of hints) if (text.includes(word)) return preset;
  return "report";
}

/** Comma-separated approval names, at most eight. */
export function approvalNames(text: string): string[] {
  return text
    .split(/[,，]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 8);
}

/**
 * A registered link selects that template. Anything else keeps today's global template.
 * A registered link with nowhere to read aborts instead of falling back.
 */
export function companyExportDecision(record: CompanyTemplateRecord | undefined): CompanyExportDecision {
  if (!record?.registered) return "global";
  if (!record.notePath || (!record.documentStyleId && !record.gongmunTemplateId)) return "abort";
  return { documentStyleId: record.documentStyleId, gongmunTemplateId: record.gongmunTemplateId };
}

/** Drops the two template flags and keeps every other frontmatter line, including 공문 properties. */
export function withoutCompanyTemplateFlags(markdown: string): string {
  const match = /^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(markdown);
  if (!match) return markdown;
  const lines = match[2].split(/\r?\n/u).filter((line) => {
    const key = line.split(":")[0]?.trim();
    return key !== DRAFT_FLAG && key !== REGISTERED_FLAG;
  });
  const body = markdown.slice(match[0].length);
  if (!lines.length) return body;
  return `${match[1]}---\n${lines.join("\n")}\n---\n${body}`;
}

/** Keys that are not already on the note. Existing values are never listed. */
export function absentKeys(existing: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys.filter((key) => !(key in existing));
}

export function renameCompanyTemplateNotes(
  records: Readonly<Record<string, CompanyTemplateRecord>>,
  oldPath: string,
  newPath: string
): Record<string, CompanyTemplateRecord> {
  const next: Record<string, CompanyTemplateRecord> = {};
  for (const [id, record] of Object.entries(records)) {
    const moved = movedPath(record.notePath, oldPath, newPath);
    next[id] = moved === null ? record : { ...record, notePath: moved };
  }
  return next;
}

/** A deleted template note stays registered so export stops, instead of using the global style. */
export function detachDeletedTemplateNotes(
  records: Readonly<Record<string, CompanyTemplateRecord>>,
  path: string
): Record<string, CompanyTemplateRecord> {
  const next: Record<string, CompanyTemplateRecord> = {};
  for (const [id, record] of Object.entries(records)) {
    next[id] = record.notePath && isSameOrInside(record.notePath, path) ? { ...record, notePath: "" } : record;
  }
  return next;
}
