// A small dropdown-button menu for the insert toolbar.
//
// These used to be <select> elements. A select sizes itself to its
// WIDEST OPTION, so six of them ("Image — float right" etc.) claimed
// ~700px of a 590px editor column and wrapped into six stacked rows —
// 249px of toolbar above a 603px textarea. A button + popover sizes to
// its label, so the whole insert row fits on one line.

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  /** ReactNode so a palette can show a swatch beside the name. The key
   *  below needs a stable string, hence `id`. */
  label: ReactNode;
  /** Stable key when `label` is not a string. Defaults to the label. */
  id?: string;
  title?: string;
  onSelect: () => void;
}

interface MenuProps {
  label: ReactNode;
  title?: string;
  items: MenuItem[];
  disabled?: boolean;
  /**
   * Which insert family this menu belongs to ("heading", "callout",
   * "media"…). Surfaces as `data-tone` so author.css can give each one
   * its own hue. The insert row carries ten menus whose labels are all
   * the same size, weight and colour; a hue per family is what lets you
   * find "Media" without reading all ten. Purely decorative - the label
   * still says which is which, so colour is never the only signal.
   */
  tone?: string;
}

export function Menu({ label, title, items, disabled, tone }: MenuProps) {
  const [open, setOpen] = useState(false);
  // Where to paint the popover, in viewport coordinates.
  //
  // The popover CANNOT be a plain absolutely-positioned child: the
  // toolbar is an `overflow-x: auto` scroller so it can hold one row of
  // menus, and an overflow container clips absolutely-positioned
  // descendants — the menu opened but was invisible. `position: fixed`
  // escapes the clip (no transformed ancestor is in the way), which
  // means we have to measure the button ourselves.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: r.left });
  };

  // Close on outside click / Escape — a menu that survives a click
  // elsewhere feels stuck, and Escape is what authors reach for.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // A fixed-position popover doesn't follow its button, so close on
    // anything that would move it out from under the pointer.
    const reflow = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open]);

  return (
    <div className="author-menu" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={`author-menu-btn${open ? " is-open" : ""}`}
        data-tone={tone}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          place();
          setOpen((v) => !v);
        }}
      >
        {label}
        <span className="author-menu-caret" aria-hidden>▾</span>
      </button>
      {open && at && (
        <div className="author-menu-pop" role="menu" data-tone={tone} style={{ top: at.top, left: at.left }}>
          {items.map((it) => (
            <button
              key={it.id ?? String(it.label)}
              type="button"
              role="menuitem"
              className="author-menu-item"
              title={it.title}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
