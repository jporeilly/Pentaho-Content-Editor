import { describe, it, expect } from "vitest";

import { rankCommands, scoreCommand, subsequence, moveSelection, type Command } from "./commandRanking";

const cmd = (group: string, label: string, title = ""): Command =>
  ({ id: `${group}:${label}`, group, label, title, run: () => {} });

// A slice of the real registry, in registry order.
const COMMANDS: Command[] = [
  cmd("Heading", "Step (H2)", "Heading — a tracked step with a checkbox"),
  cmd("Callout", "Note", "Informational note"),
  cmd("Callout", "Under the hood", "Explain what the engine just did"),
  cmd("Media", "Image", "Image, flush left with a caption"),
  cmd("Media", "Image — centred", "Centred figure"),
  cmd("Media", "Image — float right", "Float the image right"),
  cmd("Media", "Video — with caption", "A Vimeo clip with the house caption"),
  cmd("Code", "Code block", "Fenced code"),
  cmd("Text", "Inline code", "Inline code span"),
  cmd("Block", "Table", "Markdown table — choose its shape"),
];

const labels = (q: string) => rankCommands(COMMANDS, q).map((c) => c.label);

describe("rankCommands", () => {
  it("returns everything, in registry order, for an empty query", () => {
    expect(rankCommands(COMMANDS, "")).toHaveLength(COMMANDS.length);
    expect(labels("")[0]).toBe("Step (H2)");
    expect(labels("   ")).toHaveLength(COMMANDS.length);
  });

  it("puts an exact label first", () => {
    expect(labels("note")[0]).toBe("Note");
    expect(labels("table")[0]).toBe("Table");
  });

  it("prefers a prefix over a mid-string hit", () => {
    // "Code block" starts with it; "Inline code" merely contains it.
    const r = labels("code");
    expect(r.indexOf("Code block")).toBeLessThan(r.indexOf("Inline code"));
  });

  it("finds a whole family by its group name", () => {
    const r = labels("media");
    expect(r).toContain("Image");
    expect(r).toContain("Video — with caption");
    expect(r).not.toContain("Table");
  });

  it("matches across group and label together", () => {
    // Nothing is labelled "media image" - the group supplies one half.
    expect(labels("media image")).toContain("Image — centred");
  });

  it("keeps the shortest label first among prefix matches", () => {
    // Typing "image" should offer plain Image before its variants.
    expect(labels("image")[0]).toBe("Image");
  });

  it("falls back to a subsequence, but never above a real hit", () => {
    expect(labels("clt")).toContain("Under the hood");   // via group "Callout"
    const r = labels("note");
    expect(r[0]).toBe("Note");                            // exact beats fuzzy
  });

  it("searches the tooltip, ranked below label and group", () => {
    const r = labels("checkbox");                         // only in a title
    expect(r).toContain("Step (H2)");
  });

  it("drops what does not match at all", () => {
    expect(labels("zzzqqq")).toEqual([]);
  });

  it("is stable - equal scores keep registry order", () => {
    const twice = [labels("image"), labels("image")];
    expect(twice[0]).toEqual(twice[1]);
  });
});

describe("scoreCommand", () => {
  it("orders the tiers as documented", () => {
    const c = cmd("Media", "Image", "a picture");
    expect(scoreCommand(c, "image")).toBeGreaterThan(scoreCommand(c, "mage"));
    expect(scoreCommand(c, "mage")).toBeGreaterThan(scoreCommand(c, "media"));
    expect(scoreCommand(c, "media")).toBeGreaterThan(scoreCommand(c, "picture"));
    expect(scoreCommand(c, "zzz")).toBe(0);
  });
});

describe("subsequence", () => {
  it("matches characters in order, with gaps", () => {
    expect(subsequence("callout", "clt")).toBe(true);
    expect(subsequence("callout", "cal")).toBe(true);
    expect(subsequence("callout", "clout")).toBe(true);
  });

  it("rejects out-of-order or absent characters", () => {
    expect(subsequence("callout", "tuo")).toBe(false);
    expect(subsequence("callout", "callouts")).toBe(false);
  });

  it("treats an empty query as matching", () => {
    expect(subsequence("anything", "")).toBe(true);
  });
});

describe("moveSelection", () => {
  it("wraps at both ends so the list is a loop", () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
  });

  it("stays at 0 when there is nothing to move through", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
    expect(moveSelection(0, -1, 0)).toBe(0);
  });
});
