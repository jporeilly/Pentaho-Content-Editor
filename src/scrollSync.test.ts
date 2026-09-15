import { describe, it, expect } from "vitest";

import { mappedScrollTop, closeEnough } from "./scrollSync";

const box = (scrollTop: number, scrollHeight: number, clientHeight: number) =>
  ({ scrollTop, scrollHeight, clientHeight });

describe("mappedScrollTop", () => {
  it("maps top to top and bottom to bottom", () => {
    const from = box(0, 2000, 500);
    const to = { scrollHeight: 4000, clientHeight: 800 };
    expect(mappedScrollTop(from, to)).toBe(0);
    expect(mappedScrollTop(box(1500, 2000, 500), to)).toBe(3200); // both fully scrolled
  });

  it("maps the midpoint to the midpoint even when the panes differ wildly", () => {
    // The source of a lab is usually taller than its rendering, or the
    // other way round once screenshots land. Same fraction, not same px.
    expect(mappedScrollTop(box(750, 2000, 500), { scrollHeight: 4000, clientHeight: 800 })).toBe(1600);
    expect(mappedScrollTop(box(1600, 4000, 800), { scrollHeight: 2000, clientHeight: 500 })).toBe(750);
  });

  it("returns 0 rather than NaN when a pane cannot scroll", () => {
    // A short preview beside a long source divides by zero, and NaN
    // assigned to scrollTop pins the pane at the top permanently.
    expect(mappedScrollTop(box(100, 2000, 500), { scrollHeight: 300, clientHeight: 300 })).toBe(0);
    expect(mappedScrollTop(box(0, 500, 500), { scrollHeight: 4000, clientHeight: 800 })).toBe(0);
    expect(Number.isNaN(mappedScrollTop(box(0, 0, 0), { scrollHeight: 0, clientHeight: 0 }))).toBe(false);
  });

  it("clamps overscroll instead of running past the end", () => {
    // Trackpads and rubber-banding report a scrollTop beyond the max.
    expect(mappedScrollTop(box(9999, 2000, 500), { scrollHeight: 4000, clientHeight: 800 })).toBe(3200);
    expect(mappedScrollTop(box(-50, 2000, 500), { scrollHeight: 4000, clientHeight: 800 })).toBe(0);
  });

  it("is a round number - scrollTop is assigned, not animated", () => {
    const v = mappedScrollTop(box(333, 2000, 500), { scrollHeight: 4000, clientHeight: 800 });
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe("closeEnough", () => {
  it("absorbs the sub-pixel difference that makes panes judder", () => {
    expect(closeEnough(100, 101)).toBe(true);
    expect(closeEnough(100, 98)).toBe(true);
    expect(closeEnough(100, 96)).toBe(false);
  });
});
