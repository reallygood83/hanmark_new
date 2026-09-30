import { PDF_CMAP_BASE64 } from "./pdfCMapData";

/** Names of the predefined CMaps HanMark embeds (Korean encodings and Adobe-Korea1). */
export const EMBEDDED_PDF_CMAP_NAMES: readonly string[] = Object.freeze(Object.keys(PDF_CMAP_BASE64));

const decoded = new Map<string, Uint8Array>();

/** Binary (bcmap) bytes of an embedded CMap, or undefined when HanMark does not ship it. */
export function embeddedPdfCMap(name: string): Uint8Array | undefined {
  const cached = decoded.get(name);
  if (cached) return cached;
  const base64 = Object.prototype.hasOwnProperty.call(PDF_CMAP_BASE64, name)
    ? PDF_CMAP_BASE64[name]
    : undefined;
  if (!base64) return undefined;
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  decoded.set(name, bytes);
  return bytes;
}

/**
 * PDF.js CMap reader (the `CMapReaderFactory` getDocument parameter). PDF.js calls
 * `fetch({ name })` and expects binary CMap data. Serving embedded bytes keeps PDF
 * import free of file-system and network access while restoring text in fonts that
 * rely on predefined Korean CMaps (without them PDF.js drops that text entirely).
 */
export class HanmarkPdfCMapReaderFactory {
  constructor(_options?: { baseUrl?: string | null; isCompressed?: boolean }) {}

  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const cMapData = embeddedPdfCMap(name);
    if (!cMapData) {
      throw new Error(`HanMark does not bundle the "${name}" PDF CMap.`);
    }
    return { cMapData, isCompressed: true };
  }
}
