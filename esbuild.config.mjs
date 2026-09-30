import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { promises as fsp } from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const prod = process.argv[2] === "production";
const outputFile = "main.js";

const external = [
  "obsidian",
  "electron",
  "@electron/remote",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  // Kordoc optional OCR, ML, printing, and MCP integrations are not part of
  // HanMark's runtime. PDF.js remains bundled because PDF import uses it.
  "puppeteer-core",
  "@modelcontextprotocol/sdk",
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
  "@napi-rs/canvas",
  "canvas",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

const CFB_DYNAMIC_REQUIRE = /\b(require\d*)\(\s*["']cfb["']\s*\)/g;
const OPTIONAL_NATIVE_MODULES = [
  "onnxruntime-node",
  "sharp",
  "@huggingface/transformers",
  "@hyzyla/pdfium",
];
const OPTIONAL_NATIVE_ALTERNATION = OPTIONAL_NATIVE_MODULES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const OPTIONAL_NATIVE_CJS_IMPORT = new RegExp(
  `Promise\\.resolve\\(\\)\\.then\\(\\(\\)\\s*=>\\s*_interopRequireWildcard\\(require\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)\\)\\)`,
  "g",
);
const OPTIONAL_NATIVE_DYNAMIC_IMPORT = new RegExp(
  `\\bimport\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)`,
  "g",
);
const OPTIONAL_NATIVE_REQUIRE = new RegExp(
  `\\brequire\\d*\\(\\s*["'](?:${OPTIONAL_NATIVE_ALTERNATION})["']\\s*\\)`,
  "g",
);
const OPTIONAL_NATIVE_STRING = new RegExp(
  `(["'])(?:${OPTIONAL_NATIVE_ALTERNATION})\\1`,
  "g",
);
const KORDOC_PDF_ASSET_CREATE_REQUIRE =
  /try \{\r?\n  const _require = createRequire\(import\.meta\.url\);\r?\n  const pkgDir = dirname\(_require\.resolve\("pdfjs-dist\/package\.json"\)\);\r?\n  pdfjsAssets\.cMapUrl = join\(pkgDir, "cmaps"\) \+ "\/";\r?\n  pdfjsAssets\.cMapPacked = true;\r?\n  pdfjsAssets\.standardFontDataUrl = join\(pkgDir, "standard_fonts"\) \+ "\/";\r?\n\} catch \{\r?\n\}/g;
const KORDOC_CREATE_REQUIRE_IMPORT =
  /import\s*\{\s*createRequire\s*\}\s*from\s*["'](?:node:)?module["'];?\r?\n/g;
const SET_IMMEDIATE_STRING_CALLBACK =
  /callback\s*=\s*new Function\(""\s*\+\s*callback\);/g;
const SET_IMMEDIATE_READY_STATE =
  /^    function installReadyStateChangeImplementation\(\) \{[\s\S]*?^    \}/gm;
const SET_IMMEDIATE_READY_STATE_PROBE =
  /doc && "onreadystatechange" in doc\.createElement\("script"\)/g;
const IMMEDIATE_READY_STATE_BRANCH =
  /  \} else if \('document' in global && 'onreadystatechange' in global\.document\.createElement\('script'\)\) \{[\s\S]*?^  \} else \{/gm;
const PDF_EVAL_PROBE =
  /function isEvalSupported\(\)\s*\{\s*try\s*\{\s*new Function\(""\);\s*return true;\s*\}\s*catch\s*\{\s*return false;\s*\}\s*\}/g;
const PDF_POSTSCRIPT_COMPILER =
  /    if \(isEvalSupported && FeatureTest\.isEvalSupported\) \{\r?\n      const compiled = new PostScriptCompiler\(\)\.compile\(code, domain, range\);\r?\n      if \(compiled\) \{\r?\n        return new Function\("src", "srcOffset", "dest", "destOffset", compiled\);\r?\n      \}\r?\n    \}/g;
const BARE_ATOB_CALL = /(?<![\w$.])atob\s*\(/g;
const BARE_BTOA_CALL = /(?<![\w$.])btoa\s*\(/g;
const PDF_DYNAMIC_REQUIRE_FALLBACK =
  "Function('return require(\"' + name + '\")')()";
const PDF_GLOBAL_THIS_FALLBACK = "Function('return this')()";
const PDF_NODE_FS_ACCESS =
  /process\.getBuiltinModule\(\s*["']fs["']\s*\)/g;
const PDF_NODE_CANVAS_BOOTSTRAP =
  /if \(isNodeJS\) \{\r?\n  let canvas;[\s\S]*?\r?\n\}\r?\nasync function node_utils_fetchData/g;
const PDF_NODE_CANVAS_FACTORY =
  /class NodeCanvasFactory extends BaseCanvasFactory \{\r?\n  _createCanvas\(width, height\) \{\r?\n    const require = process\.getBuiltinModule\("module"\)\.createRequire\(import\.meta\.url\);\r?\n    const canvas = require\("@napi-rs\/canvas"\);\r?\n    return canvas\.createCanvas\(width, height\);\r?\n  \}\r?\n\}/g;
const PDF_WORKER_CDN_WRAPPER =
  /this\._createCDNWrapper = url => \{\r?\n      const wrapper = `await import\("\$\{url\}"\);`;\r?\n      return URL\.createObjectURL\(new Blob\(\[wrapper\], \{\r?\n        type: "text\/javascript"\r?\n      \}\)\);\r?\n    \};/g;
const PDF_FAKE_WORKER_DYNAMIC_IMPORT =
  /      const worker = await import\(\/\*webpackIgnore: true\*\/this\.workerSrc\);\r?\n      return worker\.WorkerMessageHandler;/g;
const PDF_CLIPBOARD_DATA_PATH =
  /event\.clipboardData\.setData\("application\/pdfjs",|clipboardData\.items|clipboardData\.getData\("application\/pdfjs"\)|clipboardData\.getData\("text"\)/g;
const PDF_CLIPBOARD_EVENT_LISTENER =
  /    (?:document|this\.editorDiv)\.addEventListener\("(?:copy|cut|paste)", this\.(?:copy|cut|paste|editorDivPaste)\.bind\(this\), \{\r?\n      signal\r?\n    \}\);\r?\n/g;
const PDF_ANNOTATION_COPY_METHOD =
  /  copy\(event\) \{\r?\n[\s\S]*?\r?\n  \}\r?\n(?=  cut\(event\) \{)/g;
const PDF_ANNOTATION_CUT_METHOD =
  /  cut\(event\) \{\r?\n[\s\S]*?\r?\n  \}\r?\n(?=  async paste\(event\) \{)/g;
const PDF_ANNOTATION_PASTE_METHOD =
  /  async paste\(event\) \{\r?\n[\s\S]*?\r?\n  \}\r?\n(?=  keydown\(event\) \{)/g;
const PDF_FREETEXT_PASTE_METHOD =
  /  editorDivPaste\(event\) \{\r?\n[\s\S]*?\r?\n  \}\r?\n(?=  #setContent\(\) \{)/g;
const KORDOC_COM_HELPERS =
  /\/\/ src\/hwpx\/com-fallback\.ts\r?\nimport \{ execFileSync \} from "child_process";\r?\nimport \{ platform \} from "os";\r?\nfunction isComFallbackAvailable\(\) \{[\s\S]*?\r?\n\}\r?\n(?=\r?\n\/\/ src\/)/g;
// Every COM call site is guarded by this condition. Branches are removed by
// brace matching rather than by the text around them, so a Kordoc refactor of
// neighbouring code cannot silently leave a branch behind.
const KORDOC_COM_BRANCH_GUARD =
  /isComFallbackAvailable\(\) && options\?\.filePath\) \{/g;

/**
 * Transform counts for the Kordoc library graph (dist/index.js and the chunks
 * it imports). A Kordoc upgrade must be reviewed against these numbers; the
 * build stops if the installed version or any count differs.
 */
export const KORDOC_HARDENING_MANIFEST = Object.freeze({
  version: "4.15.7",
  cfbLoaders: 2,
  comHelpers: 1,
  comBranches: 2,
  pdfAssetLookups: 1,
});

export async function installedKordocVersion(cwd = process.cwd()) {
  const manifest = JSON.parse(
    await fsp.readFile(
      nodePath.join(cwd, "node_modules", "kordoc", "package.json"),
      "utf8",
    ),
  );
  return String(manifest.version);
}

export function assertKordocManifestVersion(version) {
  if (version !== KORDOC_HARDENING_MANIFEST.version) {
    throw new Error(
      `Installed Kordoc ${version} does not match the reviewed hardening manifest ${KORDOC_HARDENING_MANIFEST.version}. ` +
        "Review every Kordoc transform in esbuild.config.mjs before changing the manifest.",
    );
  }
}
const DOCX_PREVIEW_NBSP_HTML =
  /^([ \t]*)elem\.innerHTML = "&nbsp;";$/gm;
const DOCX_PREVIEW_ALT_CHUNK =
  /^([ \t]*)renderAltChunk\(elem\) \{\r?\n[ \t]*if \(!this\.options\.renderAltChunks\)\r?\n[ \t]*return null;\r?\n[ \t]*var result = this\.h\(\{ tagName: "iframe" \}\);\r?\n[ \t]*this\.tasks\.push\(this\.document\.loadAltChunk\(elem\.id, this\.currentPart\)\.then\(x => \{\r?\n[ \t]*result\.srcdoc = x;\r?\n[ \t]*\}\)\);\r?\n[ \t]*return result;\r?\n[ \t]*\}$/gm;
const DOCX_PREVIEW_ALT_CHUNK_DEFAULT =
  /^([ \t]*)renderAltChunks: true,$/gm;
const DOCX_PREVIEW_STYLE_CLEAR =
  /^([ \t]*)styleContainer\.innerHTML = "";$/gm;
const DOCX_PREVIEW_BODY_CLEAR =
  /^([ \t]*)bodyContainer\.innerHTML = "";$/gm;

function replaceWithCount(source, pattern, replacement) {
  let replacements = 0;
  return {
    source: source.replace(pattern, (...args) => {
      replacements += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    }),
    replacements,
  };
}

/**
 * Kordoc loads CFB through createRequire-generated names such as
 * require2("cfb") in the HWP 5 parser and the HWP 5 patcher. Those calls would
 * otherwise resolve next to main.js at runtime. A static import keeps the
 * HWP/HWPX parser self-contained.
 */
export function injectKordocCfb(source) {
  const loaderNames = Array.from(
    source.matchAll(CFB_DYNAMIC_REQUIRE),
    (match) => match[1],
  );
  const result = replaceWithCount(
    source,
    CFB_DYNAMIC_REQUIRE,
    "(__kordoc_cfb.default || __kordoc_cfb)",
  );
  if (result.replacements === 0) {
    return result;
  }
  let transformed = result.source;
  const createRequireNames = new Set();
  for (const loaderName of loaderNames) {
    const declaration = new RegExp(
      `\\b(?:var|const|let)\\s+${loaderName}\\s*=\\s*(createRequire\\d*)\\(import\\.meta\\.url\\);\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(declaration, (_match, factoryName) => {
      createRequireNames.add(factoryName);
      return "";
    });
    const transpiledDeclaration = new RegExp(
      `\\b(?:var|const|let)\\s+${loaderName}\\s*=\\s*[^;\\r\\n]*\\bcreateRequire\\b[^;\\r\\n]*;\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(transpiledDeclaration, "");
  }
  for (const factoryName of createRequireNames) {
    const createRequireImport = new RegExp(
      `import\\s*\\{\\s*createRequire(?:\\s+as\\s+${factoryName})?\\s*\\}\\s*from\\s*["'](?:node:)?module["'];?\\r?\\n`,
      "g",
    );
    transformed = transformed.replace(createRequireImport, "");
  }
  return {
    source: `import * as __kordoc_cfb from "cfb";\n${transformed}`,
    replacements: result.replacements,
  };
}

/**
 * HanMark intentionally excludes Kordoc's OCR/ML/native rasterizers. Replacing
 * their lazy loaders with a rejected promise keeps the document parsers in the
 * browser bundle while ensuring Electron never attempts to resolve an
 * unshipped native addon.
 */
export function hardenKordocOptionalNativeSource(source) {
  const cjsImports = replaceWithCount(
    source,
    OPTIONAL_NATIVE_CJS_IMPORT,
    'Promise.reject(new Error("HanMark does not bundle optional native features."))',
  );
  const dynamicImports = replaceWithCount(
    cjsImports.source,
    OPTIONAL_NATIVE_DYNAMIC_IMPORT,
    'Promise.reject(new Error("HanMark does not bundle optional native features."))',
  );
  const runtimeRequires = replaceWithCount(
    dynamicImports.source,
    OPTIONAL_NATIVE_REQUIRE,
    '(() => { throw new Error("HanMark does not bundle optional native features."); })()',
  );
  const moduleNames = replaceWithCount(
    runtimeRequires.source,
    OPTIONAL_NATIVE_STRING,
    '"hanmark-disabled-native-addon"',
  );
  return {
    source: moduleNames.source,
    cjsImportReplacements: cjsImports.replacements,
    dynamicImportReplacements: dynamicImports.replacements,
    runtimeRequireReplacements: runtimeRequires.replacements,
    moduleNameReplacements: moduleNames.replacements,
  };
}

// Absolute, forward-slash path of HanMark's embedded CMap reader, imported into
// Kordoc's PDF parser chunk in place of its filesystem asset lookup.
export const HANMARK_PDF_CMAP_MODULE = nodePath
  .join(nodePath.dirname(fileURLToPath(import.meta.url)), "src", "io", "pdfCMaps.ts")
  .split(nodePath.sep)
  .join("/");

/**
 * Kordoc resolves PDF.js CMaps and standard fonts through Node's createRequire,
 * which cannot work inside the bundled plugin. Without CMaps PDF.js drops all text
 * set in fonts that rely on predefined CMaps (common in Korean PDFs). Replace the
 * lookup with HanMark's embedded Korean CMap reader: no filesystem, no network.
 */
export function hardenKordocPdfParserSource(source) {
  const assetLookup = replaceWithCount(
    source,
    KORDOC_PDF_ASSET_CREATE_REQUIRE,
    [
      "pdfjsAssets.CMapReaderFactory = __hanmarkPdfCMapReaderFactory;",
      'pdfjsAssets.cMapUrl = "hanmark-embedded:";',
      "pdfjsAssets.cMapPacked = true;",
    ].join("\n"),
  );
  const createRequireImport = replaceWithCount(
    assetLookup.source,
    KORDOC_CREATE_REQUIRE_IMPORT,
    "",
  );
  const withReader =
    assetLookup.replacements > 0
      ? `import { HanmarkPdfCMapReaderFactory as __hanmarkPdfCMapReaderFactory } from ${JSON.stringify(HANMARK_PDF_CMAP_MODULE)};\n${createRequireImport.source}`
      : createRequireImport.source;
  return {
    source: withReader,
    assetLookupReplacements: assetLookup.replacements,
    createRequireImportReplacements: createRequireImport.replacements,
  };
}

function skipQuoted(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === quote) {
      return index;
    }
  }
  throw new Error("Unterminated string literal while hardening Kordoc.");
}

function skipTemplate(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
    } else if (source[index] === "`") {
      return index;
    } else if (source[index] === "$" && source[index + 1] === "{") {
      index = findMatchingBrace(source, index + 1);
    }
  }
  throw new Error("Unterminated template literal while hardening Kordoc.");
}

/** Index of the `}` that closes the `{` at openIndex (strings and comments skipped). */
export function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'") {
      index = skipQuoted(source, index, char);
    } else if (char === "`") {
      index = skipTemplate(source, index);
    } else if (char === "/" && source[index + 1] === "/") {
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
    } else if (char === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unbalanced braces while hardening Kordoc.");
}

/** Removes every whole-line `if (… isComFallbackAvailable() && options?.filePath) { … }` statement. */
export function removeKordocComBranches(source) {
  let output = "";
  let cursor = 0;
  let replacements = 0;
  for (const match of source.matchAll(KORDOC_COM_BRANCH_GUARD)) {
    const guardIndex = match.index ?? 0;
    if (guardIndex < cursor) {
      continue;
    }
    const statementStart = source.lastIndexOf("if (", guardIndex);
    const lineStart = source.lastIndexOf("\n", statementStart) + 1;
    if (statementStart < 0 || source.slice(lineStart, statementStart).trim() !== "") {
      throw new Error("Kordoc COM branch is not a standalone if statement.");
    }
    const closeBrace = findMatchingBrace(source, guardIndex + match[0].length - 1);
    const lineEnd = source.indexOf("\n", closeBrace);
    if (source.slice(closeBrace + 1, lineEnd === -1 ? source.length : lineEnd).trim() !== "") {
      throw new Error("Kordoc COM branch shares its closing line with other code.");
    }
    output += source.slice(cursor, lineStart);
    cursor = lineEnd === -1 ? source.length : lineEnd + 1;
    replacements += 1;
  }
  output += source.slice(cursor);
  return { source: output, replacements };
}

/**
 * Kordoc's Windows COM fallback accepts a filesystem path and starts
 * PowerShell. HanMark only passes document bytes to parse(), so the fallback
 * is unreachable. Strip every call site and the helper implementation before
 * bundling; KORDOC_HARDENING_MANIFEST counts stop the build if Kordoc changes.
 */
export function hardenKordocComFallbackSource(source) {
  const hasComFallbackMarker = source.includes(
    "// src/hwpx/com-fallback.ts",
  );
  const hasComImport = source.includes(
    'import { execFileSync } from "child_process";',
  );
  if (hasComFallbackMarker && !hasComImport) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} COM hardening encountered an unsupported module format.`,
    );
  }
  const expectedHelpers = hasComImport ? KORDOC_HARDENING_MANIFEST.comHelpers : 0;
  const expectedBranches = hasComImport ? KORDOC_HARDENING_MANIFEST.comBranches : 0;
  const branches = removeKordocComBranches(source);
  const helpers = replaceWithCount(
    branches.source,
    KORDOC_COM_HELPERS,
    `function isEncryptedHwpx(manifestXml) {
  return manifestXml.includes("encryption-data");
}
`,
  );
  const counts = {
    helperReplacements: helpers.replacements,
    comBranchReplacements: branches.replacements,
  };
  if (
    counts.helperReplacements !== expectedHelpers ||
    counts.comBranchReplacements !== expectedBranches
  ) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} COM hardening mismatch: expected ${expectedHelpers} helper module and ${expectedBranches} branches, got ${JSON.stringify(counts)}`,
    );
  }
  const residual =
    helpers.source.match(
      /\b(?:execFileSync|isComFallbackAvailable|extractTextViaCom|comResultToParseResult)\b|["'](?:node:)?child_process["']|HWPFrame\.HwpObject/u,
    )?.[0] ?? null;
  if (hasComImport && residual) {
    throw new Error(
      `Kordoc COM fallback remained after source hardening: ${residual}`,
    );
  }
  return {
    source: helpers.source,
    ...counts,
  };
}

/**
 * The setImmediate polyfill accepts string callbacks for very old browser
 * compatibility. HanMark only accepts functions. Its obsolete IE ready-state
 * scheduler is replaced with the equivalent timer fallback, so no script node
 * is created even if that branch is selected.
 */
export function hardenSetImmediateSource(source) {
  const callback = replaceWithCount(
    source,
    SET_IMMEDIATE_STRING_CALLBACK,
    'throw new TypeError("setImmediate callback must be a function");',
  );
  const readyState = replaceWithCount(
    callback.source,
    SET_IMMEDIATE_READY_STATE,
    `    function installReadyStateChangeImplementation() {
        registerImmediate = function(handle) {
            setTimeout(runIfPresent, 0, handle);
        };
    }`,
  );
  const readyStateProbe = replaceWithCount(
    readyState.source,
    SET_IMMEDIATE_READY_STATE_PROBE,
    "false",
  );
  const immediateReadyState = replaceWithCount(
    readyStateProbe.source,
    IMMEDIATE_READY_STATE_BRANCH,
    "  } else {",
  );
  return {
    source: immediateReadyState.source,
    callbackReplacements: callback.replacements,
    readyStateReplacements: readyState.replacements,
    readyStateProbeReplacements: readyStateProbe.replacements,
    immediateReadyStateReplacements: immediateReadyState.replacements,
  };
}

/**
 * docx-preview 0.4.0 supports HTML altChunks by assigning package-controlled
 * HTML to iframe.srcdoc. HanMark's DOCX preview does not need altChunks, so the
 * pinned source is made text/DOM-only before bundling. Exact replacement
 * counts intentionally fail the build when the upstream source shape changes.
 */
export function hardenDocxPreviewSource(source) {
  const nbsp = replaceWithCount(
    source,
    DOCX_PREVIEW_NBSP_HTML,
    (_match, indent) => `${indent}elem.textContent = "\u00a0";`,
  );
  const altChunk = replaceWithCount(
    nbsp.source,
    DOCX_PREVIEW_ALT_CHUNK,
    (_match, indent) =>
      `${indent}renderAltChunk() {\n${indent}    return null;\n${indent}}`,
  );
  const altChunkDefault = replaceWithCount(
    altChunk.source,
    DOCX_PREVIEW_ALT_CHUNK_DEFAULT,
    (_match, indent) => `${indent}renderAltChunks: false,`,
  );
  const styleClear = replaceWithCount(
    altChunkDefault.source,
    DOCX_PREVIEW_STYLE_CLEAR,
    (_match, indent) => `${indent}styleContainer.replaceChildren();`,
  );
  const bodyClear = replaceWithCount(
    styleClear.source,
    DOCX_PREVIEW_BODY_CLEAR,
    (_match, indent) => `${indent}bodyContainer.replaceChildren();`,
  );
  const counts = {
    nbspReplacements: nbsp.replacements,
    altChunkReplacements: altChunk.replacements,
    altChunkDefaultReplacements: altChunkDefault.replacements,
    styleClearReplacements: styleClear.replacements,
    bodyClearReplacements: bodyClear.replacements,
  };
  if (Object.values(counts).some((count) => count !== 1)) {
    throw new Error(
      `docx-preview 0.4.0 hardening mismatch: expected one of each transform, got ${JSON.stringify(counts)}`,
    );
  }
  const residual =
    bodyClear.source.match(
      /\.innerHTML\b|\.srcdoc\b|renderAltChunks\s*:\s*true/u,
    )?.[0] ?? null;
  if (residual) {
    throw new Error(
      `Unsafe docx-preview HTML rendering remained after source hardening: ${residual}`,
    );
  }
  return {
    source: bodyClear.source,
    ...counts,
  };
}

/**
 * PDF.js can compile PostScript PDF functions through Function(). Disabling
 * the capability probe and removing that compiler branch makes it use the
 * built-in PostScriptEvaluator immediately. PDF parsing remains available.
 */
export function hardenPdfJsSource(source) {
  const clipboardDataPathReplacements =
    source.match(PDF_CLIPBOARD_DATA_PATH)?.length ?? 0;
  const clipboardListeners = replaceWithCount(
    source,
    PDF_CLIPBOARD_EVENT_LISTENER,
    "",
  );
  const annotationCopy = replaceWithCount(
    clipboardListeners.source,
    PDF_ANNOTATION_COPY_METHOD,
    `  copy() {
  }
`,
  );
  const annotationCut = replaceWithCount(
    annotationCopy.source,
    PDF_ANNOTATION_CUT_METHOD,
    `  cut() {
  }
`,
  );
  const annotationPaste = replaceWithCount(
    annotationCut.source,
    PDF_ANNOTATION_PASTE_METHOD,
    `  async paste() {
  }
`,
  );
  const freeTextPaste = replaceWithCount(
    annotationPaste.source,
    PDF_FREETEXT_PASTE_METHOD,
    `  editorDivPaste() {
  }
`,
  );
  const evalProbe = replaceWithCount(
    freeTextPaste.source,
    PDF_EVAL_PROBE,
    "function isEvalSupported() { return false; }",
  );
  const postScript = replaceWithCount(
    evalProbe.source,
    PDF_POSTSCRIPT_COMPILER,
    "",
  );
  const dynamicRequire = replaceWithCount(
    postScript.source,
    new RegExp(
      PDF_DYNAMIC_REQUIRE_FALLBACK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g",
    ),
    "__hanmarkRequireBuiltin(name)",
  );
  const globalThis = replaceWithCount(
    dynamicRequire.source,
    new RegExp(
      PDF_GLOBAL_THIS_FALLBACK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g",
    ),
    "undefined",
  );
  const nodeFileSystem = replaceWithCount(
    globalThis.source,
    PDF_NODE_FS_ACCESS,
    "__hanmarkBlockedFileSystem",
  );
  const nodeCanvasBootstrap = replaceWithCount(
    nodeFileSystem.source,
    PDF_NODE_CANVAS_BOOTSTRAP,
    "async function node_utils_fetchData",
  );
  const nodeCanvasFactory = replaceWithCount(
    nodeCanvasBootstrap.source,
    PDF_NODE_CANVAS_FACTORY,
    `class NodeCanvasFactory extends BaseCanvasFactory {
  _createCanvas(width, height) {
    const canvas = globalThis.document?.createElement("canvas");
    if (!canvas) {
      throw new Error("Browser canvas rendering is unavailable.");
    }
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
}`,
  );
  const workerCdnWrapper = replaceWithCount(
    nodeCanvasFactory.source,
    PDF_WORKER_CDN_WRAPPER,
    `this._createCDNWrapper = () => {
      throw new Error("External PDF workers are disabled in HanMark.");
    };`,
  );
  const fakeWorkerDynamicImport = replaceWithCount(
    workerCdnWrapper.source,
    PDF_FAKE_WORKER_DYNAMIC_IMPORT,
    '      throw new Error("The bundled PDF worker is unavailable.");',
  );
  const atob = replaceWithCount(
    fakeWorkerDynamicImport.source,
    BARE_ATOB_CALL,
    "__hanmarkDecodeBase64(",
  );
  const btoa = replaceWithCount(
    atob.source,
    BARE_BTOA_CALL,
    "__hanmarkEncodeBase64(",
  );
  return {
    source: btoa.source,
    evalProbeReplacements: evalProbe.replacements,
    postScriptReplacements: postScript.replacements,
    dynamicRequireReplacements: dynamicRequire.replacements,
    globalThisFallbackReplacements: globalThis.replacements,
    nodeFileSystemReplacements: nodeFileSystem.replacements,
    nodeCanvasBootstrapReplacements: nodeCanvasBootstrap.replacements,
    nodeCanvasFactoryReplacements: nodeCanvasFactory.replacements,
    workerCdnWrapperReplacements: workerCdnWrapper.replacements,
    fakeWorkerDynamicImportReplacements: fakeWorkerDynamicImport.replacements,
    atobReplacements: atob.replacements,
    btoaReplacements: btoa.replacements,
    clipboardDataPathReplacements,
    clipboardListenerReplacements: clipboardListeners.replacements,
    clipboardCopyMethodReplacements: annotationCopy.replacements,
    clipboardCutMethodReplacements: annotationCut.replacements,
    clipboardPasteMethodReplacements: annotationPaste.replacements,
    clipboardFreeTextPasteMethodReplacements: freeTextPaste.replacements,
  };
}

export function assertPdfJsClipboardHardening(path, transformed) {
  const expected = /\.worker\.mjs$/u.test(path) ? 0 : 4;
  const counts = {
    clipboardDataPathReplacements:
      transformed.clipboardDataPathReplacements,
    clipboardListenerReplacements:
      transformed.clipboardListenerReplacements,
    clipboardCopyMethodReplacements:
      transformed.clipboardCopyMethodReplacements,
    clipboardCutMethodReplacements:
      transformed.clipboardCutMethodReplacements,
    clipboardPasteMethodReplacements:
      transformed.clipboardPasteMethodReplacements,
    clipboardFreeTextPasteMethodReplacements:
      transformed.clipboardFreeTextPasteMethodReplacements,
  };
  const expectedCounts = {
    clipboardDataPathReplacements: expected,
    clipboardListenerReplacements: expected,
    clipboardCopyMethodReplacements: expected === 0 ? 0 : 1,
    clipboardCutMethodReplacements: expected === 0 ? 0 : 1,
    clipboardPasteMethodReplacements: expected === 0 ? 0 : 1,
    clipboardFreeTextPasteMethodReplacements: expected === 0 ? 0 : 1,
  };
  if (
    Object.entries(counts).some(
      ([key, count]) => count !== expectedCounts[key],
    )
  ) {
    throw new Error(
      `PDF.js 4.10.38 clipboard hardening mismatch in ${path}: expected ${JSON.stringify(expectedCounts)}, got ${JSON.stringify(counts)}`,
    );
  }
  if (
    /\bclipboardData\b|\.addEventListener\(\s*["'](?:copy|cut|paste)["']/u.test(
      transformed.source,
    )
  ) {
    throw new Error(
      `PDF.js annotation-editor clipboard access remained in ${path}.`,
    );
  }
}

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
  ["bare atob", /(?<![\w$.])atob\s*\(/u],
  ["bare btoa", /(?<![\w$.])btoa\s*\(/u],
  [
    "dynamic script element",
    /\bcreateElement\s*\(\s*["']script["']\s*\)/u,
  ],
  ["HTML string insertion", /\.innerHTML\b|\.srcdoc\b/u],
  ["DOCX altChunk rendering", /renderAltChunks\s*:\s*true/u],
];

export function findUnsafeRuntimeConstructs(source) {
  return unsafeRuntimePatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([name]) => name);
}

function assertDependencyTransform(path, source) {
  const findings = findUnsafeRuntimeConstructs(source);
  if (findings.length > 0) {
    throw new Error(
      `Dependency hardening did not remove ${findings.join(", ")} from ${path}`,
    );
  }
}

export function emptyKordocHardeningTally() {
  return {
    loadedFiles: 0,
    cfbLoaders: 0,
    comHelpers: 0,
    comBranches: 0,
    pdfAssetLookups: 0,
  };
}

/** Compares one build's Kordoc transform totals with the reviewed manifest. */
export function assertKordocHardeningTally(tally) {
  if (tally.loadedFiles === 0) {
    return;
  }
  const expected = {
    cfbLoaders: KORDOC_HARDENING_MANIFEST.cfbLoaders,
    comHelpers: KORDOC_HARDENING_MANIFEST.comHelpers,
    comBranches: KORDOC_HARDENING_MANIFEST.comBranches,
    pdfAssetLookups: KORDOC_HARDENING_MANIFEST.pdfAssetLookups,
  };
  const actual = {
    cfbLoaders: tally.cfbLoaders,
    comHelpers: tally.comHelpers,
    comBranches: tally.comBranches,
    pdfAssetLookups: tally.pdfAssetLookups,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Kordoc ${KORDOC_HARDENING_MANIFEST.version} hardening totals differ from the manifest: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export const kordocSourceHardeningPlugin = {
  name: "kordoc-source-hardening",
  setup(build) {
    let tally = emptyKordocHardeningTally();
    build.onStart(async () => {
      tally = emptyKordocHardeningTally();
      assertKordocManifestVersion(await installedKordocVersion());
    });
    build.onLoad(
      { filter: /kordoc[\\/]dist[\\/].*\.(?:c?js|mjs)$/ },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const cfb = injectKordocCfb(original);
        const optionalNative = hardenKordocOptionalNativeSource(cfb.source);
        const pdfParser = hardenKordocPdfParserSource(optionalNative.source);
        const comFallback = hardenKordocComFallbackSource(pdfParser.source);
        tally.loadedFiles += 1;
        tally.cfbLoaders += cfb.replacements;
        tally.comHelpers += comFallback.helperReplacements;
        tally.comBranches += comFallback.comBranchReplacements;
        tally.pdfAssetLookups += pdfParser.assetLookupReplacements;
        return {
          contents: comFallback.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        assertKordocHardeningTally(tally);
      }
    });
  },
};

export const dependencySourceHardeningPlugin = {
  name: "dependency-source-hardening",
  setup(build) {
    build.onLoad(
      {
        filter:
          /(?:setimmediate[\\/]setImmediate|jszip[\\/]dist[\\/]jszip|immediate[\\/]lib[\\/](?:index|browser))\.js$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenSetImmediateSource(original);
        assertDependencyTransform(args.path, transformed.source);
        return {
          contents: transformed.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );

    build.onLoad(
      {
        filter:
          /docx-preview[\\/]dist[\\/]docx-preview\.(?:mjs|js)$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenDocxPreviewSource(original);
        assertDependencyTransform(args.path, transformed.source);
        return {
          contents: transformed.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );

    build.onLoad(
      {
        filter:
          /pdfjs-dist[\\/]legacy[\\/]build[\\/]pdf(?:\.worker)?\.mjs$/,
      },
      async (args) => {
        const original = await fsp.readFile(args.path, "utf8");
        const transformed = hardenPdfJsSource(original);
        assertPdfJsClipboardHardening(args.path, transformed);
        assertDependencyTransform(args.path, transformed.source);
        return {
          contents: transformed.source,
          loader: "js",
          resolveDir: nodePath.dirname(args.path),
        };
      },
    );
  },
};

export const blockedFileSystemPlugin = {
  name: "block-unneeded-node-filesystem",
  setup(build) {
    build.onResolve(
      { filter: /^(?:node:)?fs(?:\/promises)?$/ },
      (args) => ({
        path: args.path,
        namespace: "hanmark-blocked-filesystem",
      }),
    );
    build.onLoad(
      { filter: /.*/, namespace: "hanmark-blocked-filesystem" },
      () => ({
        loader: "js",
        contents: `
const blocked = () => { throw new Error("This optional filesystem feature is not available in HanMark."); };
const blockedAsync = async () => blocked();
export const readFile = blockedAsync;
export const writeFile = blockedAsync;
export const mkdir = blockedAsync;
export const stat = blockedAsync;
export const unlink = blockedAsync;
export const rename = blockedAsync;
export const realpath = blockedAsync;
export const readFileSync = blocked;
export const writeFileSync = blocked;
export const mkdirSync = blocked;
export const statSync = blocked;
export const realpathSync = blocked;
export const openSync = blocked;
export const readSync = blocked;
export const closeSync = blocked;
export const createReadStream = blocked;
export const createWriteStream = blocked;
export const watch = blocked;
export const existsSync = () => false;
export const promises = { readFile, writeFile, mkdir, stat, unlink, rename, realpath };
export default {
  readFile, writeFile, mkdir, stat, unlink, rename, realpath,
  readFileSync, writeFileSync, mkdirSync, statSync, realpathSync,
  openSync, readSync, closeSync, createReadStream, createWriteStream,
  watch, existsSync, promises
};
`,
      }),
    );
  },
};

const verifyBundledCodePlugin = {
  name: "verify-bundled-code",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }
      const code = await fsp.readFile(outputFile, "utf8");
      const findings = findUnsafeRuntimeConstructs(code);
      if (findings.length > 0) {
        throw new Error(
          `Unsafe runtime constructs remain in ${outputFile}: ${findings.join(", ")}`,
        );
      }
    });
  },
};

export const options = {
  banner: {
    // Kordoc calls createRequire(import.meta.url), so the CJS bundle supplies a
    // real file URL. PDF.js base64 helpers replace browser globals with Buffer.
    js:
      "/* THIS IS A GENERATED/BUNDLED FILE BY ESBUILD */\n" +
      "const __hwpImportMetaUrl = require('url').pathToFileURL(__filename).href;\n" +
      "const __hanmarkRequireBuiltin = (name) => require(name);\n" +
      "const __hanmarkBlockedFileSystem = { promises: { readFile: async () => { throw new Error('Filesystem PDF loading is disabled; HanMark supplies PDF bytes directly.'); } } };\n" +
      "const __hanmarkDecodeBase64 = (value) => Buffer.from(value, 'base64').toString('latin1');\n" +
      "const __hanmarkEncodeBase64 = (value) => Buffer.from(value, 'latin1').toString('base64');",
  },
  define: {
    "import.meta.url": "__hwpImportMetaUrl",
  },
  plugins: [
    blockedFileSystemPlugin,
    kordocSourceHardeningPlugin,
    dependencySourceHardeningPlugin,
    verifyBundledCodePlugin,
  ],
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: outputFile,
  platform: "node",
  minify: prod,
  // Obsidian reads main.js as UTF-8. The default ASCII charset spells every Hangul
  // character as a six-byte \uXXXX escape; UTF-8 keeps it at three bytes (R-018:
  // 117 KB smaller at 2.7.0 M5 with identical behavior).
  charset: "utf8",
};

async function runBuild() {
  if (prod) {
    await esbuild.build(options);
    console.log(`Production build complete: ${outputFile}`);
    return;
  }
  const context = await esbuild.context(options);
  await context.watch();
  console.log("Watching for changes...");
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  nodePath.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
