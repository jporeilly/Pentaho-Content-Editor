/**
 * The house figure (COURSE-STANDARD section 6; the course checker's S303):
 * every picture in a course is these six lines, one tag per line.
 *
 *   <div align="center">
 *   <figure>
 *   <img src="../_assets/images/x.png" alt="..." width="475">
 *   <figcaption>Caption</figcaption>
 *   </figure>
 *   </div>
 *
 * All HTML, so there are no blank lines to get wrong: a markdown ![...]
 * straight after <figure> stays inside the HTML block and renders as
 * literal text. Media > Image and the upload / paste / drop path both
 * write it through here.
 */

/** The reading column: the app never shows a picture wider. */
export const MAX_FIGURE_WIDTH = 800;
/** When the picture's own width cannot be read (the toolbar's example). */
export const DEFAULT_FIGURE_WIDTH = 640;

/** Alt text is content - a formula's [FIELD] or "RED" is quoted exactly -
 *  so only what an attribute cannot hold is written as an entity. */
const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function houseFigure(src: string, alt: string, width: number, caption = "Caption"): string {
  return [
    '<div align="center">',
    "<figure>",
    `<img src="${src}" alt="${attr(alt)}" width="${Math.round(width)}">`,
    `<figcaption>${caption}</figcaption>`,
    "</figure>",
    "</div>",
  ].join("\n") + "\n\n";
}

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/**
 * The picture's width on the screen it was taken on, capped at the
 * column: its pixel width, divided by the display scale when a PNG's pHYs
 * says it was captured at 150% or 200% (120-240 dpi). PNG, JPEG and GIF;
 * null for anything else (the caller falls back to DEFAULT_FIGURE_WIDTH).
 */
export function pictureWidth(bytes: Uint8Array): number | null {
  let px: number | null = null;
  let dpi: number | null = null;
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    px = u32(bytes, 16);
    for (let i = 8; i + 8 <= bytes.length;) {
      const len = u32(bytes, i);
      const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (type === "pHYs" && i + 17 <= bytes.length) {
        if (bytes[i + 16] === 1) dpi = Math.round(u32(bytes, i + 8) * 0.0254);
        break;
      }
      if (type === "IDAT") break;
      i += 12 + len;
    }
  } else if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    px = bytes[6] | (bytes[7] << 8);
  } else if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) { px = (bytes[i + 7] << 8) | bytes[i + 8]; break; }
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
  }
  if (!px) return null;
  const onScreen = dpi && dpi >= 120 && dpi <= 240 ? Math.round((px * 96) / dpi) : px;
  return Math.min(onScreen, MAX_FIGURE_WIDTH);
}
