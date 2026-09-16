import { describe, it, expect } from "vitest";

import {
  parseFindings, locate, anchorFindings, tagLocated, spanToMarks,
  groupFindings, findingTooltip, type Finding,
} from "./reviewFindings";

// A guide shaped like the real ones: a heading, a callout, a step, and a
// fenced block. Line 5 wraps in the source the way prose does, which is
// what the model quotes across.
const GUIDE = [
  "# Load a CSV",                                      // 1
  "",                                                  // 2
  "> **Note:**",                                       // 3
  ">",                                                 // 4
  "> In this lab you will read a CSV and write it",    // 5
  "> to a database table.",                            // 6
  "",                                                  // 7
  "## Open Spoon",                                     // 8
  "",                                                  // 9
  "Start Spoon from the shortcut.",                    // 10
].join("\n");

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: "should", quote: "", issue: "something is off", fix: "", ...over,
});

describe("parseFindings", () => {
  it("keeps well-formed findings and drops the rest", () => {
    const out = parseFindings([
      { severity: "critical", quote: "Start Spoon", issue: "no version given", fix: "say which" },
      { severity: "should", quote: "x", fix: "no issue means no finding" },
      null,
      "a string",
      { issue: "   " },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", quote: "Start Spoon", issue: "no version given" });
  });

  it("is not fooled by a payload that is not a list", () => {
    // An older backend answers with prose and no findings key at all.
    expect(parseFindings(undefined)).toEqual([]);
    expect(parseFindings("Critical: the lab has no prerequisites")).toEqual([]);
    expect(parseFindings({ findings: [] })).toEqual([]);
  });

  it("falls back to 'should' for a severity it does not know", () => {
    // The backend maps the model's vocabulary; this is the guard for a
    // payload that reached here without passing through it.
    expect(parseFindings([{ severity: "catastrophic", issue: "x" }])[0].severity).toBe("should");
    expect(parseFindings([{ issue: "x" }])[0].severity).toBe("should");
  });

  it("trims, and never returns more than the cap", () => {
    expect(parseFindings([{ quote: "  Open Spoon \n", issue: " x " }])[0]).toMatchObject({
      quote: "Open Spoon", issue: "x",
    });
    const many = Array.from({ length: 200 }, () => ({ issue: "x" }));
    expect(parseFindings(many)).toHaveLength(50);
  });
});

describe("locate", () => {
  it("finds a quote copied out of the guide, and says it was exact", () => {
    const a = locate(GUIDE, "Start Spoon from the shortcut.");
    expect(a).toMatchObject({ exact: true, occurrences: 1 });
    expect(GUIDE.slice(a!.start, a!.end)).toBe("Start Spoon from the shortcut.");
  });

  it("reports how many places a quote matches, and takes the first", () => {
    const body = "Run it.\n\nRun it.\n";
    const a = locate(body, "Run it.");
    expect(a).toMatchObject({ start: 0, occurrences: 2, exact: true });
  });

  it("matches across a line break the model closed up", () => {
    // The everyday near-miss: the sentence wraps in the source and the
    // model hands back one line of prose, callout markers and all gone.
    const a = locate(GUIDE, "read a CSV and write it to a database table");
    expect(a).toBeDefined();
    expect(a!.exact).toBe(false);
    // The span covers both halves, and stops at the final "table".
    expect(GUIDE.slice(a!.start, a!.end)).toBe("read a CSV and write it\n> to a database table");
  });

  it("sees through a callout's markers without dropping a real one", () => {
    // The `>` that opens a line is markdown; the `>` inside a command is
    // text, and a quote that omits it is a quote of something else.
    const body = "> In this lab you will\n> run `head -5 > out.txt` first.\n";
    expect(locate(body, "In this lab you will run")).toBeDefined();
    expect(locate(body, "head -5 out.txt")).toBeUndefined();
  });

  it("matches through a case slip and collapsed indentation", () => {
    const a = locate(GUIDE, "open   SPOON");
    expect(a).toMatchObject({ exact: false });
    expect(GUIDE.slice(a!.start, a!.end)).toBe("Open Spoon");
  });

  it("stops at the last matched character, not the punctuation after it", () => {
    const body = "Open the   Spoon window.";
    const a = locate(body, "open the spoon window");
    expect(body.slice(a!.start, a!.end)).toBe("Open the   Spoon window");
  });

  it("returns nothing for a quote the guide does not contain", () => {
    // The whole point: a fabricated quote anchors nowhere rather than
    // underlining whatever happens to be near.
    expect(locate(GUIDE, "Click the Transformations tab")).toBeUndefined();
  });

  it("returns nothing for an empty quote or an empty body", () => {
    expect(locate(GUIDE, "")).toBeUndefined();
    expect(locate(GUIDE, "   \n ")).toBeUndefined();
    expect(locate("", "anything")).toBeUndefined();
  });
});

describe("spanToMarks", () => {
  it("marks the exact columns on one line", () => {
    const start = GUIDE.indexOf("Spoon from");
    const marks = spanToMarks(GUIDE, start, start + "Spoon".length);
    expect(marks).toEqual([{ line: 10, startCol: 7, endCol: 12 }]);
  });

  it("splits a span that crosses lines into one mark per line", () => {
    const a = locate(GUIDE, "read a CSV and write it to a database table")!;
    const marks = spanToMarks(GUIDE, a.start, a.end);
    expect(marks.map((m) => m.line)).toEqual([5, 6]);
    // The first runs to the end of its line; the second starts at its
    // own beginning and stops inside it.
    expect(marks[0].endCol).toBe(GUIDE.split("\n")[4].length + 1);
    expect(marks[1].startCol).toBe(1);
  });

  it("skips the blank lines inside a range", () => {
    // Nothing to underline on an empty line, and a zero-width mark is a
    // span around no characters.
    const start = GUIDE.indexOf("## Open Spoon");
    const end = GUIDE.indexOf("Start Spoon") + 5;
    const marks = spanToMarks(GUIDE, start, end);
    expect(marks.map((m) => m.line)).toEqual([8, 10]);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(spanToMarks(GUIDE, 5, 5)).toEqual([]);
    expect(spanToMarks(GUIDE, 9, 4)).toEqual([]);
  });
});

describe("anchorFindings and grouping", () => {
  const findings: Finding[] = [
    finding({ severity: "critical", quote: "Start Spoon from the shortcut.", issue: "no version" }),
    finding({ severity: "nice", quote: "", issue: "no prerequisites section" }),
    finding({ severity: "should", quote: "Click the Transformations tab", issue: "invented" }),
    finding({ severity: "should", quote: "## Open Spoon", issue: "was fixed", locatedAtRun: true }),
  ];

  it("sorts each group worst first, holding the review's order among equals", () => {
    const body = GUIDE.replace("## Open Spoon", "## Launch Spoon");
    const g = groupFindings(anchorFindings(body, findings));
    expect(g.located.map((f) => f.issue)).toEqual(["no version"]);
    expect(g.general.map((f) => f.issue)).toEqual(["no prerequisites section"]);
    expect(g.unlocated.map((f) => f.issue)).toEqual(["invented"]);
    // Quoted the guide when the review ran, gone from it now: fixed,
    // not fabricated — and the two are indistinguishable without the
    // stamp taken at run time.
    expect(g.fixed.map((f) => f.issue)).toEqual(["was fixed"]);
  });

  it("ids survive re-anchoring, so a row keeps its identity as you type", () => {
    const first = anchorFindings(GUIDE, findings);
    const later = anchorFindings(GUIDE.replace("Start Spoon", "Launch Spoon"), findings);
    expect(later.map((f) => f.id)).toEqual(first.map((f) => f.id));
    expect(first[0].anchor).toBeDefined();
    expect(later[0].anchor).toBeUndefined();
  });

  it("stamps what could be located at review time", () => {
    const tagged = tagLocated(GUIDE, findings.map((f) => ({ ...f, locatedAtRun: undefined })));
    expect(tagged.map((f) => f.locatedAtRun)).toEqual([true, false, false, true]);
  });
});

describe("findingTooltip", () => {
  it("carries the fix when there is one, and reads as one line when there is not", () => {
    expect(findingTooltip(finding({ severity: "critical", issue: "no version", fix: "say which" })))
      .toBe("AI review (Critical): no version\nFix: say which");
    expect(findingTooltip(finding({ issue: "no version" })))
      .toBe("AI review (Should fix): no version");
  });
});
