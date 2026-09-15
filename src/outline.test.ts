import { describe, expect, it } from "vitest";

import { outlineOf, scrollTopForLine } from "./outline";

describe("outlineOf", () => {
  it("lists headings in order, with level, line and offset", () => {
    const body = ["# Title", "", "## Step one", "prose", "### Detail", "", "## Step two"].join("\n");
    const out = outlineOf(body);
    expect(out.map((e) => [e.level, e.text])).toEqual([
      [1, "Title"], [2, "Step one"], [3, "Detail"], [2, "Step two"],
    ]);
    expect(out[1].line).toBe(2);
    expect(body.slice(out[1].offset).startsWith("## Step one")).toBe(true);
  });

  it("ignores # lines inside a fenced code block", () => {
    // A shell snippet full of comments would otherwise flood the
    // outline and jump the author into the middle of a code block.
    const body = [
      "## Real heading",
      "",
      "```bash",
      "# not a heading",
      "## also not",
      "```",
      "",
      "## Second real",
    ].join("\n");
    expect(outlineOf(body).map((e) => e.text)).toEqual(["Real heading", "Second real"]);
  });

  it("handles tilde fences and longer fences", () => {
    const body = ["~~~", "# hidden", "~~~", "## shown", "````", "# hidden too", "````"].join("\n");
    expect(outlineOf(body).map((e) => e.text)).toEqual(["shown"]);
  });

  it("does not close a backtick fence with a tilde one", () => {
    const body = ["```", "~~~", "# still inside the fence", "```", "## after"].join("\n");
    expect(outlineOf(body).map((e) => e.text)).toEqual(["after"]);
  });

  it("wants a space after the hashes, so a #hashtag is not a heading", () => {
    expect(outlineOf("#hashtag\n## real").map((e) => e.text)).toEqual(["real"]);
  });

  it("strips closing hashes from a setext-style closed heading", () => {
    expect(outlineOf("## Middle ##").map((e) => e.text)).toEqual(["Middle"]);
  });

  it("returns nothing for a guide with no headings", () => {
    expect(outlineOf("Just prose.\n\nMore prose.")).toEqual([]);
  });
});

describe("scrollTopForLine", () => {
  it("puts the heading near the top, with a couple of lines of context", () => {
    expect(scrollTopForLine(10, 20)).toBe(160); // (10 - 2) * 20
  });

  it("never scrolls above the top of the document", () => {
    expect(scrollTopForLine(1, 20)).toBe(0);
    expect(scrollTopForLine(0, 20)).toBe(0);
  });
});
