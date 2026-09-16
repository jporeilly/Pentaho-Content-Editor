// The AI review's findings, anchored to the text they are about.
//
// Verify went panel -> line -> exact span across 1.3.0 and 1.4.0. The AI
// review stayed a wall of prose in a <pre>, which left the author doing
// the very thing the inline marks exist to stop: hunting the guide for
// the sentence a bullet point is talking about.
//
// It cannot be done the way Verify does it. The verifier reports
// `path:line:col` and is right, because it MEASURED the file. A model
// asked for a line number guesses one — the review is good at naming
// what is wrong and unreliable on exactly where, and a confident squiggle
// under an innocent line is worse than no squiggle at all. So the model
// is asked for the TEXT instead, copied verbatim, and the editor finds it
// here.
//
// That inverts the failure. A quote the guide does not contain cannot be
// anchored, so the finding lands in a "couldn't be located" list instead
// of marking the wrong place — and a fabricated quote is precisely the
// one that fails to match. The check costs nothing and catches the
// findings that deserve catching.
//
// It also makes staleness self-correcting. Verify reads disk while the
// pane shows the buffer, so its marks drift as you type and the editor
// has to warn about it. These are re-anchored against the live buffer on
// every render: fix the sentence and its finding stops matching, which
// is reported as fixed rather than left pointing at text that is gone.

export type ReviewSeverity = "critical" | "should" | "nice";

/** Worst first — the order the panel lists them in. */
export const SEVERITY_ORDER: ReviewSeverity[] = ["critical", "should", "nice"];

const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  critical: "Critical",
  should: "Should fix",
  nice: "Nice to have",
};

export function severityLabel(s: ReviewSeverity): string {
  return SEVERITY_LABELS[s];
}

export interface Finding {
  severity: ReviewSeverity;
  /** Verbatim from the guide, or "" when the finding is about an absence. */
  quote: string;
  issue: string;
  fix: string;
  /**
   * Did the quote match when the review came back?
   *
   * Recorded once, at that moment, because it is the only way to tell
   * the two kinds of unanchored finding apart later: one whose quote
   * never existed (the model made it up) and one whose quote existed
   * and has since been edited away (the author fixed it). Both look
   * identical against the current buffer.
   */
  locatedAtRun?: boolean;
}

export interface Anchor {
  /** 0-based character offset into the body. */
  start: number;
  /** Exclusive. */
  end: number;
  /** Matched character for character, rather than through case and whitespace. */
  exact: boolean;
  /** How many places the quote matches. More than one means the first was taken. */
  occurrences: number;
}

export interface AnchoredFinding extends Finding {
  /** Position in the review, so React keys survive re-anchoring. */
  id: number;
  anchor?: Anchor;
}

/** A guide has tens of real problems; a model in a loop can produce thousands. */
const MAX_FINDINGS = 50;

/**
 * Findings out of whatever the API returned.
 *
 * Structural validation only — the backend has already mapped the
 * model's own vocabulary ("major", "minor", "Should fix") onto the three
 * severities. What this guards against is shape: a payload from an older
 * backend, a provider that answered in prose, a null in the array.
 */
export function parseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  const out: Finding[] = [];
  for (const item of raw.slice(0, MAX_FINDINGS)) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const issue = typeof f.issue === "string" ? f.issue.trim() : "";
    if (!issue) continue;
    const severity = f.severity as ReviewSeverity;
    out.push({
      severity: SEVERITY_ORDER.includes(severity) ? severity : "should",
      quote: typeof f.quote === "string" ? f.quote.trim() : "",
      issue,
      fix: typeof f.fix === "string" ? f.fix.trim() : "",
    });
  }
  return out;
}

/** Every occurrence of `needle`, left to right and non-overlapping. */
function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    from = at + needle.length;
  }
}

/**
 * The body with whitespace runs collapsed to one space and case dropped,
 * plus the offset in the ORIGINAL every compacted character came from.
 *
 * The near-miss this exists for is the common one: a model quoting a
 * sentence that wraps in the source hands back the two halves joined by
 * a single space, and a model quoting a list item drops the indentation.
 * Neither is a mistake worth refusing to mark over — but the anchor must
 * still be reported honestly as inexact, because "close enough to find"
 * is not "copied verbatim", and the panel says so.
 */
function compact(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let prevSpace = false;
  // A `>` that opens a line is a callout's continuation marker, and it
  // is dropped along with the whitespace. Guides put most of their prose
  // inside callouts, so a quoted sentence that wraps has a `>` sitting
  // in the MIDDLE of it — not at an edge, where a substring search would
  // have stepped over it. Without this the commonest quote in the
  // commonest construct anchors nowhere. Only at the start of a line:
  // a `>` inside a shell command or an arrow is text like any other.
  let atLineStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (atLineStart && ch === ">") continue;
    if (/\s/.test(ch)) {
      if (ch === "\n") atLineStart = true;
      if (prevSpace) continue;     // one space stands for the whole run
      out += " ";
      map.push(i);
      prevSpace = true;
    } else {
      out += ch.toLowerCase();
      map.push(i);
      prevSpace = false;
      atLineStart = false;
    }
  }
  return { text: out, map };
}

/**
 * Where `quote` sits in `body`, or undefined if it is not there.
 *
 * Exact first, so a quote genuinely copied out of the guide is reported
 * as exact even when a looser match would also have found it.
 */
export function locate(body: string, quote: string): Anchor | undefined {
  const q = quote.trim();
  if (!q || !body) return undefined;

  const exact = allIndexes(body, q);
  if (exact.length) {
    return { start: exact[0], end: exact[0] + q.length, exact: true, occurrences: exact.length };
  }

  const hay = compact(body);
  const needle = compact(q).text.trim();
  if (!needle) return undefined;
  const loose = allIndexes(hay.text, needle);
  if (!loose.length) return undefined;

  const at = loose[0];
  // map[] is per compacted character, so the end offset is the ORIGINAL
  // position of the last matched character plus one — not map[at + len],
  // which would be the character after the match and would swallow the
  // punctuation that follows it.
  return {
    start: hay.map[at],
    end: hay.map[at + needle.length - 1] + 1,
    exact: false,
    occurrences: loose.length,
  };
}

/** Every finding, with its place in the body where there is one. */
export function anchorFindings(body: string, findings: Finding[]): AnchoredFinding[] {
  return findings.map((f, id) => ({ ...f, id, anchor: locate(body, f.quote) }));
}

/**
 * Findings stamped with whether they could be located right now.
 *
 * Called once, when the review lands, against the body it reviewed.
 * Later passes compare against that stamp to separate "never existed"
 * from "fixed since".
 */
export function tagLocated(body: string, findings: Finding[]): Finding[] {
  return findings.map((f) => ({ ...f, locatedAtRun: !!locate(body, f.quote) }));
}

/** A character range of one source line, in the columns marks are written in. */
export interface LineSpan {
  /** 1-based, as the gutter numbers them. */
  line: number;
  /** 1-based. */
  startCol: number;
  /** 1-based, EXCLUSIVE — the half-open convention markSpan takes. */
  endCol: number;
}

/**
 * A character range as one span per line it covers.
 *
 * A quote can run across a line break, and the highlight layer is one
 * block per source line — there is no element spanning two of them, so
 * a multi-line finding is several marks, exactly as a multi-line
 * selection is several visual rows.
 *
 * Blank lines inside the range produce nothing: a zero-width mark would
 * be an underline under no characters.
 */
export function spanToMarks(body: string, start: number, end: number): LineSpan[] {
  if (!(end > start)) return [];
  const out: LineSpan[] = [];
  const lines = body.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = offset;
    const lineEnd = lineStart + lines[i].length;   // the \n is not part of the line
    offset = lineEnd + 1;
    if (lineEnd <= start) continue;
    if (lineStart >= end) break;
    const startCol = Math.max(start, lineStart) - lineStart + 1;
    const endCol = Math.min(end, lineEnd) - lineStart + 1;
    if (endCol > startCol) out.push({ line: i + 1, startCol, endCol });
  }
  return out;
}

// A quoted run is rarely the right thing to REWRITE. It is the evidence
// for a finding - a heading, a phrase, the three words that gave the
// problem away - and rewriting three words in isolation cannot address
// "this step never says which version". The block around it can: a model
// given the whole paragraph and the reviewer's complaint has somewhere to
// put a clarifying sentence.
//
// So the scope is the enclosing markdown block, blank-line delimited,
// which is also the unit an author would have selected by hand.
const MAX_SCOPE = 4000;

/**
 * The passage a finding's fix should be applied to.
 *
 * Falls back to the quoted span itself when the enclosing block is
 * enormous - a 4,000-character "paragraph" is a table, a fence or a
 * mis-formatted guide, and handing all of it to a rewrite risks far more
 * than the finding was about.
 */
export function applyScope(body: string, anchor: Anchor): { start: number; end: number } {
  const before = body.lastIndexOf("\n\n", anchor.start);
  let start = before === -1 ? 0 : before + 2;
  const after = body.indexOf("\n\n", anchor.end);
  let end = after === -1 ? body.length : after;

  // Leading and trailing whitespace belongs to the layout, not the
  // passage: sending it invites the model to return it differently.
  while (start < anchor.start && /\s/.test(body[start])) start++;
  while (end > anchor.end && /\s/.test(body[end - 1])) end--;

  if (end - start > MAX_SCOPE) return { start: anchor.start, end: anchor.end };
  return { start, end };
}

/**
 * What to ask the rewrite for, in the reviewer's own words.
 *
 * The finding is passed through rather than paraphrased. It is the only
 * thing in this loop that knows what is wrong, and a paraphrase of a
 * paraphrase is how "no version given" becomes "improve clarity".
 */
export function rewriteInstruction(f: Finding): string {
  const fix = f.fix ? ` Their suggested fix: ${f.fix}` : "";
  return (
    `A reviewer raised this problem with the passage below: ${f.issue}${fix} ` +
    "Apply it. You may add, remove or reorder text within the passage if the " +
    "fix requires it, but change nothing the problem does not touch."
  );
}

/** One finding, as the tooltip its marked lines carry. */
export function findingTooltip(f: Finding): string {
  const head = `AI review (${severityLabel(f.severity)}): ${f.issue}`;
  return f.fix ? `${head}\nFix: ${f.fix}` : head;
}

/**
 * The four states a finding can be in, which mean four different things
 * to the author and must not be run together in one list:
 *
 * - `located`  — found in the buffer, marked in the source.
 * - `fixed`    — matched when the review ran and does not now, so the
 *                text it objected to has been edited away.
 * - `general`  — no quote offered, because the finding is about the
 *                guide as a whole. Unanchorable by design, not a miss.
 * - `unlocated`— a quote was offered and the guide has never contained
 *                it. The model's own words are shown, because this is
 *                the group where a fabricated finding surfaces.
 */
export interface FindingGroups {
  located: AnchoredFinding[];
  fixed: AnchoredFinding[];
  general: AnchoredFinding[];
  unlocated: AnchoredFinding[];
}

export function groupFindings(findings: AnchoredFinding[]): FindingGroups {
  const groups: FindingGroups = { located: [], fixed: [], general: [], unlocated: [] };
  for (const f of findings) {
    if (f.anchor) groups.located.push(f);
    else if (!f.quote) groups.general.push(f);
    else if (f.locatedAtRun) groups.fixed.push(f);
    else groups.unlocated.push(f);
  }
  // Worst first within each group, holding the review's own order among
  // equals so the list does not reshuffle between renders.
  for (const key of Object.keys(groups) as (keyof FindingGroups)[]) {
    groups[key].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id - b.id,
    );
  }
  return groups;
}
