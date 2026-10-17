// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { BLOCKS } from "./Toolbar";
import { DEFAULT_FIGURE_WIDTH, houseFigure, pictureWidth } from "./houseFigure";

// The six lines the course checker's S303 accepts (Pentaho-Content-Manager
// scripts/lib/course-standard.mjs) - kept in step by hand.
const HOUSE = /^<div align="center">\n<figure>\n<img src="[^"]+" alt="[^"]*" width="\d+">\n<figcaption>(?!<(?:em|p)>)[^\n]+<\/figcaption>\n<\/figure>\n<\/div>\n\n$/;

/** A PNG header: IHDR with this width, then an optional pHYs at `dpi`. */
function png(width: number, dpi?: number): Uint8Array {
  const b: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => b.push(...be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
  chunk("IHDR", [...be(width), ...be(300), 8, 6, 0, 0, 0]);
  if (dpi) { const ppm = Math.round(dpi / 0.0254); chunk("pHYs", [...be(ppm), ...be(ppm), 1]); }
  chunk("IDAT", [0]);
  return new Uint8Array(b);
}

describe("the house figure (COURSE-STANDARD 6, S303)", () => {
  it("is six lines with the width and a plain caption", () => {
    const f = houseFigure("../_assets/images/gen-rows.png", "The Design tab", 475, "Generate rows in the Input folder");
    expect(f).toMatch(HOUSE);
    expect(f).toContain('<img src="../_assets/images/gen-rows.png" alt="The Design tab" width="475">');
  });

  it("quotes a formula in the alt text exactly: brackets stay, quotes and < become entities", () => {
    const f = houseFigure("x.png", 'Test [QUANTITYINSTOCK]<1000, Then_value "RED"', 421);
    expect(f).toContain('alt="Test [QUANTITYINSTOCK]&lt;1000, Then_value &quot;RED&quot;"');
    const alt = new DOMParser().parseFromString(f, "text/html").querySelector("img")!.getAttribute("alt");
    expect(alt).toBe('Test [QUANTITYINSTOCK]<1000, Then_value "RED"');
  });

  it("is what Media > Image inserts, and the only image entry", () => {
    const images = BLOCKS.filter((b) => b.group === "Media" && /^Image/.test(b.label));
    expect(images.map((b) => b.label)).toEqual(["Image"]);
    expect(images[0].build("").text).toMatch(HOUSE);
    expect(images[0].build("../_assets/images/run.png").text).toContain(`src="../_assets/images/run.png" alt="alt text" width="${DEFAULT_FIGURE_WIDTH}"`);
  });
});

describe("pictureWidth: the size on the screen it was taken on", () => {
  it("a 100% capture is its pixel width", () => {
    expect(pictureWidth(png(420))).toBe(420);
    expect(pictureWidth(png(420, 96))).toBe(420);
  });
  it("a 150% or 200% capture is scaled back", () => {
    expect(pictureWidth(png(630, 144))).toBe(420);
    expect(pictureWidth(png(840, 192))).toBe(420);
  });
  it("never wider than the reading column", () => {
    expect(pictureWidth(png(1920))).toBe(800);
  });
  it("reads GIF and JPEG, and gives up on anything else", () => {
    expect(pictureWidth(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0x10, 0x00, 0, 0]))).toBe(300);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x58, 0x03]);
    expect(pictureWidth(jpeg)).toBe(600);
    expect(pictureWidth(new TextEncoder().encode("<svg/>"))).toBeNull();
  });
});
