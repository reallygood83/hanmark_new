import { tOut, type Locale } from "../i18n";

/**
 * Note assembly (2.7.0 W6): `![[note]]`, `![[note#Heading]]` and `![[note#^block]]`
 * are replaced by the embedded Markdown before any export, so HWPX, DOCX, HTML, PDF
 * and the previews all receive one self-contained document.
 *
 * The module is pure: the caller supplies link resolution and file reading (Obsidian's
 * metadata cache and Vault), which keeps it deterministic and testable.
 */
export interface AssemblyHost {
  /** Resolve a link path as Obsidian would from `sourcePath`; null when missing. */
  resolve(linkpath: string, sourcePath: string): { path: string; extension: string } | null;
  read(path: string): Promise<string>;
}

export type AssemblyIssueCode = "missing" | "cycle" | "depth" | "section";

export interface AssemblyIssue {
  code: AssemblyIssueCode;
  /** The embed as written, e.g. "note#Heading". */
  target: string;
  /** Vault path of the note that contains the embed. */
  source: string;
}

export interface AssemblyResult {
  markdown: string;
  issues: AssemblyIssue[];
  /** Vault paths inlined at least once, in first-seen order. */
  embedded: string[];
}

export interface AssemblyOptions {
  /** Language of placeholders written into the document. */
  locale: Locale;
  /** Maximum nesting depth (default 10). */
  maxDepth?: number;
}

export const DEFAULT_ASSEMBLY_DEPTH = 10;

const FENCE = /^\s*(`{3,}|~{3,})/u;
const EMBED = /!\[\[([^\]]+)\]\]/gu;
const LINE_PREFIX = /^(\s*(?:>\s?)*)/u;
const LIST_MARKER_ONLY = /^\s*(?:[-*+]|\d+[.)])\s*$/u;
const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
const EXTERNAL_SOURCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu;

interface ParsedEmbed {
  raw: string;
  linkpath: string;
  subpath: string;
}

function parseEmbed(inner: string): ParsedEmbed {
  const [target] = inner.split("|", 1);
  const hash = target.indexOf("#");
  return {
    raw: target.trim(),
    linkpath: (hash >= 0 ? target.slice(0, hash) : target).trim(),
    subpath: hash >= 0 ? target.slice(hash + 1).trim() : ""
  };
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function stripFrontmatter(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return lines.join("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "---" || line === "...") return lines.slice(index + 1).join("\n");
  }
  return lines.join("\n");
}

/** Lines outside fenced code, as a boolean mask. */
function codeMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let fence = "";
  for (const line of lines) {
    const marker = FENCE.exec(line)?.[1] ?? "";
    if (marker) {
      mask.push(true);
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = "";
      continue;
    }
    mask.push(Boolean(fence));
  }
  return mask;
}

function extractHeadingSection(lines: readonly string[], subpath: string): string[] | null {
  const wanted = normalizeHeadingText(subpath.split("#").filter(Boolean).pop() ?? "");
  if (!wanted) return null;
  const inCode = codeMask(lines);
  let start = -1;
  let level = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (inCode[index]) continue;
    const heading = ATX_HEADING.exec(lines[index]);
    if (!heading) continue;
    if (start < 0) {
      if (normalizeHeadingText(heading[2]) === wanted) {
        start = index;
        level = heading[1].length;
      }
      continue;
    }
    if (heading[1].length <= level) return lines.slice(start, index);
  }
  return start >= 0 ? lines.slice(start) : null;
}

function extractBlock(lines: readonly string[], id: string): string[] | null {
  const marker = new RegExp(`(^|\\s)\\^${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "u");
  const inCode = codeMask(lines);
  for (let index = 0; index < lines.length; index += 1) {
    if (inCode[index] || !marker.test(lines[index])) continue;
    const stripped = lines[index].replace(marker, "$1").trimEnd();
    if (!stripped.trim()) {
      // "^id" alone on its own line refers to the block right above it.
      let start = index - 1;
      while (start >= 0 && !lines[start].trim()) start -= 1;
      const end = start;
      while (start > 0 && lines[start - 1].trim()) start -= 1;
      return end >= 0 ? lines.slice(start, end + 1) : null;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s/u.test(lines[index])) return [stripped];
    let start = index;
    while (start > 0 && lines[start - 1].trim()) start -= 1;
    return [...lines.slice(start, index), stripped];
  }
  return null;
}

function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function joinVaultPath(folder: string, relative: string): string {
  const parts = folder ? folder.split("/") : [];
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function decodeLinkDestination(value: string): string {
  const trimmed = value.trim().replace(/^<|>$/gu, "");
  try {
    return decodeURI(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Rewrites image references of an embedded note to Vault paths, so exporters that
 * resolve images from the root note still find them.
 */
function rewriteImageSources(markdown: string, notePath: string, host: AssemblyHost): string {
  const lines = markdown.split("\n");
  const inCode = codeMask(lines);
  return lines
    .map((line, index) => {
      if (inCode[index]) return line;
      let next = line.replace(EMBED, (whole: string, inner: string) => {
        const [target, ...rest] = inner.split("|");
        const hash = target.indexOf("#");
        const linkpath = (hash >= 0 ? target.slice(0, hash) : target).trim();
        const resolved = linkpath ? host.resolve(linkpath, notePath) : null;
        if (!resolved || resolved.extension === "md") return whole;
        const suffix = hash >= 0 ? target.slice(hash) : "";
        return `![[${[`${resolved.path}${suffix}`, ...rest].join("|")}]]`;
      });
      next = next.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (whole: string, alt: string, destination: string) => {
        const source = destination.trim().split(/\s+"/u, 1)[0];
        if (EXTERNAL_SOURCE.test(source) || source.startsWith("/")) return whole;
        const decoded = decodeLinkDestination(source);
        const resolved =
          host.resolve(joinVaultPath(parentFolder(notePath), decoded), notePath) ??
          host.resolve(decoded, notePath);
        return resolved ? `![${alt}](<${resolved.path}>)` : whole;
      });
      return next;
    })
    .join("\n");
}

/** [start, end) ranges of `inline code` on one line; embeds inside them stay literal. */
function inlineCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const pattern = /(`+)[\s\S]*?\1/gu;
  for (const match of line.matchAll(pattern)) {
    const start = match.index ?? 0;
    spans.push([start, start + match[0].length]);
  }
  return spans;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

interface AssemblyState {
  host: AssemblyHost;
  options: Required<AssemblyOptions>;
  issues: AssemblyIssue[];
  embedded: string[];
  cache: Map<string, string>;
}

async function readCached(state: AssemblyState, path: string): Promise<string> {
  const cached = state.cache.get(path);
  if (cached !== undefined) return cached;
  const text = stripFrontmatter(await state.host.read(path));
  state.cache.set(path, text);
  return text;
}

function placeholder(state: AssemblyState, code: AssemblyIssueCode, target: string, source: string): string {
  state.issues.push({ code, target, source });
  const name = target || source;
  switch (code) {
    case "missing":
      return tOut(state.options.locale, "output.embedMissing", { name });
    case "cycle":
      return tOut(state.options.locale, "output.embedCycle", { name });
    case "depth":
      return tOut(state.options.locale, "output.embedTooDeep", { name });
    default:
      return tOut(state.options.locale, "output.embedSectionMissing", { name });
  }
}

async function embedContent(
  state: AssemblyState,
  embed: ParsedEmbed,
  sourcePath: string,
  stack: readonly string[]
): Promise<string[]> {
  const resolved = embed.linkpath
    ? state.host.resolve(embed.linkpath, sourcePath)
    : { path: sourcePath, extension: "md" };
  if (!resolved) return [placeholder(state, "missing", embed.raw, sourcePath)];
  const key = `${resolved.path}#${embed.subpath}`;
  if (stack.includes(key) || (!embed.subpath && stack.some((entry) => entry.startsWith(`${resolved.path}#`)))) {
    return [placeholder(state, "cycle", embed.raw, sourcePath)];
  }
  if (stack.length > state.options.maxDepth) return [placeholder(state, "depth", embed.raw, sourcePath)];

  const lines = (await readCached(state, resolved.path)).split("\n");
  let selected: string[] | null = lines;
  if (embed.subpath.startsWith("^")) selected = extractBlock(lines, embed.subpath.slice(1));
  else if (embed.subpath) selected = extractHeadingSection(lines, embed.subpath);
  if (!selected) return [placeholder(state, "section", embed.raw, sourcePath)];

  if (!state.embedded.includes(resolved.path)) state.embedded.push(resolved.path);
  const nested = await assembleLines(state, selected, resolved.path, [...stack, key]);
  const rewritten = rewriteImageSources(nested.join("\n"), resolved.path, state.host);
  return trimBlankLines(rewritten.split("\n"));
}

async function assembleLines(
  state: AssemblyState,
  lines: readonly string[],
  sourcePath: string,
  stack: readonly string[]
): Promise<string[]> {
  const inCode = codeMask(lines);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (inCode[index] || !line.includes("![[")) {
      output.push(line);
      continue;
    }
    const codeSpans = inlineCodeSpans(line);
    const matches = [...line.matchAll(EMBED)]
      .filter((match) => !codeSpans.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end))
      .map((match) => ({ match, embed: parseEmbed(match[1]) }))
      .filter(({ embed }) => {
        if (!embed.linkpath) return true;
        const resolved = state.host.resolve(embed.linkpath, sourcePath);
        return resolved ? resolved.extension === "md" : !/\.[a-z0-9]{1,5}$/iu.test(embed.linkpath) || /\.md$/iu.test(embed.linkpath);
      });
    if (!matches.length) {
      output.push(line);
      continue;
    }
    const prefix = LINE_PREFIX.exec(line)?.[1] ?? "";
    let cursor = 0;
    const emitText = (text: string): void => {
      const content = text.slice(prefix.length > 0 && text.startsWith(prefix) ? prefix.length : 0);
      if (!content.trim() || LIST_MARKER_ONLY.test(content)) return;
      output.push(`${prefix}${content.trim()}`);
    };
    for (const { match, embed } of matches) {
      const at = match.index ?? 0;
      emitText(line.slice(cursor, at));
      cursor = at + match[0].length;
      const content = await embedContent(state, embed, sourcePath, stack);
      if (output.length && output[output.length - 1].trim() !== prefix.trim()) output.push(prefix.trimEnd());
      for (const embeddedLine of content) {
        output.push(embeddedLine ? `${prefix}${embeddedLine}` : prefix.trimEnd());
      }
      output.push(prefix.trimEnd());
    }
    emitText(line.slice(cursor));
  }
  return output;
}

/** Inline every note embed of `markdown` (the body of `sourcePath`). */
export async function assembleNote(
  host: AssemblyHost,
  markdown: string,
  sourcePath: string,
  options: AssemblyOptions
): Promise<AssemblyResult> {
  const state: AssemblyState = {
    host,
    options: { locale: options.locale, maxDepth: options.maxDepth ?? DEFAULT_ASSEMBLY_DEPTH },
    issues: [],
    embedded: [],
    cache: new Map()
  };
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  if (!markdown.includes("![[")) return { markdown, issues: [], embedded: [] };
  const assembled = await assembleLines(state, lines, sourcePath, [`${sourcePath}#`]);
  return {
    markdown: assembled.join("\n").replace(/\n{3,}/gu, "\n\n"),
    issues: state.issues,
    embedded: state.embedded
  };
}
