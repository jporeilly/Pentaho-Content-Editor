// Ranking for the command palette.
//
// The insert row carries ten menus over thirty-six blocks. On a 1100px
// window it wraps and pushes the last entry out of sight behind a 30px
// scroller nobody finds, and even when it all fits, reaching "Image —
// float right" is: read ten labels, guess which menu, open it, read
// nine more. The palette is the way in that does not depend on the row
// being complete — which is what then lets the row shrink.
//
// Scoring is deliberately boring and explicable. An author typing
// "image" should get the image blocks in an order they could have
// predicted, and two authors typing the same thing should get the same
// list. Anything cleverer is hard to trust and harder to debug.

export interface Command {
  id: string;
  /** What the author is looking for: "Image — centred". */
  label: string;
  /** The family it belongs to: "Media". Shown beside the label. */
  group: string;
  /** The tooltip text; searched, but ranked below label and group. */
  title?: string;
  run: () => void;
}

/**
 * Is `query` a subsequence of `text` — every character present, in
 * order, not necessarily adjacent? This is what lets "clt" find
 * "Callout" and "imgfl" find "Image — float left".
 */
export function subsequence(text: string, query: string): boolean {
  if (!query) return true;
  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i++;
    if (i === query.length) return true;
  }
  return false;
}

/**
 * Score one command against a query. Higher is better; 0 means no
 * match and the command is dropped.
 *
 * The tiers, best first:
 *   exact label · label prefix · label contains · group prefix ·
 *   "group label" contains · title contains · subsequence
 *
 * Within the "contains" tiers an earlier hit scores higher, so typing
 * "code" puts "Code block" above "Inline code".
 */
export function scoreCommand(cmd: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const label = cmd.label.toLowerCase();
  const group = cmd.group.toLowerCase();
  const title = (cmd.title ?? "").toLowerCase();
  const both = `${group} ${label}`;

  if (label === q) return 1000;
  if (label.startsWith(q)) return 900 - Math.min(99, label.length);
  const inLabel = label.indexOf(q);
  if (inLabel >= 0) return 700 - Math.min(99, inLabel);
  if (group.startsWith(q)) return 600;
  if (both.includes(q)) return 500;
  if (title.includes(q)) return 300;
  // Subsequence last: it matches almost anything, so it must never
  // outrank a real substring hit.
  if (subsequence(label, q)) return 150;
  if (subsequence(both, q)) return 100;
  return 0;
}

/**
 * Filter and order commands for a query.
 *
 * Ties keep their original order — the registry order is the order of
 * the menus, which authors already have a feel for. A sort that
 * reshuffled equal scores would make the list jump around as you type.
 */
export function rankCommands(commands: Command[], query: string): Command[] {
  return commands
    .map((cmd, index) => ({ cmd, index, score: scoreCommand(cmd, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((r) => r.cmd);
}

/** Move a selection by `delta`, wrapping at both ends. */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (((current + delta) % length) + length) % length;
}
