// Find and replace over the guide body.
//
// The editor had none, so every text sweep meant opening the lab in
// another editor — which is exactly the situation the save guards exist
// to survive, since a second surface holding an older copy is how an
// afternoon's work went over the side on 2026-09-03.
//
// Plain substring search, not regex. Guides are full of markdown
// punctuation — `**`, `[`, `(`, `.`, `$`, `|` — and an author typing
// `**Note:**` into a regex box gets either an error or silence. If
// regex is ever wanted it should be an explicit opt-in toggle, not the
// default reading of what was typed.

export interface Match {
  start: number;
  end: number;
}

export interface FindOptions {
  caseSensitive?: boolean;
}

/**
 * Every non-overlapping occurrence of `needle`, left to right.
 *
 * Non-overlapping matters: "aa" occurs twice in "aaaa", not three
 * times. Replacing three overlapping matches would corrupt the text,
 * and the count shown in the bar would not match what Replace all did.
 */
export function findMatches(text: string, needle: string, opts: FindOptions = {}): Match[] {
  // An empty needle matches at every position, which would both flood
  // the count and spin forever in the loop below.
  if (!needle) return [];

  const hay = opts.caseSensitive ? text : text.toLowerCase();
  const pin = opts.caseSensitive ? needle : needle.toLowerCase();

  const out: Match[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(pin, from);
    if (at === -1) break;
    out.push({ start: at, end: at + pin.length });
    from = at + pin.length;
  }
  return out;
}

/**
 * Index of the match to move to from caret position `caret`.
 *
 * Forward lands on the first match starting at or after the caret;
 * backward on the last one starting before it. Both wrap, because a
 * search that stops dead at the end of the file makes you scroll back
 * to the top by hand.
 */
export function nextMatch(matches: Match[], caret: number, direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  if (direction === 1) {
    const i = matches.findIndex((m) => m.start >= caret);
    return i === -1 ? 0 : i;
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].start < caret) return i;
  }
  return matches.length - 1;
}

/** Replace a single match, returning the new text and where the caret lands. */
export function replaceAt(text: string, match: Match, replacement: string): { text: string; caret: number } {
  return {
    text: text.slice(0, match.start) + replacement + text.slice(match.end),
    caret: match.start + replacement.length,
  };
}

/**
 * Replace every occurrence.
 *
 * Built from the match list rather than String.replaceAll so that a
 * replacement CONTAINING the needle cannot be rescanned — replacing
 * "lab" with "lab guide" one pass at a time grows forever. Splicing
 * from a fixed list of positions terminates by construction.
 *
 * Right to left, so each splice leaves the earlier offsets valid.
 */
export function replaceAll(
  text: string,
  needle: string,
  replacement: string,
  opts: FindOptions = {},
): { text: string; count: number } {
  const matches = findMatches(text, needle, opts);
  if (matches.length === 0) return { text, count: 0 };

  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    out = out.slice(0, m.start) + replacement + out.slice(m.end);
  }
  return { text: out, count: matches.length };
}

/** "3 of 12", or a plain count when nothing is selected yet. */
export function matchLabel(matches: Match[], current: number): string {
  if (matches.length === 0) return "no matches";
  if (current < 0) return `${matches.length} match${matches.length === 1 ? "" : "es"}`;
  return `${current + 1} of ${matches.length}`;
}
