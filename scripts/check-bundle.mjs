import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../main.js", import.meta.url), "utf8");
const entry = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const exportTypes = await readFile(new URL("../src/io/exportTypes.ts", import.meta.url), "utf8");
const docxPreviewView = await readFile(
  new URL("../src/ui/DocxPreviewView.ts", import.meta.url),
  "utf8"
);
const packageManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
// 2.6.1 (Kordoc 4.2.5): 3,322,872 bytes. 2.7.0 M1 (Kordoc 4.15.7 library graph,
// no new features yet): 3,668,074 bytes. 2.7.0 M2: 3,889,725 bytes (+214,678 bytes
// of base64 Korean PDF CMaps, plus HWPX post-processing and the font guide).
// 2.7.0 M5: 3,979,852 bytes (UTF-8 output charset). 2.7.0 M6: 4,050,630 bytes
// (+58,931 bytes of comparison and form-filling code, of which 21,353 are Kordoc
// diff/fill modules and 18,883 the two embedded standard draft letters; +11,847
// bytes of messages). 2.7.0 M7 (every screen in Korean and English, 1,412 message
// keys): 4,147,233 bytes, within the M6 ceiling. 2.7.0 official-document
// feedback (R-024 to R-026: heading mapping and finishing, Hallym University
// forms, per-type frames, one form list, the preview toolbar): 4,179,268 bytes
// (+32,035; new modules 16,197 bytes).
// The ceiling keeps ~3% headroom and is raised only with a recorded reason
// (docs/research/R-018 change log).
const maximumBundleBytes = 4_305_000;
const pinnedKordocVersion = packageManifest.dependencies?.kordoc;
const installedKordoc = JSON.parse(
  await readFile(new URL("../node_modules/kordoc/package.json", import.meta.url), "utf8")
);
const forbiddenNativeModules = [
  "sharp",
  "onnxruntime-node",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "canvas"
];

const escaped = forbiddenNativeModules.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const staticRequire = new RegExp(`require\\(["'](?:${escaped.join("|")})["']\\)`, "g");
const forbiddenHits = bundle.match(staticRequire) ?? [];
const optionalNativeLoader = new RegExp(
  `(?:\\bimport\\s*\\(|\\brequire\\d*\\s*\\()\\s*["'](?:${escaped.join("|")})["']\\s*\\)`,
  "g",
);
const optionalNativeLoaderHits = bundle.match(optionalNativeLoader) ?? [];
const forbiddenSpecificNames = [
  "onnxruntime-node",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
].filter((name) => bundle.includes(name));
const dynamicCfbRequire =
  bundle.match(/\brequire\d*\(\s*["']cfb["']\s*\)/g) ?? [];
const unsafeRuntimePatterns = [
  ["dynamic Function constructor", /(?<![\w$.])(?:new\s+)?Function\s*\(/u],
  ["eval", /(?<![\w$.])eval\s*\(/u],
  ["dynamic import", /\bimport\s*\(/u],
  ["createRequire", /\bcreateRequire\b/u],
  ["Clipboard API", /\bnavigator\s*\.\s*clipboard\b|\bClipboardItem\b/u],
  [
    "clipboard event access",
    /\bclipboardData\b|\.addEventListener\(\s*["'](?:copy|cut|paste)["']/u,
  ],
  ["bare atob/btoa", /(?<![\w$.])(?:atob|btoa)\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
  ["HTML string insertion", /\.innerHTML\b|\.srcdoc\b/u],
  ["DOCX altChunk rendering", /renderAltChunks\s*:\s*true/u],
];
const unsafeRuntimeHits = unsafeRuntimePatterns
  .filter(([, pattern]) => pattern.test(bundle))
  .map(([name]) => name);
const unintendedComRuntime = [
  ...bundle.matchAll(
    /require\(\s*["']child_process["']\s*\)|\bexecFileSync\b|HWPFrame\.HwpObject/gu,
  ),
].map((match) => match[0]);
const intentionalChildProcessBoundaries =
  bundle.match(/require\(\s*["']node:child_process["']\s*\)/gu) ?? [];

if (forbiddenHits.length > 0) {
  throw new Error(`Optional OCR/native modules leaked into the startup bundle: ${forbiddenHits.join(", ")}`);
}

if (optionalNativeLoaderHits.length > 0 || forbiddenSpecificNames.length > 0) {
  throw new Error(
    `Optional native loader/specifier remnants leaked into the startup bundle: ${[
      ...optionalNativeLoaderHits,
      ...forbiddenSpecificNames,
    ].join(", ")}`
  );
}

if (dynamicCfbRequire.length > 0) {
  throw new Error("Kordoc CFB remained a runtime dynamic require instead of being bundled.");
}

if (unsafeRuntimeHits.length > 0) {
  throw new Error(`Unsafe runtime constructs leaked into the production bundle: ${unsafeRuntimeHits.join(", ")}`);
}

if (
  unintendedComRuntime.length > 0 ||
  intentionalChildProcessBoundaries.length !== 1
) {
  throw new Error(
    `Kordoc COM process execution leaked into the bundle or the user-process boundary changed: ${[
      ...unintendedComRuntime,
      `intentional boundaries=${intentionalChildProcessBoundaries.length}`,
    ].join(", ")}`
  );
}

if (typeof pinnedKordocVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(pinnedKordocVersion)) {
  throw new Error("kordoc must be pinned to an exact version in package.json.");
}
if (installedKordoc.version !== pinnedKordocVersion) {
  throw new Error(
    `Installed Kordoc ${installedKordoc.version} differs from the pinned ${pinnedKordocVersion}; run npm ci.`
  );
}
// Kordoc embeds its own version as the VERSION export. Checking the quoted
// version string (not a bare substring) proves the pinned engine was bundled.
if (!bundle.includes(`"${pinnedKordocVersion}"`)) {
  throw new Error(`The production bundle does not contain the pinned Kordoc ${pinnedKordocVersion} implementation.`);
}

if (Buffer.byteLength(bundle, "utf8") > maximumBundleBytes) {
  throw new Error(
    `Production bundle exceeds the recorded ceiling (${Buffer.byteLength(bundle, "utf8")} > ${maximumBundleBytes} bytes). Record the reason in docs/research before raising it.`
  );
}

if (entry.includes("legacy-main.cjs") || bundle.includes("pypandoc-hwpx")) {
  throw new Error("The retired legacy/Python HWPX compatibility runtime remains in the production path.");
}

if (exportTypes.includes('"template-hwpx"')) {
  throw new Error("The retired pypandoc-hwpx export mode remains in the public export type.");
}

if (packageManifest.dependencies?.["docx-preview"] !== "0.4.0") {
  throw new Error("The DOCX package renderer must remain pinned to docx-preview 0.4.0.");
}

if (packageManifest.dependencies?.["pdfjs-dist"] !== "4.10.38") {
  throw new Error("PDF.js source hardening requires the exact pdfjs-dist 4.10.38 source.");
}

if (
  !bundle.includes("docx-preview <https://github.com/VolodymyrBaydalka/docxjs>") ||
  !bundle.includes("Released under Apache License 2.0")
) {
  throw new Error("The bundled docx-preview Apache-2.0 attribution was removed.");
}

const docxBuilderReferences =
  docxPreviewView.match(/\.buildDocxBytesUserInitiated\s*\(/g) ?? [];
if (
  docxBuilderReferences.length !== 1 ||
  !docxPreviewView.includes("new UserInitiatedDocxPackagePreview")
) {
  throw new Error(
    "DOCX preview generation must remain behind the user-initiated runtime gate."
  );
}

if (!bundle.includes("A user-initiated DOCX preview request is required.")) {
  throw new Error("The user-initiated DOCX preview runtime gate was removed from the bundle.");
}

console.log(
  `Bundle check passed: ${Buffer.byteLength(bundle, "utf8")} bytes; Kordoc ${pinnedKordocVersion} and guarded DOCX package preview present; PDF.js clipboard and Kordoc COM fallbacks removed; only the user-initiated process boundary remains.`
);
