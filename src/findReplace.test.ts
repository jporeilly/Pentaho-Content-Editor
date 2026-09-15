import { describe, it, expect } from "vitest";

import { findMatches, nextMatch, replaceAt, replaceAll, matchLabel } from "./findReplace";

describe("findMatches", () => {
  it("finds every occurrence, case-insensitively by default", () => {
    expect(findMatches("Lab lab LAB", "lab")).toHaveLength(3);
    expect(findMatches("Lab lab LAB", "lab", { caseSensitive: true })).toHaveLength(1);
  });

  it("returns nothing for an empty needle instead of matching everywhere", () => {
    // Every position "contains" the empty string; without the guard the
    // loop below never advances and the count is meaningless.
    expect(findMatches("anything", "")).toEqual([]);
  });

  it("counts overlapping runs as non-overlapping matches", () => {
    // "aa" occurs TWICE in "aaaa", not three times. Three would corrupt
    // the text on replace and disagree with the count in the bar.
    expect(findMatches("aaaa", "aa")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it("treats markdown punctuation literally, not as a pattern", () => {
    // Guides are full of these. A regex search would throw or silently
    // match the wrong thing.
    const body = "Use **Note:** for asides. Costs $5 (roughly). a|b";
    expect(findMatches(body, "**Note:**")).toHaveLength(1);
    expect(findMatches(body, "$5")).toHaveLength(1);
    expect(findMatches(body, "(roughly)")).toHaveLength(1);
    expect(findMatches(body, "a|b")).toHaveLength(1);
    expect(findMatches(body, ".*")).toHaveLength(0);
  });
});

describe("nextMatch", () => {
  const m = findMatches("a-x-a-x-a", "a"); // 0, 4, 8

  it("goes to the first match at or after the caret", () => {
    expect(nextMatch(m, 0, 1)).toBe(0);
    expect(nextMatch(m, 1, 1)).toBe(1);
    expect(nextMatch(m, 5, 1)).toBe(2);
  });

  it("wraps forward rather than stopping at the end of the file", () => {
    expect(nextMatch(m, 9, 1)).toBe(0);
  });

  it("goes backward to the last match before the caret, and wraps", () => {
    expect(nextMatch(m, 5, -1)).toBe(1);
    expect(nextMatch(m, 0, -1)).toBe(2);
  });

  it("reports -1 when there is nothing to go to", () => {
    expect(nextMatch([], 0, 1)).toBe(-1);
  });
});

describe("replaceAt", () => {
  it("splices one match and leaves the caret after the replacement", () => {
    const text = "the old path";
    const m = findMatches(text, "old")[0];
    expect(replaceAt(text, m, "new")).toEqual({ text: "the new path", caret: 7 });
  });
});

describe("replaceAll", () => {
  it("replaces every occurrence and reports the count", () => {
    expect(replaceAll("a b a b a", "a", "z")).toEqual({ text: "z b z b z", count: 3 });
  });

  it("terminates when the replacement contains the needle", () => {
    // The reason this is built from a fixed match list rather than a
    // repeated scan: "lab" -> "lab guide" would otherwise keep finding
    // the "lab" it just wrote, forever.
    expect(replaceAll("one lab here", "lab", "lab guide"))
      .toEqual({ text: "one lab guide here", count: 1 });
    expect(replaceAll("lab lab", "lab", "a lab b"))
      .toEqual({ text: "a lab b a lab b", count: 2 });
  });

  it("keeps earlier offsets valid by splicing right to left", () => {
    // A left-to-right splice with a longer replacement shifts every
    // later match and lands them mid-word.
    expect(replaceAll("x--x--x", "x", "LONG"))
      .toEqual({ text: "LONG--LONG--LONG", count: 3 });
  });

  it("is a no-op when nothing matches", () => {
    expect(replaceAll("untouched", "zzz", "!")).toEqual({ text: "untouched", count: 0 });
  });

  it("honours case sensitivity", () => {
    expect(replaceAll("Lab lab", "lab", "x")).toEqual({ text: "x x", count: 2 });
    expect(replaceAll("Lab lab", "lab", "x", { caseSensitive: true })).toEqual({ text: "Lab x", count: 1 });
  });

  it("can delete, which is a replacement with nothing", () => {
    expect(replaceAll("a-b-c", "-", "")).toEqual({ text: "abc", count: 2 });
  });
});

describe("matchLabel", () => {
  it("says where you are once you are somewhere", () => {
    const m = findMatches("a a a", "a");
    expect(matchLabel(m, 0)).toBe("1 of 3");
    expect(matchLabel(m, 2)).toBe("3 of 3");
  });

  it("counts before you have moved, and singularises", () => {
    expect(matchLabel(findMatches("a a", "a"), -1)).toBe("2 matches");
    expect(matchLabel(findMatches("a", "a"), -1)).toBe("1 match");
  });

  it("says so when there is nothing", () => {
    expect(matchLabel([], -1)).toBe("no matches");
  });
});
