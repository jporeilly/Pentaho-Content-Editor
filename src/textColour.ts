// Applying and removing an author-chosen text colour.
//
// The colours themselves are the Engine's (`@app/components/textColours`)
// - one registry, so the palette the editor paints and the classes the
// stylesheet defines cannot drift apart. What lives here is the text
// manipulation: wrap a selection, or unwrap one that is already wrapped.
//
// Unwrapping is why this is a module rather than three lines inline. A
// colour picker that can only ADD is a trap: the author paints a phrase
// red, changes their mind, and the only way back is deleting markup by
// hand - the same hole the Text menu had before "Left-aligned" existed.
// Picking a second colour has to REPLACE the first rather than nest,
// and "None" has to actually remove it.

/** A `<span class="pcm-c-…">` around exactly the selection, or null. */
const WRAPPED = /^<span class="pcm-c-([a-z-]+)">([\s\S]*)<\/span>$/;

export interface ColourEdit {
  text: string;
  /** Selection to restore: the author's words, never the markup. */
  start: number;
  end: number;
}

/**
 * Colour `body`'s [start, end) with `name`, or strip the colour when
 * `name` is null.
 *
 * Looks just OUTSIDE the selection as well as inside it, because both
 * are how a selection ends up "already coloured": the author selected
 * the words (the span sits around them) or selected the whole span. The
 * caret positions returned always frame the words.
 */
export function applyColour(
  body: string,
  start: number,
  end: number,
  name: string | null,
): ColourEdit {
  let from = start;
  let to = end;
  let inner = body.slice(from, to);

  // Selected the words inside an existing span?
  const open = body.lastIndexOf('<span class="pcm-c-', from);
  if (open !== -1) {
    const openEnd = body.indexOf(">", open);
    const close = body.indexOf("</span>", to - 1);
    if (openEnd !== -1 && openEnd < from && close !== -1 && WRAPPED.test(body.slice(open, close + 7))) {
      from = open;
      to = close + 7;
      inner = body.slice(from, to);
    }
  }

  // Selected the whole span?
  const m = inner.match(WRAPPED);
  if (m) inner = m[2];

  const replacement = name === null ? inner : `<span class="pcm-c-${name}">${inner}</span>`;
  const text = body.slice(0, from) + replacement + body.slice(to);
  // Frame the words, not the markup: `<span class="pcm-c-red">` is 26
  // characters the author did not type and should not have selected.
  const offset = name === null ? 0 : `<span class="pcm-c-${name}">`.length;
  return { text, start: from + offset, end: from + offset + inner.length };
}

/** The colour on the selection right now, `null` for none. */
export function colourAt(body: string, start: number, end: number): string | null {
  const whole = body.slice(start, end).match(WRAPPED);
  if (whole) return whole[1];
  const open = body.lastIndexOf('<span class="pcm-c-', start);
  if (open === -1) return null;
  const openEnd = body.indexOf(">", open);
  const close = body.indexOf("</span>", end - 1);
  if (openEnd === -1 || openEnd >= start || close === -1) return null;
  const m = body.slice(open, close + 7).match(WRAPPED);
  return m ? m[1] : null;
}
