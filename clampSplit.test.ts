import { describe, expect, it } from "vitest";
import { clampSplit } from "./Splitter";

// The editor shell's two seams, as wired in App.tsx.
const SIDEBAR = { min: 180, max: 480, neighbourMin: 320 + 6 + 300 }; // 626
const EDITOR = { min: 320, max: 1400, neighbourMin: 300 + 6 };

const sidebar = (px: number, containerPx: number) =>
  clampSplit(px, SIDEBAR.min, SIDEBAR.max, containerPx, SIDEBAR.neighbourMin);
const editor = (px: number, containerPx: number) =>
  clampSplit(px, EDITOR.min, EDITOR.max, containerPx, EDITOR.neighbourMin);

describe("clampSplit", () => {
  it("passes a comfortable size straight through", () => {
    expect(editor(700, 1440)).toBe(700);
    expect(sidebar(300, 1440)).toBe(300);
  });

  it("holds the floor when the pointer drags past it", () => {
    expect(editor(40, 1440)).toBe(320);
    expect(sidebar(-200, 1440)).toBe(180);
  });

  it("holds the ceiling", () => {
    expect(sidebar(9999, 3000)).toBe(480);
    expect(editor(9999, 4000)).toBe(1400);
  });

  it("leaves the neighbour its room", () => {
    // 1000px of panes: the preview keeps 300 plus the 6px divider, so
    // the editor caps at 694.
    expect(editor(950, 1000)).toBe(694);
    // 1200px window: the editor+preview area keeps 626, sidebar caps at 574,
    // but its own max of 480 is tighter and wins.
    expect(sidebar(900, 1200)).toBe(480);
    // 800px window: 800 - 626 = 174 is below the sidebar's 180 floor.
    expect(sidebar(900, 800)).toBe(180);
  });

  it("applies the floor LAST, so a cramped window squeezes the neighbour", () => {
    // 500px of panes can't satisfy editor 320 + preview 306. The dragged
    // pane keeps its floor rather than collapsing to a 194px sliver —
    // flooring before the neighbour cap would have returned 194.
    expect(editor(400, 500)).toBe(320);
    expect(editor(400, 500)).toBeGreaterThanOrEqual(EDITOR.min);
  });

  it("never returns a negative width, even with no container measured yet", () => {
    expect(editor(500, 0)).toBe(320);
    expect(sidebar(500, 0)).toBe(180);
  });
});
