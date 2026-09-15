// Keep the editor and the preview looking at the same part of the lab.
//
// Guides run to thousands of words. Without this you scroll one pane,
// then hunt for your place in the other - which is most of the friction
// in a side-by-side editor.
//
// The mapping is PROPORTIONAL, not line-for-line. A line-accurate map
// would need every source line's rendered height, which means measuring
// the preview DOM on every keystroke; markdown's blocks are uneven
// enough (a fenced block is tall in both, a table is short in source and
// tall rendered) that the accurate version is a lot of machinery for a
// small gain over "same fraction down".

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Where `to` should sit so it shows the same fraction of its content as
 * `from` currently does.
 *
 * Returns 0 when either side has nothing to scroll: a short preview
 * beside a long source would otherwise divide by zero, and NaN assigned
 * to scrollTop silently pins the pane at the top forever.
 */
export function mappedScrollTop(from: ScrollBox, to: Pick<ScrollBox, "scrollHeight" | "clientHeight">): number {
  const fromMax = from.scrollHeight - from.clientHeight;
  const toMax = to.scrollHeight - to.clientHeight;
  if (fromMax <= 0 || toMax <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, from.scrollTop / fromMax));
  return Math.round(fraction * toMax);
}

/** True when the two are already close enough that moving would jitter. */
export function closeEnough(current: number, target: number, tolerance = 2): boolean {
  return Math.abs(current - target) <= tolerance;
}

/**
 * Wire two scrollers together. Returns a teardown.
 *
 * The hard part is the feedback loop: syncing A onto B makes B fire its
 * own scroll event, which syncs back onto A, which fires again. Each
 * round trip rounds a little differently and the panes fight, drifting
 * or juddering under the pointer.
 *
 * So one pane holds a lock while it is driving. The lock is released a
 * beat later rather than on the next frame: a smooth-scrolling wheel
 * emits a burst of events, and releasing too eagerly lets the far pane
 * grab the lock mid-gesture and start driving back.
 */
export function linkScrollers(a: HTMLElement, b: HTMLElement, releaseMs = 120): () => void {
  let driver: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const release = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { driver = null; timer = null; }, releaseMs);
  };

  const sync = (from: HTMLElement, to: HTMLElement) => () => {
    if (driver && driver !== from) return;
    driver = from;
    const target = mappedScrollTop(from, to);
    if (!closeEnough(to.scrollTop, target)) to.scrollTop = target;
    release();
  };

  const onA = sync(a, b);
  const onB = sync(b, a);
  a.addEventListener("scroll", onA, { passive: true });
  b.addEventListener("scroll", onB, { passive: true });

  return () => {
    a.removeEventListener("scroll", onA);
    b.removeEventListener("scroll", onB);
    if (timer) clearTimeout(timer);
  };
}
