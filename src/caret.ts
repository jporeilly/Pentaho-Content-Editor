// Putting the caret back after an edit made from a menu, a dialog or the
// AI — without moving the view.
//
// Every one of those paths ends the same way: the text changes, and the
// caret has to be re-placed because React has just rewritten the
// textarea's value. The obvious three lines — focus, select, done — have
// a bug in them that is invisible until you watch the frames:
//
//   f2  top 800  sel 0    active BODY       the value is replaced
//   f3  top 0    sel 463  active TEXTAREA   focus() scrolls to the caret
//
// A mouse click on a menu moves focus OFF the textarea (onto the button,
// which then unmounts, leaving focus on the body). Replacing the value
// of an UNFOCUSED textarea resets its selection to offset 0 — so the
// focus() that follows scrolls offset 0 into view, which is the top of
// the guide, and the setSelectionRange() a line later moves the caret
// without moving the scroll back. The author inserts a note half way
// down a lab and lands at the top of it, having lost their place.
//
// So the scroll is captured when the restore is SCHEDULED, not when it
// runs — by then a path that deliberately jumped (a review finding three
// screens away) has already moved it, and that jump is the position to
// keep — and it is re-asserted LAST, after the focus that would
// otherwise overrule it.
export function restoreCaret(
  ta: HTMLTextAreaElement | null | undefined,
  start: number,
  end: number = start,
): void {
  if (!ta) return;
  const top = ta.scrollTop;
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(start, end);
    ta.scrollTop = top;
  });
}
