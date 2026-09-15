import { describe, expect, it } from "vitest";

import { buildTable, findTableAt, parseAlign, renderTable, splitRow, tidyTableAt } from "./tableBuilder";

describe("splitRow", () => {
  it("splits on pipes and trims, with or without outer pipes", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("keeps an escaped pipe inside a cell", () => {
    // A cell that documents a shell pipe would otherwise split in two.
    expect(splitRow("| ps \\| grep x | note |")).toEqual(["ps \\| grep x", "note"]);
  });
});

describe("parseAlign", () => {
  it("reads the colons", () => {
    expect(parseAlign("---")).toBe("left");
    expect(parseAlign(":---")).toBe("left");
    expect(parseAlign(":---:")).toBe("center");
    expect(parseAlign("---:")).toBe("right");
  });
});

describe("renderTable", () => {
  it("pads every column to its widest cell", () => {
    const out = renderTable([["Step", "What it does"], ["1", "Reads the file"]], []);
    const [head, delim, row] = out.split("\n");
    expect(head.length).toBe(delim.length);
    expect(head.length).toBe(row.length);
    expect(head).toBe("| Step | What it does   |");
  });

  it("writes the alignment markers and aligns the text with them", () => {
    const out = renderTable([["n", "name"], ["1", "ada"]], ["right", "center"]);
    const lines = out.split("\n");
    expect(lines[1]).toContain("---:");
    expect(lines[1]).toContain(":---");
    // right-aligned cell is padded on the left
    expect(lines[2].startsWith("|    1 |")).toBe(true);
  });

  it("squares off a ragged grid rather than emitting a broken table", () => {
    const out = renderTable([["a", "b", "c"], ["1"]], []);
    for (const l of out.split("\n")) {
      expect(l.split("|").length).toBe(5); // 3 cells => 4 pipes => 5 parts
    }
  });
});

describe("buildTable", () => {
  it("builds the requested shape with placeholders", () => {
    const t = buildTable(3, 2);
    const lines = t.trimEnd().split("\n");
    expect(lines).toHaveLength(4); // header + delimiter + 2 rows
    expect(lines[0]).toContain("Column 3");
    expect(t.endsWith("\n\n")).toBe(true); // a blank line after, as markdown needs
  });
});

describe("findTableAt / tidyTableAt", () => {
  const doc = [
    "Intro line.",
    "",
    "| Step | What it does |",
    "| --- | ---: |",
    "| 1 | Reads |",
    "| 2 | Writes |",
    "",
    "After.",
  ].join("\n");

  it("finds the table the caret is inside, and its alignment", () => {
    const caret = doc.indexOf("Reads");
    const span = findTableAt(doc, caret)!;
    expect(span).not.toBeNull();
    expect(span.rows).toHaveLength(3); // header + 2 body rows, delimiter dropped
    expect(span.align).toEqual(["left", "right"]);
  });

  it("returns null when the caret is in prose", () => {
    expect(findTableAt(doc, doc.indexOf("Intro"))).toBeNull();
    expect(findTableAt(doc, doc.indexOf("After."))).toBeNull();
  });

  it("does not treat a pipe in prose as a table", () => {
    const prose = "Run `ps | grep node` and wait.";
    expect(findTableAt(prose, 5)).toBeNull();
  });

  it("needs a real delimiter row, not just two piped lines", () => {
    const notATable = "| a | b |\n| c | d |";
    expect(findTableAt(notATable, 2)).toBeNull();
  });

  it("tidies in place, leaving the surrounding document alone", () => {
    const out = tidyTableAt(doc, doc.indexOf("Reads"))!;
    expect(out).not.toBeNull();
    expect(out.text.startsWith("Intro line.\n\n")).toBe(true);
    expect(out.text.trimEnd().endsWith("After.")).toBe(true);
    const table = out.text.slice(out.start, out.end).split("\n");
    expect(table[0].length).toBe(table[1].length);
    expect(table[0].length).toBe(table[2].length);
    expect(table[1]).toContain("---:"); // alignment survives the tidy
  });

  it("is idempotent - tidying a tidy table changes nothing", () => {
    const once = tidyTableAt(doc, doc.indexOf("Reads"))!;
    const twice = tidyTableAt(once.text, once.start + 5)!;
    expect(twice.text).toBe(once.text);
  });
});
