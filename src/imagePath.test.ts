import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";

// Selecting a PATH and choosing an image block.
//
// The obvious way to use these blocks was the one that did not work:
// paste the path into the guide, select it, choose Media -> Image. The
// selection went into the ALT slot and the src stayed a placeholder, so
// the author then moved the filename across by hand - the exact
// copy-paste the menu exists to save.

const media = (label: string) => BLOCKS.find((b) => b.group === "Media" && b.label === label)!;
const IMAGE_BLOCKS = ["Image"];

describe("a selected path becomes the image source", () => {
  for (const label of IMAGE_BLOCKS) {
    it(label, () => {
      const out = media(label).build("../_assets/images/1788854678779.png").text;
      expect(out).toContain('src="../_assets/images/1788854678779.png"');
      expect(out).not.toContain("example.png");
      // And it must not ALSO land in the alt slot.
      expect(out).not.toContain('alt="../_assets/images/');
    });
  }

  it("gives the house figure a width when the path has none", () => {
    expect(media("Image").build("shot.png").text).toMatch(/src="shot.png" alt="alt text" width="\d+"/);
  });

  it("turns a size hint the author pasted into the width", () => {
    expect(media("Image").build("shot.png#w=500").text).toContain('src="shot.png" alt="alt text" width="500"');
  });
});

describe("a selected caption is still a caption", () => {
  it("goes in the alt slot, with the placeholder path", () => {
    const out = media("Image").build("The injector canvas").text;
    expect(out).toContain('alt="The injector canvas"');
    expect(out).toContain("example.png");
  });

  it("does not mistake a sentence that mentions a file for a path", () => {
    // Guessing wrong in this direction gives a broken image; guessing
    // wrong the other way gives a slightly odd caption. The test pins
    // the safer failure.
    const out = media("Image").build("open example.png in the viewer").text;
    expect(out).toContain("example.png");
    expect(out).toContain('alt="open example.png in the viewer"');
  });
});

describe("the PDF block does the same for a .pdf", () => {
  it("uses a selected pdf path", () => {
    const pdf = media("PDF");
    expect(pdf.build("files/cheatsheet.pdf").text).toContain("(files/cheatsheet.pdf)");
    expect(pdf.build("Reference sheet").text).toContain("(files/example.pdf)");
  });
});
