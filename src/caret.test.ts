import { describe, it, expect, vi, afterEach } from "vitest";

import { restoreCaret } from "./caret";

// A textarea that records the ORDER of what is done to it, because the
// order is the whole bug: focusing scrolls the caret into view, so a
// scroll position restored before the focus is overruled by it.
function fakeTextarea(scrollTop = 800) {
  const calls: string[] = [];
  let top = scrollTop;
  return {
    calls,
    el: {
      focus() { calls.push("focus"); top = 0; },   // what the browser does
      setSelectionRange(s: number, e: number) { calls.push(`select ${s}-${e}`); },
      get scrollTop() { return top; },
      set scrollTop(v: number) { calls.push(`scroll ${v}`); top = v; },
    } as unknown as HTMLTextAreaElement,
    get top() { return top; },
  };
}

function runFrame() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  return () => frames.forEach((cb) => cb(0));
}

afterEach(() => vi.unstubAllGlobals());

describe("restoreCaret", () => {
  it("puts the view back after the focus, not before", () => {
    const flush = runFrame();
    const ta = fakeTextarea(800);
    restoreCaret(ta.el, 463);
    flush();
    expect(ta.calls).toEqual(["focus", "select 463-463", "scroll 800"]);
    expect(ta.top).toBe(800);
  });

  it("keeps the position the pane was at when the edit was made", () => {
    // Not the position at frame time: a path that jumped deliberately
    // (a review finding three screens away) has already moved the pane,
    // and that is the position to keep.
    const flush = runFrame();
    const ta = fakeTextarea(1200);
    restoreCaret(ta.el, 10, 40);
    ta.el.scrollTop = 0; // something else moves it in between
    flush();
    expect(ta.top).toBe(1200);
  });

  it("selects a range when given one", () => {
    const flush = runFrame();
    const ta = fakeTextarea(0);
    restoreCaret(ta.el, 10, 40);
    flush();
    expect(ta.calls).toContain("select 10-40");
  });

  it("does nothing without a textarea", () => {
    const flush = runFrame();
    expect(() => { restoreCaret(null, 0); flush(); }).not.toThrow();
    expect(() => { restoreCaret(undefined, 0); flush(); }).not.toThrow();
  });
});
