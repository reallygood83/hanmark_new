/** A render slower than this pauses automatic refresh while typing (2.7.0 W10). */
export const SLOW_PREVIEW_RENDER_MS = 1_500;
/** Notes longer than this pause automatic refresh after their first render. */
export const LARGE_PREVIEW_NOTE_CHARS = 60_000;

export function shouldPauseLivePreview(renderMs: number, markdownLength: number): boolean {
  return renderMs > SLOW_PREVIEW_RENDER_MS || markdownLength > LARGE_PREVIEW_NOTE_CHARS;
}
