import { Notice } from "obsidian";
import { errorMessage } from "../utils/errors";

/**
 * Runs a user-triggered async action and turns any failure into a visible Notice.
 * Button handlers and commands must never fail silently (2.7.0 W10).
 */
export async function runWithNotice(failure: string, task: () => Promise<unknown>): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error: unknown) {
    new Notice(`${failure}: ${errorMessage(error)}`, 8_000);
    return false;
  }
}
