import { BUILTIN_FORM_BASE64 } from "./formTemplateData";
import type { MessageKey } from "../i18n";

export type BuiltinFormId = keyof typeof BUILTIN_FORM_BASE64;

export interface BuiltinForm {
  id: BuiltinFormId;
  /** Interface name of the form. */
  label: MessageKey;
  /** Official form name, used for new file names (document content). */
  documentName: string;
}

// i18n-data-begin: official form names (proper names of government forms)
export const BUILTIN_FORMS: readonly BuiltinForm[] = [
  { id: "gian", label: "form.builtin.gian", documentName: "일반기안문" },
  { id: "gian-simple", label: "form.builtin.gianSimple", documentName: "간이기안문" }
];
// i18n-data-end

export function isBuiltinFormId(value: string): value is BuiltinFormId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_FORM_BASE64, value);
}

/** Bytes of an embedded standard form (a fresh copy on every call). */
export function builtinFormBytes(id: BuiltinFormId): Uint8Array {
  return new Uint8Array(Buffer.from(BUILTIN_FORM_BASE64[id], "base64"));
}
