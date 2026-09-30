import { t } from "../i18n";

/**
 * Parses Kordoc SVG and removes anything active: scripts, foreign content, event
 * handlers, external references, and CSS url() values. Only same-document anchors
 * and embedded raster images survive.
 */
export function parseSanitizedSvg(svg: string): XMLDocument {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
    throw new Error(t("preview.quick.invalidSvg"));
  }
  document.querySelectorAll("script, foreignObject, iframe, object, embed, link, meta").forEach((node) => node.remove());
  document.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href" || name === "src") &&
          !value.startsWith("#") && !value.startsWith("data:image/")) {
        node.removeAttribute(attribute.name);
      }
      if (name === "style" && /url\s*\(/i.test(value)) node.removeAttribute(attribute.name);
    }
  });
  return document;
}

export function sanitizeSvg(svg: string): string {
  const document = parseSanitizedSvg(svg);
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function appendSanitizedSvg(container: HTMLElement, svg: string): SVGElement {
  const parsed = parseSanitizedSvg(svg);
  const imported = container.ownerDocument.importNode(parsed.documentElement, true);
  container.appendChild(imported);
  return imported as unknown as SVGElement;
}
