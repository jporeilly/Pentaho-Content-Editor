// Where the verifier's problems and the AI review's findings meet.
//
// The editor marks the source from two channels that agree about
// nothing: the verifier measured the file and reports `path:line:col`,
// while the review quotes text that is found in the buffer. They meet
// twice on the way to the screen — once as the underlines woven into the
// highlight layer's markup, once as the classes and tooltip written onto
// its line elements — and doing that merge twice in the component is how
// the two drifted apart in the first place: a line could be underlined
// by one pass and go untitled by the other.
//
// So they meet once, here, in a pure function over both channels. What
// comes out is exactly what the layer needs, and the rules that took a
// bug each to learn are stated once:
//
//   • A line can carry both. Verify keeps the gutter number, because it
//     measured the file and the review is an opinion about the prose.
//   • One line has ONE title attribute between the two of them, so the
//     messages are joined rather than one overwriting the other.
//   • A finding spanning three lines is one remark, not three: each line
//     it touches carries it once.

import { byLine, worst, tooltip, type Problem } from "./verifyProblems";
import { spanToMarks, findingTooltip, type AnchoredFinding } from "./reviewFindings";
import type { LineMark } from "./markdownTokens";

/** What one source line's element carries. */
export interface LineAnnotation {
  /** `has-error` / `has-warn` from the verifier, `has-review` from the AI. */
  classes: string[];
  /** Every message on the line, the verifier's first. */
  title: string;
}

export interface Annotations {
  /** Character ranges to underline, by 1-based line. */
  marks: Map<number, LineMark[]>;
  /** Classes and tooltip, by 1-based line. */
  lines: Map<number, LineAnnotation>;
}

export function annotateLines(
  body: string,
  problems: Problem[],
  findings: AnchoredFinding[],
): Annotations {
  const marks = new Map<number, LineMark[]>();
  const lines = new Map<number, LineAnnotation>();

  const addMark = (line: number, mark: LineMark) => {
    const list = marks.get(line) ?? [];
    list.push(mark);
    marks.set(line, list);
  };
  const annotate = (line: number, className: string, message: string) => {
    const ann = lines.get(line) ?? { classes: [], title: "" };
    if (!ann.classes.includes(className)) ann.classes.push(className);
    // A multi-line finding lands here once per line it covers, and the
    // same remark twice on one line reads as two problems.
    if (ann.title !== message && !ann.title.includes(message)) {
      ann.title = ann.title ? `${ann.title}\n${message}` : message;
    }
    lines.set(line, ann);
  };

  // The verifier first, so its message leads the tooltip on a shared line.
  for (const p of problems) {
    if (!p.line) continue;
    if (p.col && p.endCol) {
      addMark(p.line, {
        startCol: p.col,
        endCol: p.endCol,
        className: p.severity === "error" ? "mark-error" : "mark-warn",
      });
    }
  }
  for (const [line, group] of byLine(problems)) {
    annotate(line, worst(group) === "error" ? "has-error" : "has-warn", tooltip(group));
  }

  for (const f of findings) {
    if (!f.anchor) continue;
    const note = findingTooltip(f);
    for (const s of spanToMarks(body, f.anchor.start, f.anchor.end)) {
      addMark(s.line, {
        startCol: s.startCol,
        endCol: s.endCol,
        className: `mark-review is-${f.severity}`,
      });
      annotate(s.line, "has-review", note);
    }
  }

  return { marks, lines };
}
