// Turn the course verifier's report into problems the editor can mark.
//
// Verify used to print into a dismissable panel: it told you a guide had
// an unclosed fence, and left you to find it. The verifier now reports
// "path:line: message", so the editor can put the problem ON the line —
// which is the whole difference between a report and a proofreader.
//
// Parsing text rather than calling a structured API is deliberate. The
// verifier is the Content Manager's, shared with its CLI and its CI, and
// its console output is the interface all three already use. A second,
// JSON-emitting path would be a second thing to keep true.

export type Severity = "error" | "warn";

export interface Problem {
  severity: Severity;
  /** Course-relative, as the verifier prints it: "slug/01-lab/guide.md". */
  file: string;
  /** 1-based, or undefined where a line would be meaningless. */
  line?: number;
  /** 1-based start column, when the check knows the exact text at fault. */
  col?: number;
  /** 1-based, EXCLUSIVE — the half-open convention the verifier reports. */
  endCol?: number;
  message: string;
}

// "  ERROR  slug/01-lab/guide.md:42:4-7: message"   span known
// "  ERROR  slug/01-lab/guide.md:42: message"        line only
// "  warn   slug/01-lab/manifest.json: message"      neither
//
// All three shapes are accepted, so an older Content Manager whose
// verifier reports no line still parses - every problem simply lands in
// the not-tied-to-a-line count rather than the editor breaking.
//
// The path is non-greedy up to the LAST colon before the message, so a
// Windows-style drive letter or a colon inside the message cannot be
// mistaken for the line separator.
const LINE_RE = /^\s*(ERROR|warn)\s+(\S+?)(?::(\d+)(?::(\d+)-(\d+))?)?:\s+(.*)$/;

export function parseVerifyOutput(output: string): Problem[] {
  const out: Problem[] = [];
  for (const raw of (output ?? "").split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    out.push({
      severity: m[1] === "ERROR" ? "error" : "warn",
      file: m[2].replace(/\\/g, "/"),
      line: m[3] ? Number(m[3]) : undefined,
      col: m[4] ? Number(m[4]) : undefined,
      endCol: m[5] ? Number(m[5]) : undefined,
      message: m[6].trim(),
    });
  }
  return out;
}

/**
 * The problems belonging to one lab's guide.
 *
 * Matched on the tail of the path rather than the whole of it: the
 * verifier prints course-relative paths, the editor knows the course and
 * lab slugs, and gluing those together to compare would break the moment
 * either side changed its separator or its prefix.
 */
export function problemsForGuide(problems: Problem[], course: string, lab: string): Problem[] {
  if (!course || !lab) return [];
  const tail = `${course}/${lab}/guide.md`;
  return problems.filter((p) => p.file === tail || p.file.endsWith(`/${tail}`));
}

/**
 * Problems by 1-based line, for the lines that have one.
 *
 * Several problems can share a line — an error and a warning on the same
 * fence, say — so the marker shows the worst of them and the tooltip
 * carries all.
 */
export function byLine(problems: Problem[]): Map<number, Problem[]> {
  const map = new Map<number, Problem[]>();
  for (const p of problems) {
    if (!p.line) continue;
    const list = map.get(p.line);
    if (list) list.push(p);
    else map.set(p.line, [p]);
  }
  return map;
}

/** An error anywhere in the group outranks any number of warnings. */
export function worst(problems: Problem[]): Severity {
  return problems.some((p) => p.severity === "error") ? "error" : "warn";
}

/** One line's problems, as a tooltip. */
export function tooltip(problems: Problem[]): string {
  return problems.map((p) => `${p.severity === "error" ? "Error" : "Warning"}: ${p.message}`).join("\n");
}

/**
 * How many problems could NOT be placed on a line.
 *
 * Worth surfacing: a guide with three line-less problems would otherwise
 * look clean in the gutter while Verify still reports failures, and the
 * author would reasonably conclude the marking was broken.
 */
export function unplaced(problems: Problem[]): Problem[] {
  return problems.filter((p) => !p.line);
}
