// After inserting a block with nothing selected, select its sample body
// so the author types straight over it instead of hunting for
// "SELECT 1;" or "Step title" in the text.
//
// Blocks only know how to build text from a selection; none declares
// where its placeholder is. Probing the builder with a sentinel
// selection reveals where a selection lands, and comparing lengths
// with the no-selection text gives the placeholder's length. Every
// block gets the behaviour for free, including ones added later.

// A NUL never occurs in a template, so its position is unambiguous.
const SENTINEL = "\u0000";

/**
 * Where the placeholder sits in `text` (the block built with an empty
 * selection), as [start, end) offsets into `text`. Null when the block
 * ignores the selection (Tabs, Table, Divider) or uses it in a way the
 * probe cannot pin down.
 */
export function placeholderRange(
  build: (sel: string) => { text: string },
  text: string,
): [number, number] | null {
  const probe = build(SENTINEL).text;
  const at = probe.indexOf(SENTINEL);
  if (at < 0) return null; // the builder ignores the selection
  if (probe.indexOf(SENTINEL, at + 1) >= 0) return null; // used twice: ambiguous
  const len = text.length - (probe.length - SENTINEL.length);
  if (len <= 0) return null;
  // Everything around the substitution point must agree, or the
  // builder did something cleverer than a plain substitution.
  if (probe.slice(0, at) !== text.slice(0, at)) return null;
  if (probe.slice(at + SENTINEL.length) !== text.slice(at + len)) return null;
  return [at, at + len];
}
