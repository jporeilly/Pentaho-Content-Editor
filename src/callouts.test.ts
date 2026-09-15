import { describe, expect, it } from "vitest";

import { CALLOUT_KINDS, buildCallout, quoteLines } from "./callouts";

describe("quoteLines", () => {
  it("prefixes every line, not just the first", () => {
    // The bug this exists to stop: CommonMark ends a blockquote at the
    // first unprefixed line, so lines 2+ fell out of the callout.
    const out = quoteLines("One.\nTwo.\nThree.");
    expect(out.split("\n").every((l) => l.startsWith(">"))).toBe(true);
  });

  it("writes a bare > for blank lines, never a trailing space", () => {
    const out = quoteLines("One.\n\nTwo.");
    expect(out.split("\n")).toEqual(["> One.", ">", "> Two."]);
  });
});

describe("buildCallout", () => {
  it("writes the tag and keeps a multi-line body inside the quote", () => {
    const md = buildCallout({ tag: "Note", body: "First line.\nSecond line." });
    const lines = md.trimEnd().split("\n");
    expect(lines[0]).toBe("> **Note:**");
    expect(lines.every((l) => l.startsWith(">"))).toBe(true);
    expect(md.endsWith("\n\n")).toBe(true);
  });

  it("promotes a title to the #### strip the renderer looks for", () => {
    const md = buildCallout({ tag: "Under the hood", title: "Why that worked", body: "Because." });
    expect(md.trimEnd().split("\n")).toEqual([
      "> **Under the hood:**",
      ">",
      "> #### Why that worked",
      ">",
      "> Because.",
    ]);
  });

  it("separates the parts with a blank quoted line", () => {
    // Without the blank line the #### is read as the first words of the
    // paragraph rather than as a heading, and no title strip appears.
    const md = buildCallout({ tag: "Tip", title: "T", body: "B" });
    expect(md).toContain("**Tip:**\n>\n> #### T\n>\n> B");
  });

  it("omits the tag for an untagged quote", () => {
    const md = buildCallout({ tag: "", body: "Quoted text." });
    expect(md.trimEnd()).toBe("> Quoted text.");
  });

  it("ignores a blank title rather than writing an empty heading", () => {
    const md = buildCallout({ tag: "Note", title: "   ", body: "Body." });
    expect(md).not.toContain("####");
  });
});

describe("callout kinds", () => {
  it("gives every kind a tag, a label and a sample", () => {
    for (const k of CALLOUT_KINDS) {
      expect(k.tag, JSON.stringify(k)).toBeTruthy();
      expect(k.label, k.tag).toBeTruthy();
      expect(k.sample, k.tag).toBeTruthy();
    }
  });

  it("has no duplicate tags", () => {
    const tags = CALLOUT_KINDS.map((k) => k.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
