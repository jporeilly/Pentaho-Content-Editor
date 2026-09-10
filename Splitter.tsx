// Draggable pane dividers for the editor shell.
//
// The layout used to be hard-coded: a 260px sidebar and a 50/50
// editor/preview grid. Authoring swings between "I'm writing prose"
// (want a wide editor) and "I'm checking how it renders" (want a wide
// preview), so both seams are now draggable and remembered per browser.
//
// Sizes are stored in localStorage as plain pixel numbers. Double-click
// a handle to return it to its default.

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keep a dragged pane size inside sensible bounds.
 *
 * Order matters. The ceiling and the neighbour cap are applied first,
 * the floor LAST — so on a window too narrow to satisfy both panes the
 * dragged pane holds its floor and the neighbour takes the squeeze.
 * Flooring first would let the neighbour cap undo it and leave a
 * useless sliver.
 *
 * @param px           the raw size the pointer is asking for, in pixels
 * @param min          the smallest useful size for this pane
 * @param max          the largest useful size for this pane
 * @param containerPx  width of the whole splitter container right now
 * @param neighbourMin room to leave for everything on the other side of
 *                     the divider. This can't be derived from `min` —
 *                     the sidebar's neighbour is the editor AND the
 *                     preview, the editor's neighbour is the preview
 *                     alone — so each call site declares it.
 */
export function clampSplit(
  px: number,
  min: number,
  max: number,
  containerPx: number,
  neighbourMin: number,
): number {
  const capped = Math.min(px, max, containerPx - neighbourMin);
  return Math.max(capped, min);
}

interface SplitterProps {
  /** Pointer drag delta is applied to this, in px. */
  onDrag: (nextPx: number) => void;
  /** Current size of the pane being resized, in px. */
  value: number;
  /** Double-click restores this. */
  onReset: () => void;
  label: string;
}

export function Splitter({ onDrag, value, onReset, label }: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, value: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      startRef.current = { x: e.clientX, value };
      setDragging(true);
    },
    [value],
  );

  // Track on the window, not the handle: the pointer routinely leaves a
  // 6px-wide strip mid-drag.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      onDrag(startRef.current.value + (e.clientX - startRef.current.x));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Stops the textarea/preview text from being selected while dragging.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, onDrag]);

  return (
    <div
      className={`author-splitter${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      // Keyboard resize, 24px a nudge — a drag handle nobody can reach
      // from the keyboard is a dead control for some authors.
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") { e.preventDefault(); onDrag(value - 24); }
        if (e.key === "ArrowRight") { e.preventDefault(); onDrag(value + 24); }
        if (e.key === "Home") { e.preventDefault(); onReset(); }
      }}
    />
  );
}

/**
 * A remembered pane width that survives a window resize.
 *
 * Two numbers, deliberately kept apart:
 *
 *   • `desired` — what the author last dragged to, bounded only by the
 *     pane's own min/max. This is what gets persisted.
 *   • the returned `px` — `desired` additionally capped against the
 *     container as it is RIGHT NOW.
 *
 * Persisting the capped value instead would be destructive: shrink the
 * window once and the author's 900px editor is rewritten to 600px,
 * then widening the window leaves it stuck there. Keeping the wish
 * separate from what currently fits means a narrow window borrows the
 * space and a wide one gives it straight back.
 */
export function useSplit(
  key: string,
  initial: number,
  min: number,
  max: number,
  neighbourMin: number,
) {
  const [desired, setDesired] = useState<number>(() => {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : initial;
  });
  const [containerPx, setContainerPx] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Track the container's live width.
  //
  // This has to be a CALLBACK ref, not a `useEffect` over a ref object:
  // the editor seam's container (`.author-panes`) isn't in the tree on
  // first mount — no lab has loaded yet — so an effect with an empty
  // dep array measures `null`, bails, and never observes anything. The
  // pane then keeps a stale width forever and the preview can be
  // squeezed to zero on a narrow window. A callback ref runs again the
  // moment the node appears (and on every remount, e.g. switching to
  // the Welcome pane).
  //
  // For the editor seam the observed element's width also changes when
  // the SIDEBAR is dragged, so this keeps the editor honest when its
  // neighbour on the far side moves. No feedback loop: the container's
  // width doesn't depend on the flex-basis this hook drives inside it.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    setContainerPx(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerPx(w);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const px = containerPx > 0
    ? clampSplit(desired, min, max, containerPx, neighbourMin)
    : Math.min(Math.max(desired, min), max);

  const set = useCallback(
    (next: number) => {
      // Store the wish bounded by this pane's own limits only — never
      // by the container, or a resize would erode it permanently.
      const bounded = Math.min(Math.max(next, min), max);
      setDesired(bounded);
      try { localStorage.setItem(key, String(bounded)); } catch { /* best effort */ }
    },
    [key, min, max],
  );

  const reset = useCallback(() => {
    setDesired(initial);
    try { localStorage.setItem(key, String(initial)); } catch { /* best effort */ }
  }, [key, initial]);

  return { px, set, reset, containerRef };
}
