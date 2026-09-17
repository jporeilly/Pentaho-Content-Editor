// Turn step tracking on or off for ONE heading.
//
// The page-level ☑ Tracking button is a toggle, so the per-heading
// control has to be one too. Writing an untracked heading from the
// Heading menu covers the moment you type it; it does nothing for the
// fifty headings already in the guide, which is where the question
// actually comes up - "this Troubleshooting section should not be a
// step" is a thought you have while reading, not while typing.
//
// The marker is an HTML comment on the heading line
// (`## Troubleshooting <!-- no-step -->`), invisible in every renderer
// and carried along when the heading is renamed, moved or copied.
// MarkdownBody, guideBody.countSteps, course-authoring.mjs and
// api/core.py all read the same shape.

/** The marker, and the spellings to tolerate when reading one back. */
const NO_STEP = /\s*<!--\s*no-?step\s*-->\s*$/i;
const MARKER = " <!-- no-step -->";

/** A heading line, captured as hashes + text. Only h2/h3 are ever
 *  steps, so only those can be toggled - an H1 has no checkbox to
 *  remove and saying so is more useful than silently doing nothing. */
const HEADING = /^(#{1,6})\s+(.*)$/;

export interface HeadingToggle {
  /** The whole body with the one line rewritten. */
  text: string;
  /** Selection to restore: the heading's text, marker excluded. */
  start: number;
  end: number;
  /** What the line became, for the status message. */
  tracked: boolean;
  /** The heading's text without the marker, for the status message. */
  title: string;
}

/** Why the caret's line cannot be toggled, or null if it can. */
export type HeadingProblem = "not-a-heading" | "h1" | "h4-plus" | "tab-title";

/**
 * Is the line at `index` inside a `::: tabs` block?
 *
 * Because a `###` in there is a TAB TITLE, not a heading - it never
 * becomes a step and never gets a checkbox, so there is nothing to
 * toggle. Found by doing it: toggling the template workshop's
 * "Troubleshooting" tab wrote the marker straight into the tab's label,
 * where the learner reads it.
 *
 * Colon runs nest (`::::tabs` wrapping `:::tabs`), so this tracks a
 * stack keyed by run length rather than a boolean, and only runs opened
 * with "tabs" count.
 */
function insideTabs(body: string, lineStart: number): boolean {
  const open: number[] = [];
  let fenced = false;
  for (const line of body.slice(0, lineStart).split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = line.match(/^\s*(:{3,})\s*(\S*)/);
    if (!m) continue;
    const width = m[1].length;
    if (m[2]) {
      open.push(/^tabs/i.test(m[2]) ? width : -width);
    } else {
      // A bare run closes the innermost block of that width.
      const i = open.map(Math.abs).lastIndexOf(width);
      if (i !== -1) open.splice(i, 1);
    }
  }
  return open.some((w) => w > 0);
}

/**
 * Toggle the marker on the heading the caret sits in.
 *
 * Deliberately only the line the caret is ON - not the nearest heading
 * above it. "Toggle the section I am inside" sounds friendlier and is
 * unpredictable in a long guide: the caret is usually in the prose, and
 * an author who meant the heading three screens up will not see what
 * changed.
 */
export function toggleHeadingAt(
  body: string,
  caret: number,
): { ok: HeadingToggle } | { problem: HeadingProblem } {
  const lineStart = body.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  const nlAt = body.indexOf("\n", lineStart);
  const lineEnd = nlAt === -1 ? body.length : nlAt;
  const line = body.slice(lineStart, lineEnd);

  const m = line.match(HEADING);
  if (!m) return { problem: "not-a-heading" };
  if (m[1].length === 1) return { problem: "h1" };
  if (m[1].length > 3) return { problem: "h4-plus" };
  if (insideTabs(body, lineStart)) return { problem: "tab-title" };

  const hashes = m[1];
  const wasUntracked = NO_STEP.test(m[2]);
  const title = m[2].replace(NO_STEP, "").trimEnd();
  const rebuilt = `${hashes} ${title}${wasUntracked ? "" : MARKER}`;

  return {
    ok: {
      text: body.slice(0, lineStart) + rebuilt + body.slice(lineEnd),
      // Select the title only. The marker is machinery, and leaving it
      // highlighted invites someone to type over it.
      start: lineStart + hashes.length + 1,
      end: lineStart + hashes.length + 1 + title.length,
      tracked: wasUntracked,
      title,
    },
  };
}

/** Is the heading the caret is on currently tracked? `null` when the
 *  caret is not on a toggleable heading - the button reads "—" then. */
export function trackingStateAt(body: string, caret: number): boolean | null {
  const out = toggleHeadingAt(body, caret);
  return "ok" in out ? !out.ok.tracked : null;
}
