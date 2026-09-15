import { describe, expect, it } from "vitest";
import {
  continueList, indent, insertLink, lineRangeAt, toggleWrap, handleMarkdownKey,
} from "./markdownKeys";

const at = (text: string, start: number, end = start) => ({ text, start, end });

describe("toggleWrap", () => {
  it("wraps a selection", () => {
    expect(toggleWrap(at("make bold now", 5, 9), "**")).toMatchObject({
      text: "make **bold** now", start: 7, end: 11,
    });
  });

  it("unwraps when the markers sit just outside the selection", () => {
    // Selecting the word inside **bold** and pressing Ctrl+B again.
    expect(toggleWrap(at("make **bold** now", 7, 11), "**").text).toBe("make bold now");
  });

  it("unwraps when the markers are inside the selection", () => {
    expect(toggleWrap(at("make **bold** now", 5, 13), "**").text).toBe("make bold now");
  });

  it("leaves the caret between the markers with no selection", () => {
    const r = toggleWrap(at("a ", 2), "**");
    expect(r.text).toBe("a ****");
    expect(r.start).toBe(4);
    expect(r.end).toBe(4);
  });

  it("handles italics with a single marker", () => {
    expect(toggleWrap(at("an word", 3, 7), "*").text).toBe("an *word*");
  });
});

describe("insertLink", () => {
  it("uses the selection as the label and puts the caret in the URL", () => {
    const r = insertLink(at("see the docs", 8, 12));
    expect(r.text).toBe("see the [docs]()");
    expect(r.text.slice(r.start, r.end)).toBe("");
    expect(r.start).toBe(15); // between the parens
  });

  it("selects the placeholder label when nothing is selected", () => {
    const r = insertLink(at("", 0));
    expect(r.text).toBe("[link text]()");
    expect(r.text.slice(r.start, r.end)).toBe("link text");
  });
});

describe("continueList", () => {
  it("continues a bullet", () => {
    const r = continueList(at("- first", 7));
    expect(r?.text).toBe("- first\n- ");
    expect(r?.start).toBe(10);
  });

  it("continues a numbered item with the next number", () => {
    expect(continueList(at("3. third", 8))?.text).toBe("3. third\n4. ");
  });

  it("preserves indentation of a nested bullet", () => {
    expect(continueList(at("  - nested", 10))?.text).toBe("  - nested\n  - ");
  });

  it("continues a task list UNCHECKED, never copying [x]", () => {
    expect(continueList(at("- [x] done", 10))?.text).toBe("- [x] done\n- [ ] ");
  });

  it("ends the list on an empty item instead of dangling a marker", () => {
    // Enter on "- " with nothing typed clears the line.
    expect(continueList(at("- first\n- ", 10))?.text).toBe("- first\n");
  });

  it("passes through outside a list", () => {
    expect(continueList(at("just prose", 10))).toBeNull();
  });

  it("passes through mid-line, where Enter means split", () => {
    expect(continueList(at("- first", 4))).toBeNull();
  });
});

describe("indent", () => {
  it("indents every line the selection touches", () => {
    const r = indent(at("- a\n- b", 0, 7), false);
    expect(r.text).toBe("  - a\n  - b");
  });

  it("outdents", () => {
    expect(indent(at("  - a\n  - b", 0, 11), true).text).toBe("- a\n- b");
  });

  it("outdenting an unindented line is a no-op, not a corruption", () => {
    expect(indent(at("- a", 0, 3), true).text).toBe("- a");
  });
});

describe("lineRangeAt", () => {
  it("finds the line around a position", () => {
    expect(lineRangeAt("one\ntwo\nthree", 5)).toEqual([4, 7]);
  });
});

describe("handleMarkdownKey", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

  it("maps Ctrl+B to bold", () => {
    expect(handleMarkdownKey(key("b", { ctrlKey: true }), at("x", 0, 1))?.text).toBe("**x**");
  });

  it("maps Cmd+I to italics", () => {
    expect(handleMarkdownKey(key("i", { metaKey: true }), at("x", 0, 1))?.text).toBe("*x*");
  });

  it("ignores plain typing", () => {
    expect(handleMarkdownKey(key("b"), at("x", 1))).toBeNull();
  });

  it("ignores Ctrl+S so the save handler still gets it", () => {
    expect(handleMarkdownKey(key("s", { ctrlKey: true }), at("x", 1))).toBeNull();
  });

  it("leaves Shift+Enter alone for a hard line break", () => {
    expect(handleMarkdownKey(key("Enter", { shiftKey: true }), at("- a", 3))).toBeNull();
  });
});
