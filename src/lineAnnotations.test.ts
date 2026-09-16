import { describe, it, expect } from "vitest";

import { annotateLines } from "./lineAnnotations";
import { anchorFindings, type Finding } from "./reviewFindings";
import { parseVerifyOutput, problemsForGuide } from "./verifyProblems";

const BODY = [
  "# Load a CSV",                                   // 1
  "",                                               // 2
  "```wat",                                         // 3
  "select 1",                                       // 4
  "```",                                            // 5
  "",                                               // 6
  "Start Spoon from the shortcut and wait for it",  // 7
  "to finish loading.",                             // 8
].join("\n");

// The verifier's own output shape: a span on line 3, a whole-line
// problem on line 7, and one that belongs to no line at all.
const REPORT = [
  "  warn   sample/01-lab/guide.md:3:4-7: ```wat has no highlighter grammar — use ```text, or alias it",
  "  ERROR  sample/01-lab/guide.md:7: this step has no checkbox",
  "  warn   sample/01-lab/manifest.json: stepCount 2 != computed 3",
].join("\n");

const PROBLEMS = problemsForGuide(parseVerifyOutput(REPORT), "sample", "01-lab");

const finding = (over: Partial<Finding>): Finding => ({
  severity: "should", quote: "", issue: "an issue", fix: "", ...over,
});

describe("annotateLines", () => {
  it("marks the verifier's span and the review's quote from one pass", () => {
    const findings = anchorFindings(BODY, [finding({ severity: "critical", quote: "select 1", issue: "unexplained" })]);
    const { marks, lines } = annotateLines(BODY, PROBLEMS, findings);

    expect(marks.get(3)).toEqual([{ startCol: 4, endCol: 7, className: "mark-warn" }]);
    expect(marks.get(4)).toEqual([{ startCol: 1, endCol: 9, className: "mark-review is-critical" }]);
    expect(lines.get(3)!.classes).toEqual(["has-warn"]);
    expect(lines.get(4)!.classes).toEqual(["has-review"]);
  });

  it("lets both channels share a line, with the verifier's message first", () => {
    // The case the live rig cannot produce on demand — Verify reads disk
    // and passes clean on a good course — and the one where writing the
    // merge twice in the component silently lost a tooltip.
    const findings = anchorFindings(BODY, [finding({ quote: "Start Spoon", issue: "which version?" })]);
    const { marks, lines } = annotateLines(BODY, PROBLEMS, findings);

    const ann = lines.get(7)!;
    expect(ann.classes).toEqual(["has-error", "has-review"]);
    expect(ann.title).toBe(
      "Error: this step has no checkbox\nAI review (Should fix): which version?",
    );
    // The verifier reported no span for line 7, so only the review
    // underlines anything there.
    expect(marks.get(7)).toEqual([{ startCol: 1, endCol: 12, className: "mark-review is-should" }]);
  });

  it("carries a finding that spans two lines once on each of them", () => {
    const findings = anchorFindings(BODY, [
      finding({ quote: "wait for it to finish loading", issue: "how long?" }),
    ]);
    const { marks, lines } = annotateLines(BODY, [], findings);

    expect([...marks.keys()]).toEqual([7, 8]);
    expect(lines.get(7)!.title).toBe("AI review (Should fix): how long?");
    expect(lines.get(8)!.title).toBe(lines.get(7)!.title);
    // Once, not twice — the same remark repeated reads as two problems.
    expect(lines.get(8)!.title.split("\n")).toHaveLength(1);
  });

  it("leaves a problem with no line, and a finding with no anchor, unmarked", () => {
    const findings = anchorFindings(BODY, [
      finding({ quote: "Click the Transformations tab", issue: "invented" }),
      finding({ quote: "", issue: "no prerequisites section" }),
    ]);
    const { marks, lines } = annotateLines(BODY, PROBLEMS, findings);

    // The manifest problem belongs to no line and is counted elsewhere.
    expect([...lines.keys()].sort((a, b) => a - b)).toEqual([3, 7]);
    expect(marks.has(1)).toBe(false);
  });

  it("is empty when neither channel has run", () => {
    const { marks, lines } = annotateLines(BODY, [], []);
    expect(marks.size).toBe(0);
    expect(lines.size).toBe(0);
  });
});
