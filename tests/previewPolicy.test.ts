import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LARGE_PREVIEW_NOTE_CHARS, SLOW_PREVIEW_RENDER_MS, shouldPauseLivePreview } from "../src/ui/previewPolicy";

describe("live preview auto-pause policy", () => {
  it("keeps refreshing quick renders of ordinary notes", () => {
    assert.equal(shouldPauseLivePreview(200, 5_000), false);
    assert.equal(shouldPauseLivePreview(SLOW_PREVIEW_RENDER_MS, LARGE_PREVIEW_NOTE_CHARS), false);
  });

  it("pauses after a slow render or for a very large note", () => {
    assert.equal(shouldPauseLivePreview(SLOW_PREVIEW_RENDER_MS + 1, 100), true);
    assert.equal(shouldPauseLivePreview(10, LARGE_PREVIEW_NOTE_CHARS + 1), true);
  });
});
