import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";

// The Text group's alignment wrappers. Small enough to look obvious, and
// tested because two things about them are not:
//
//   * the blank lines INSIDE the div are load-bearing. CommonMark stops
//     parsing markdown inside an HTML block without them, so a callout
//     or a link in an aligned paragraph renders as literal source. Every
//     wrapper in this file has them, and a new one copied from the wrong
//     sibling would not.
//   * left is offered even though it is the default, because its job is
//     getting a paragraph back OUT of a centred or right-aligned
//     wrapper. A menu with two of the three is a menu that can only be
//     escaped by editing markup by hand.

describe("the Text group's alignment wrappers", () => {
  const aligners = BLOCKS.filter(
    (b) => b.group === "Text" && /aligned|Centred/.test(b.label),
  );

  it("offers all three directions", () => {
    expect(aligners.map((b) => b.label)).toEqual([
      "Left-aligned",
      "Centred",
      "Right-aligned",
    ]);
  });

  it("writes the align attribute that matches its label", () => {
    const want: Record<string, string> = {
      "Left-aligned": "left",
      Centred: "center",
      "Right-aligned": "right",
    };
    for (const block of aligners) {
      expect(block.build("").text, block.label).toContain(
        `<div align="${want[block.label]}">`,
      );
    }
  });

  it("keeps the blank lines that let markdown survive inside the div", () => {
    for (const block of aligners) {
      const text = block.build("Some **bold** prose.").text;
      expect(text, block.label).toMatch(/<div align="\w+">\n\nSome \*\*bold\*\* prose\.\n\n<\/div>/);
    }
  });

  it("wraps the selection rather than the placeholder", () => {
    const left = aligners.find((b) => b.label === "Left-aligned")!;
    expect(left.build("Back to the left.").text).toContain("Back to the left.");
    expect(left.build("Back to the left.").text).not.toContain("Left-aligned text.");
  });
});
