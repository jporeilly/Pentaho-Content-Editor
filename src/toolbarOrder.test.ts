import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";

// How the insert menus are grouped and ordered.
//
// Registry order IS menu order, so a block added in the wrong place ends
// up in the right menu at the wrong position - or, worse, splits its
// group in two. Both happened: "PDF" was declared after the entire Block
// group, so it arrived last in the Media menu behind three
// image-alignment variants, and the Heading menu ran H2, H3, then H1.
// Nothing failed, nothing looked broken, and every author who opened
// those menus paid a small tax reading them.

const labels = (group: string) =>
  BLOCKS.filter((b) => b.group === group).map((b) => b.label);

describe("menu groups are contiguous", () => {
  it("declares each group in one run", () => {
    // The structural rule, and the one that catches the next stray: a
    // group declared in two places is a menu whose order nobody chose.
    const groups = BLOCKS.map((b) => b.group);
    const runs = groups.filter((g, i) => g !== groups[i - 1]);
    const split = runs.filter((g, i) => runs.indexOf(g) !== i);
    expect(split, `these groups are declared in more than one run: ${split.join(", ")}`).toEqual([]);
  });
});

describe("headings run largest to smallest", () => {
  it("offers H1, H2, H3, then the untracked pair in the same order", () => {
    expect(labels("Heading")).toEqual([
      "Title (H1, mid-guide)",
      "Step (H2)",
      "Sub-step (H3)",
      "Section (H2, untracked)",
      "Sub-section (H3, untracked)",
    ]);
  });

  it("holds no toggle — this menu inserts", () => {
    // Turning tracking on or off for a heading already written lives
    // under the lab-action bar's Tracking menu, beside the lab-level
    // control that answers the same question one scope up.
    expect(labels("Heading").some((l) => /tracking/i.test(l))).toBe(false);
  });
});

describe("media is ordered by kind", () => {
  it("runs images, then videos, then the PDF", () => {
    expect(labels("Media")).toEqual([
      "Image",
      "Image — centred",
      "Image — float left",
      "Image — float right",
      "Video",
      "Video — with caption",
      "PDF",
    ]);
  });
});

describe("alignment reads left to right wherever it appears", () => {
  it("in the Text menu", () => {
    const aligners = labels("Text").filter((l) => /aligned|Centred/.test(l));
    expect(aligners).toEqual(["Left-aligned", "Centred", "Right-aligned"]);
  });

  it("and in the Media menu's floats", () => {
    const floats = labels("Media").filter((l) => /centred|float/.test(l));
    expect(floats).toEqual(["Image — centred", "Image — float left", "Image — float right"]);
  });
});
