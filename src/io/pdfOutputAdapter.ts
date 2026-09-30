import { t } from "../i18n";

/** The only boundary allowed to access the desktop host's PDF byte API. */
export interface PdfOutputAdapter {
  render(view: Window): Promise<Uint8Array>;
}

export interface PreparedPdf {
  format: "pdf";
  status: "ready";
  fileName: string;
  bytes: Uint8Array;
}

interface PdfRemote {
  getCurrentWebContents(): {
    printToPDF(options: Record<string, unknown>): Promise<unknown>;
  };
}

function loadHostPdfBridge(): unknown {
  // A fixed CommonJS host external avoids runtime dynamic imports in the bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Lazy access to this one host capability is isolated to the PDF output adapter.
  const remote: unknown = require("@electron/remote");
  return remote;
}

export function createDesktopPdfOutputAdapter(
  loadRemote: () => unknown = loadHostPdfBridge
): PdfOutputAdapter {
  return {
    async render(view) {
      // Plugins execute in the main renderer. Render there even when the source
      // editor is in a pop-out; never print whichever window happens to focus.
      if (typeof window !== "undefined" && view !== window) {
        throw new Error(t("pdfExport.error.windowMismatch"));
      }
      let remote: unknown;
      try {
        remote = await loadRemote();
      } catch {
        throw new Error(t("pdfExport.error.directUnsupportedPrint"));
      }
      if (!remote || typeof remote !== "object" ||
          !("getCurrentWebContents" in remote) ||
          typeof remote.getCurrentWebContents !== "function") {
        throw new Error(t("pdfExport.error.bridgeUnavailable"));
      }
      const contents = (remote as PdfRemote).getCurrentWebContents();
      if (!contents || typeof contents.printToPDF !== "function") {
        throw new Error(t("pdfExport.error.directUnsupported"));
      }
      const result = await contents.printToPDF({
        pageSize: "A4", printBackground: true, preferCSSPageSize: true,
        scale: 1, displayHeaderFooter: false
      });
      if (!ArrayBuffer.isView(result)) throw new Error(t("pdfExport.error.noData"));
      const bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice();
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error(t("pdfExport.error.notPdf"));
      }
      return bytes;
    }
  };
}
