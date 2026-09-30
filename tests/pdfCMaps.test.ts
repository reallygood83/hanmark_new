import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { build } from "esbuild";
import {
  blockedFileSystemPlugin,
  dependencySourceHardeningPlugin,
  kordocSourceHardeningPlugin,
} from "../esbuild.config.mjs";
import { EMBEDDED_PDF_CMAP_NAMES, HanmarkPdfCMapReaderFactory, embeddedPdfCMap } from "../src/io/pdfCMaps";
import { makeKoreanCMapPdf } from "./fixtures/koreanCMapPdf";

describe("embedded Korean PDF CMaps", () => {
  it("ships the 24 Korean predefined CMaps byte-for-byte from the pinned pdfjs-dist", async () => {
    assert.equal(EMBEDDED_PDF_CMAP_NAMES.length, 24);
    for (const name of ["KSCms-UHC-H", "Adobe-Korea1-UCS2", "UniKS-UTF16-H", "KSC-EUC-H"]) {
      assert.ok(EMBEDDED_PDF_CMAP_NAMES.includes(name), name);
      const expected = await readFile(join("node_modules", "pdfjs-dist", "cmaps", `${name}.bcmap`));
      assert.deepEqual(Buffer.from(embeddedPdfCMap(name) ?? []), expected, name);
    }
  });

  it("answers PDF.js CMap requests and rejects names it does not ship", async () => {
    const reader = new HanmarkPdfCMapReaderFactory({ baseUrl: "hanmark-embedded:", isCompressed: true });
    const found = await reader.fetch({ name: "KSCms-UHC-H" });
    assert.equal(found.isCompressed, true);
    assert.ok(found.cMapData.byteLength > 0);
    await assert.rejects(reader.fetch({ name: "90ms-RKSJ-H" }), /does not bundle/);
  });

  it("lets the production-hardened Kordoc bundle read text that needs a Korean CMap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hanmark-cmap-"));
    const outputPath = join(directory, "cmap.cjs");
    try {
      const result = await build({
        stdin: {
          contents:
            'import { parse } from "kordoc";\n' +
            "export async function parsePdf(bytes) { return parse(new Uint8Array(bytes).buffer); }\n",
          resolveDir: process.cwd(),
          sourcefile: "cmap-smoke.ts",
          loader: "ts",
        },
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "es2018",
        write: false,
        define: { "import.meta.url": "__hwpImportMetaUrl" },
        banner: {
          js:
            "const __hwpImportMetaUrl = require('url').pathToFileURL(__filename).href;\n" +
            "const __hanmarkRequireBuiltin = (name) => require(name);\n" +
            "const __hanmarkBlockedFileSystem = { promises: { readFile: async () => { throw new Error('blocked'); } } };\n" +
            "const __hanmarkDecodeBase64 = (value) => Buffer.from(value, 'base64').toString('latin1');\n" +
            "const __hanmarkEncodeBase64 = (value) => Buffer.from(value, 'latin1').toString('base64');",
        },
        plugins: [blockedFileSystemPlugin, kordocSourceHardeningPlugin, dependencySourceHardeningPlugin],
      });
      const output = result.outputFiles[0];
      assert.ok(output);
      assert.match(output.text, /pdfjsAssets\.CMapReaderFactory = \w*HanmarkPdfCMapReaderFactory;/);
      await writeFile(outputPath, output.contents);
      const runtime = createRequire(import.meta.url)(outputPath) as {
        parsePdf(bytes: ArrayBuffer): Promise<{ success: boolean; markdown?: string; error?: string }>;
      };
      const parsed = await runtime.parsePdf(makeKoreanCMapPdf());
      assert.equal(parsed.success, true, parsed.error);
      assert.match(parsed.markdown ?? "", /한글 PDF/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
