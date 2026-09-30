import {
  resolveOutputLocale,
  t,
  tOut,
  type LanguagePreference,
  type Locale
} from "../i18n";
import {
  resolveMarkdownImages,
  type ImageFailure,
  type ImageLoader,
  type ImageProgress,
  type ImageReference,
  type ResolvedImageAsset
} from "./imageAssets";
import { transformMarkdownImageTokens } from "./markdownImageTokens";

export const HTML_EXPORT_IMAGE_LIMITS = Object.freeze({
  maxImages: 100,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  concurrency: 4
});

export interface HtmlExportImageOptions {
  loader: ImageLoader;
  onProgress?: (progress: ImageProgress) => void;
  /**
   * Language of labels written into the document (missing-image placeholders,
   * default alt text). "auto" (default) reads the note itself.
   */
  outputLanguage?: LanguagePreference;
}

export interface HtmlExportImageResult {
  markdown: string;
  references: ImageReference[];
  failures: ImageFailure[];
  embeddedCount: number;
  embeddedOccurrences: number;
}

const DATA_URI_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp"]);
const FENCE = /^\s*(`{3,}|~{3,})/;
const RASTER_OBSIDIAN_EMBED = /\.(?:png|jpe?g|gif|bmp)(?:[?#].*)?$/i;

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

function toDataUri(asset: ResolvedImageAsset): string {
  if (!DATA_URI_MIME_TYPES.has(asset.mimeType)) {
    throw new Error(t("exportFlow.html.unsupportedImageType", { type: asset.mimeType }));
  }
  return `data:${asset.mimeType};base64,${encodeBase64(asset.data)}`;
}

function asDataUriAsset(asset: ResolvedImageAsset): ResolvedImageAsset {
  return {
    ...asset,
    safeName: toDataUri(asset)
  };
}

interface HtmlImageToken {
  source: string;
  alt: string;
  raw: string;
}

function cleanLabel(value: string, fallback: string): string {
  return (value || fallback)
    .replace(/\[|\]/g, " ")
    .replace(/[\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function fallbackLabel(source: string, locale: Locale): string {
  const withoutQuery = source.split(/[?#]/, 1)[0];
  return withoutQuery.split(/[\\/]/).pop() || tOut(locale, "image.output.defaultAlt");
}

function missingLabel(token: Pick<HtmlImageToken, "source" | "alt">, locale: Locale): string {
  return tOut(locale, "image.output.missing", {
    name: cleanLabel(token.alt, fallbackLabel(token.source, locale))
  });
}

function transformOutsideFences(markdown: string, transform: (line: string) => string): string {
  const output: string[] = [];
  let fenceMarker = "";
  for (const originalLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = originalLine.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0];
      else if (fence[0] === fenceMarker) fenceMarker = "";
      output.push(originalLine);
      continue;
    }
    output.push(fenceMarker ? originalLine : transform(originalLine));
  }
  return output.join("\n");
}

/**
 * Converts only Obsidian raster embeds into standard Markdown image tokens.
 * Note, canvas, PDF, SVG, and other embed types remain unchanged. `locale` names an
 * image without a file name; without one, the document itself decides ("auto").
 */
export function normalizeObsidianRasterImageEmbeds(
  markdown: string,
  locale: Locale = resolveOutputLocale("auto", markdown)
): string {
  return transformOutsideFences(markdown, (line) =>
    line.replace(/!\[\[([^\]\r\n]+)\]\]/g, (raw, body: string) => {
      const separator = body.indexOf("|");
      const source = (separator >= 0 ? body.slice(0, separator) : body).trim();
      if (!source || !RASTER_OBSIDIAN_EMBED.test(source)) return raw;
      const requestedAlt = separator >= 0 ? body.slice(separator + 1).trim() : "";
      const alt = /^\d+(?:x\d+)?$/i.test(requestedAlt)
        ? fallbackLabel(source, locale)
        : cleanLabel(requestedAlt, fallbackLabel(source, locale));
      return `![${alt}](<${source.replace(/[<>]/g, "")}>)`;
    })
  );
}

function rewriteImageTokens(
  markdown: string,
  assets: ResolvedImageAsset[],
  knownFailures: Map<string, ImageFailure>,
  locale: Locale
): { markdown: string; defensiveFailures: ImageFailure[] } {
  const bySource = new Map(assets.map((asset) => [asset.source, asset]));
  const defensiveFailures: ImageFailure[] = [];
  const rewritten = transformOutsideFences(markdown, (line) => {
    const replace = (token: HtmlImageToken): string => {
      const asset = bySource.get(token.source);
      if (asset) {
        return `![${cleanLabel(token.alt, fallbackLabel(token.source, locale))}](${asset.safeName})`;
      }
      if (!knownFailures.has(token.source)) {
        const failure: ImageFailure = {
          source: token.source,
          alt: token.alt,
          occurrences: 1,
          stage: "resolve",
          message: t("exportFlow.html.imageNotConverted")
        };
        defensiveFailures.push(failure);
        knownFailures.set(token.source, failure);
      }
      return missingLabel(token, locale);
    };

    let output = transformMarkdownImageTokens(
      line,
      ({ raw, alt, source }) => replace({ raw, alt, source })
    );
    output = output.replace(/<img\b[^>]*>/gi, (raw) => {
      const source = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1];
      if (!source) return raw;
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(raw)?.[1] || fallbackLabel(source, locale);
      return replace({ raw, alt, source });
    });
    return output;
  });
  return { markdown: rewritten, defensiveFailures };
}

/**
 * Resolves every active Markdown/HTML image reference and prepares Markdown for
 * a script-free, self-contained HTML export.
 *
 * Callers can discard the result to cancel, invoke this function again to
 * retry, or explicitly continue with `markdown`. Continuing never preserves a
 * failed external image reference: each failure is replaced by a visible
 * missing-image label in the document's language (`[이미지 누락: ...]` in Korean).
 */
export async function prepareSelfContainedHtmlMarkdown(
  markdown: string,
  options: HtmlExportImageOptions
): Promise<HtmlExportImageResult> {
  const locale = resolveOutputLocale(options.outputLanguage, markdown);
  const normalizedMarkdown = normalizeObsidianRasterImageEmbeds(markdown, locale);
  const resolution = await resolveMarkdownImages(normalizedMarkdown, {
    loader: options.loader,
    onProgress: options.onProgress,
    ...HTML_EXPORT_IMAGE_LIMITS
  });
  const dataUriAssets = resolution.assets.map(asDataUriAsset);
  const knownFailures = new Map(resolution.failures.map((failure) => [failure.source, failure]));
  const rewritten = rewriteImageTokens(normalizedMarkdown, dataUriAssets, knownFailures, locale);

  return {
    markdown: rewritten.markdown,
    references: resolution.references,
    failures: [...resolution.failures, ...rewritten.defensiveFailures],
    embeddedCount: resolution.assets.length,
    embeddedOccurrences: resolution.assets.reduce((sum, asset) => sum + asset.occurrences, 0)
  };
}
