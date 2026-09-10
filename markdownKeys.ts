// Markdown editing keys for the guide textarea.
//
// A bare <textarea> gives you none of the muscle memory every other
// editor has, so Ctrl+B typed a nothing and Enter after a bullet left
// you re-typing "- " a hundred times a lab. These are the keys that
// actually come up when writing workshop guides.
//
// Everything here is a PURE function over (text, selection) returning
// the next text plus where the caret should land, so the behaviour is
// testable without a DOM. `handleMarkdownKey` is the thin adapter that
// reads a KeyboardEvent and applies the result.

export interface EditState {
  text: string;
  start: number;
  end: number;
}

export interface EditResult {
  text: string;
  /** Selection after the edit. */
  start: number;
  end: number;
}

/** Line containing `pos`, as [lineStart, lineEnd) excluding the break. */
export function lineRangeAt(text: string, pos: number): [number, number] {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  const nl = text.indexOf("\n", pos);
  return [start, nl === -1 ? text.length : nl];
}

/**
 * Wrap (or unwrap) the selection in a marker — Ctrl+B, Ctrl+I.
 *
 * Toggling matters more than it sounds: authors bold a phrase, look at
 * the preview, change their mind. Without the unwrap they end up with
 * ****doubled**** markers that render as literal asterisks.
 */
export function toggleWrap(s: EditState, marker: string): EditResult {
  const { text, start, end } = s;
  const sel = text.slice(start, end);
  const before = text.slice(Math.max(0, start - marker.length), start);
  const after = text.slice(end, end + marker.length);

  // Already wrapped just outside the selection: take the markers off.
  if (before === marker && after === marker) {
    const next = text.slice(0, start - marker.length) + sel + text.slice(end + marker.length);
    return { text: next, start: start - marker.length, end: end - marker.length };
  }
  // Already wrapped inside the selection: take them off.
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2) {
    const inner = sel.slice(marker.length, sel.length - marker.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  const next = text.slice(0, start) + marker + sel + marker + text.slice(end);
  // No selection: land the caret between the markers, ready to type.
  return sel
    ? { text: next, start: start + marker.length, end: end + marker.length }
    : { text: next, start: start + marker.length, end: start + marker.length };
}

/**
 * Ctrl+K. With text selected it becomes the link label and the caret
 * lands in the URL slot; with nothing selected you get a skeleton with
 * "link text" selected so the first keystroke replaces it.
 */
export function insertLink(s: EditState): EditResult {
  const { text, start, end } = s;
  const sel = text.slice(start, end);
  if (sel) {
    const next = `${text.slice(0, start)}[${sel}]()${text.slice(end)}`;
    const caret = start + sel.length + 3; // inside the ()
    return { text: next, start: caret, end: caret };
  }
  const label = "link text";
  const next = `${text.slice(0, start)}[${label}]()${text.slice(end)}`;
  return { text: next, start: start + 1, end: start + 1 + label.length };
}

const BULLET_RE = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?(.*)$/;
const NUMBER_RE = /^(\s*)(\d+)([.)])(\s+)(.*)$/;

/**
 * Enter inside a list continues it; Enter on an empty item ends the
 * list instead of leaving a dangling marker. Returns null when the
 * caret isn't in a list, so the caller lets the key through.
 */
export function continueList(s: EditState): EditResult | null {
  const { text, start, end } = s;
  if (start !== end) return null;
  const [ls, le] = lineRangeAt(text, start);
  // Only continue from the END of the line — Enter mid-line is a split.
  if (start !== le) return null;
  const line = text.slice(ls, le);

  const bullet = BULLET_RE.exec(line);
  if (bullet) {
    const [, indent, mark, gap, task, body] = bullet;
    if (!body.trim()) {
      // Empty item: clear it and break out of the list.
      const next = text.slice(0, ls) + text.slice(le);
      return { text: next, start: ls, end: ls };
    }
    // A task list continues as an UNCHECKED task, never a copy of [x].
    const prefix = `${indent}${mark}${gap}${task ? "[ ] " : ""}`;
    const next = `${text.slice(0, start)}\n${prefix}${text.slice(end)}`;
    const caret = start + 1 + prefix.length;
    return { text: next, start: caret, end: caret };
  }

  const numbered = NUMBER_RE.exec(line);
  if (numbered) {
    const [, indent, num, delim, gap, body] = numbered;
    if (!body.trim()) {
      const next = text.slice(0, ls) + text.slice(le);
      return { text: next, start: ls, end: ls };
    }
    const prefix = `${indent}${Number(num) + 1}${delim}${gap}`;
    const next = `${text.slice(0, start)}\n${prefix}${text.slice(end)}`;
    const caret = start + 1 + prefix.length;
    return { text: next, start: caret, end: caret };
  }
  return null;
}

/** Tab / Shift+Tab over every line the selection touches. */
export function indent(s: EditState, out: boolean, unit = "  "): EditResult {
  const { text, start, end } = s;
  const [firstLine] = lineRangeAt(text, start);
  const [, lastLine] = lineRangeAt(text, end);
  const block = text.slice(firstLine, lastLine);
  const lines = block.split("\n");

  let firstDelta = 0;
  let total = 0;
  const shifted = lines.map((line, i) => {
    if (out) {
      const m = /^(\t| {1,2})/.exec(line);
      const removed = m ? m[1].length : 0;
      if (i === 0) firstDelta = -removed;
      total -= removed;
      return removed ? line.slice(removed) : line;
    }
    if (i === 0) firstDelta = unit.length;
    total += unit.length;
    return unit + line;
  });

  const next = text.slice(0, firstLine) + shifted.join("\n") + text.slice(lastLine);
  return {
    text: next,
    start: Math.max(firstLine, start + firstDelta),
    end: Math.max(firstLine, end + total),
  };
}

/**
 * Adapter: inspect a keydown on the textarea and, when it is one of
 * ours, return the edit to apply. Returns null to let the key through.
 */
export function handleMarkdownKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  s: EditState,
): EditResult | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case "b": return toggleWrap(s, "**");
      case "i": return toggleWrap(s, "*");
      case "k": return insertLink(s);
      default: break;
    }
  }
  if (e.key === "Tab" && !mod) return indent(s, e.shiftKey);
  if (e.key === "Enter" && !mod && !e.shiftKey) return continueList(s);
  return null;
}
