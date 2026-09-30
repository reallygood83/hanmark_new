import type { GongmunFormOption } from "../io/gongmunExport";

/**
 * Fills a select with official-document forms (R-026), one option group per list
 * group in the order given: the institutions' forms, the standard types, the user's own.
 */
export function fillGongmunFormSelect(select: HTMLSelectElement, forms: readonly GongmunFormOption[]): void {
  const groups = new Map<string, GongmunFormOption[]>();
  for (const form of forms) groups.set(form.group, [...(groups.get(form.group) ?? []), form]);
  for (const [label, items] of groups) {
    const group = select.createEl("optgroup", { attr: { label } });
    for (const item of items) group.createEl("option", { value: item.id, text: item.name });
  }
}
