import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VERSION } from "kordoc";
import { importedByCurrentEngine } from "../src/io/legacyEngine";

describe("legacy imported-note engine check", () => {
  it("allows original-format patching only for notes imported by the bundled engine", () => {
    assert.equal(importedByCurrentEngine({ "hwp-kordoc": String(VERSION) }), true);
    assert.equal(importedByCurrentEngine({ "hwp-kordoc": ` ${String(VERSION)} ` }), true);
  });

  it("routes notes from older or unknown engines to new-file generation", () => {
    assert.equal(importedByCurrentEngine({ "hwp-kordoc": "4.2.5" }), false);
    assert.equal(importedByCurrentEngine({ "hwp-kordoc": "" }), false);
    assert.equal(importedByCurrentEngine({ "hwp-kordoc": "4.15.8" }, "4.15.7"), false);
  });
});
