import { describe, it, expect } from "vitest";

import {
  parseVerifyOutput, problemsForGuide, byLine, worst, tooltip, unplaced,
} from "./verifyProblems";

// Real output, copied from the verifier after breaking a guide on
// purpose. Keeping the genuine article means a change to its format
// fails here rather than silently marking nothing.
const REPORT = `
▸ _template
  warn   _template/01-before-you-start/guide.md:108: \`\`\`wat has no highlighter grammar — use \`\`\`text, or alias it
  ERROR  _template/01-before-you-start/guide.md:112: unclosed \`::: tabs\` fence (no matching \`:::\`)
  warn   _template/01-before-you-start/manifest.json: stepCount 9 != computed 10 — run stamp-manifests.mjs
  ERROR  _template/SUMMARY.md: links "ghost-lab" but the folder doesn't exist

──────────────────────────────────────────────────
1 error(s), 2 warning(s) across 1 course(s)
`;

describe("parseVerifyOutput", () => {
  it("reads every problem, and nothing else", () => {
    const p = parseVerifyOutput(REPORT);
    expect(p).toHaveLength(4);
    // The banner, the rule and the totals are not problems.
    expect(p.map((x) => x.file)).not.toContain("▸");
  });

  it("separates errors from warnings", () => {
    const p = parseVerifyOutput(REPORT);
    expect(p.filter((x) => x.severity === "error")).toHaveLength(2);
    expect(p.filter((x) => x.severity === "warn")).toHaveLength(2);
  });

  it("reads the line where there is one, and leaves it off where there is not", () => {
    const p = parseVerifyOutput(REPORT);
    expect(p[0]).toMatchObject({ line: 108, severity: "warn" });
    expect(p[1]).toMatchObject({ line: 112, severity: "error" });
    expect(p[2].line).toBeUndefined();   // a manifest metric has no line
    expect(p[3].line).toBeUndefined();   // nor does a SUMMARY link
  });

  it("keeps the message whole, colons and backticks included", () => {
    const p = parseVerifyOutput(REPORT);
    expect(p[1].message).toBe("unclosed `::: tabs` fence (no matching `:::`)");
  });

  it("does not mistake a colon inside the message for the line separator", () => {
    const p = parseVerifyOutput("  ERROR  a/b/guide.md: see http://x:8080 for why");
    expect(p[0].line).toBeUndefined();
    expect(p[0].message).toBe("see http://x:8080 for why");
  });

  it("survives an empty or clean report", () => {
    expect(parseVerifyOutput("")).toEqual([]);
    expect(parseVerifyOutput("▸ course\n  ok\n\n0 error(s), 0 warning(s)")).toEqual([]);
    expect(parseVerifyOutput(undefined as unknown as string)).toEqual([]);
  });
});

describe("problemsForGuide", () => {
  const problems = parseVerifyOutput(REPORT);

  it("takes only the open lab's guide", () => {
    const mine = problemsForGuide(problems, "_template", "01-before-you-start");
    expect(mine).toHaveLength(2);
    expect(mine.every((p) => p.file.endsWith("guide.md"))).toBe(true);
  });

  it("does not claim another lab's problems", () => {
    expect(problemsForGuide(problems, "_template", "02-other")).toEqual([]);
    expect(problemsForGuide(problems, "other-course", "01-before-you-start")).toEqual([]);
  });

  it("is safe before a course or lab is chosen", () => {
    expect(problemsForGuide(problems, "", "01-before-you-start")).toEqual([]);
    expect(problemsForGuide(problems, "_template", "")).toEqual([]);
  });
});

describe("byLine / worst / tooltip", () => {
  it("groups problems that share a line", () => {
    const p = parseVerifyOutput(
      "  warn   a/b/guide.md:5: first\n  ERROR  a/b/guide.md:5: second\n  warn   a/b/guide.md:9: third",
    );
    const m = byLine(p);
    expect(m.get(5)).toHaveLength(2);
    expect(m.get(9)).toHaveLength(1);
    expect(m.size).toBe(2);
  });

  it("drops line-less problems from the line map rather than bunching them at 0", () => {
    const p = parseVerifyOutput("  ERROR  a/b/manifest.json: no line here");
    expect(byLine(p).size).toBe(0);
  });

  it("lets one error outrank any number of warnings on a line", () => {
    const p = parseVerifyOutput("  warn   a/b/guide.md:5: w\n  ERROR  a/b/guide.md:5: e");
    expect(worst(byLine(p).get(5)!)).toBe("error");
    expect(worst(parseVerifyOutput("  warn   a/b/guide.md:5: w"))).toBe("warn");
  });

  it("puts every message on a line into the tooltip", () => {
    const p = parseVerifyOutput("  warn   a/b/guide.md:5: first\n  ERROR  a/b/guide.md:5: second");
    expect(tooltip(p)).toBe("Warning: first\nError: second");
  });
});

describe("unplaced", () => {
  it("names the problems no gutter marker can show", () => {
    // Without this a guide with only line-less problems looks clean in
    // the gutter while Verify still reports failures, and the author
    // reasonably concludes the marking is broken.
    const u = unplaced(parseVerifyOutput(REPORT));
    expect(u).toHaveLength(2);
    expect(u.every((p) => p.line === undefined)).toBe(true);
  });
});

describe("spans", () => {
  const SPANNED = [
    "  warn   c/01-l/guide.md:108:4-7: ```wat has no highlighter grammar",
    "  warn   c/01-l/guide.md:112:6-29: <dfn>NotARealTerm</dfn> has no glossary.json entry",
    "  warn   c/01-l/guide.md:112:39-58: <dfn>AlsoFake</dfn> has no glossary.json entry",
    "  ERROR  c/01-l/guide.md:200: unclosed fence",
    "  warn   c/01-l/manifest.json: stepCount drift",
  ].join("\n");

  it("reads the column range where the verifier gives one", () => {
    const p = parseVerifyOutput(SPANNED);
    expect(p[0]).toMatchObject({ line: 108, col: 4, endCol: 7 });
  });

  it("distinguishes two problems on the same line", () => {
    // The whole reason spans exist: a line with several <dfn>s used to
    // report one line number twice and leave you guessing which term.
    const p = parseVerifyOutput(SPANNED);
    expect(p[1]).toMatchObject({ line: 112, col: 6, endCol: 29 });
    expect(p[2]).toMatchObject({ line: 112, col: 39, endCol: 58 });
    expect(byLine(p).get(112)).toHaveLength(2);
  });

  it("leaves the columns undefined for line-only and file-only problems", () => {
    const p = parseVerifyOutput(SPANNED);
    expect(p[3]).toMatchObject({ line: 200 });
    expect(p[3].col).toBeUndefined();
    expect(p[4].line).toBeUndefined();
    expect(p[4].col).toBeUndefined();
  });

  it("still parses the older line-only format, so an older app degrades quietly", () => {
    const p = parseVerifyOutput("  warn   c/01-l/guide.md:42: something");
    expect(p[0]).toMatchObject({ line: 42, message: "something" });
    expect(p[0].col).toBeUndefined();
  });
});
