/**
 * Exporting one note to several official-document forms in one go (R-028).
 *
 * Forms run one after another. A form that fails is reported and the rest continue;
 * a stop request takes effect between forms. The first missing-image failure asks the
 * user once, and the answer applies to every later form.
 */
export type BatchStatus = "saved" | "failed" | "cancelled";

export interface BatchEntry<F, R> {
  form: F;
  status: BatchStatus;
  result?: R;
  /** Why the form failed. */
  error?: string;
}

export type ImageFailureDecision = "continue" | "cancel";

export interface BatchHooks<F, R> {
  /** Before each form: its 0-based position and the number of forms. */
  onProgress?: (index: number, total: number, form: F) => void;
  /** After each form, with its entry. */
  onEntry?: (entry: BatchEntry<F, R>, index: number) => void;
  /** Checked before each form. */
  isCancelled?: () => boolean;
  /** Recognizes the error an export raises when images are missing. */
  isImageFailure?: (error: unknown) => boolean;
  /** Asked once, on the first missing-image failure. */
  decideImageFailures?: (error: unknown) => Promise<ImageFailureDecision>;
  describeError?: (error: unknown) => string;
}

export async function runGongmunBatch<F, R>(
  forms: readonly F[],
  exportOne: (form: F, allowImageFailures: boolean) => Promise<R>,
  hooks: BatchHooks<F, R> = {}
): Promise<Array<BatchEntry<F, R>>> {
  const entries: Array<BatchEntry<F, R>> = [];
  const describe = hooks.describeError ?? ((error: unknown) => (error instanceof Error ? error.message : String(error)));
  let allowImageFailures = false;
  let decided = false;
  let stopped = false;
  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index];
    if (stopped || hooks.isCancelled?.()) {
      stopped = true;
      entries.push({ form, status: "cancelled" });
      hooks.onEntry?.(entries[entries.length - 1], index);
      continue;
    }
    hooks.onProgress?.(index, forms.length, form);
    let entry: BatchEntry<F, R>;
    try {
      entry = { form, status: "saved", result: await exportOne(form, allowImageFailures) };
    } catch (error) {
      if (!allowImageFailures && !decided && hooks.isImageFailure?.(error) && hooks.decideImageFailures) {
        decided = true;
        const decision = await hooks.decideImageFailures(error);
        if (decision === "continue") {
          allowImageFailures = true;
          try {
            entry = { form, status: "saved", result: await exportOne(form, true) };
          } catch (retryError) {
            entry = { form, status: "failed", error: describe(retryError) };
          }
        } else {
          stopped = true;
          entry = { form, status: "cancelled" };
        }
      } else {
        entry = { form, status: "failed", error: describe(error) };
      }
    }
    entries.push(entry);
    hooks.onEntry?.(entry, index);
  }
  return entries;
}
