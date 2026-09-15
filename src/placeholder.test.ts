import { describe, it, expect } from "vitest";

import { BLOCKS } from "./Toolbar";
import { placeholderRange } from "./placeholder";

// The toolbar selects a freshly inserted block's sample body so the
// author types over it. The range comes from probing the builder, not
// from anything a block declares, so these pin the probe against the
// real blocks: the ones with a sample, the ones without, and the
// round-trip that proves the range really is the placeholder.

type Block = (typeof BLOCKS)[number];

const byLabel = (group: string, label: string): Block => {
  const b = BLOCKS.find((x) => x.group === group && x.label === label);
  if (!b) throw new Error(`no block ${group}/${label}`);
  return b;
};

const placeholderOf = (b: Block): string | null => {
  const text = b.build("").text;
  const r = placeholderRange(b.build, text);
  return r && text.slice(r[0], r[1]);
};

describe("placeholderRange", () => {
  it("finds the sample body of blocks that take the selection", () => {
    expect(placeholderOf(byLabel("Code", "SQL"))).toBe("SELECT 1;");
    expect(placeholderOf(byLabel("Code", "PowerShell (.ps1)"))).toBe("Get-ChildItem C:\\Workshop");
    expect(placeholderOf(byLabel("Heading", "Step (H2)"))).toBe("Step title");
    expect(placeholderOf(byLabel("Block", "Link"))).toBe("link text");
    expect(placeholderOf(byLabel("Media", "Image — centred"))).toBe("alt text");
    expect(placeholderOf(byLabel("Media", "Video"))).toBe("Walkthrough");
  });

  it("finds nothing for blocks that ignore the selection", () => {
    for (const label of ["Tabs", "Table", "Divider"]) {
      expect(placeholderOf(byLabel("Block", label)), label).toBeNull();
    }
  });

  it("round-trips: building with the placeholder as the selection reproduces the default text", () => {
    let withSample = 0;
    for (const b of BLOCKS) {
      const text = b.build("").text;
      const r = placeholderRange(b.build, text);
      if (!r) continue;
      withSample += 1;
      const ph = text.slice(r[0], r[1]);
      expect(ph.length, b.label).toBeGreaterThan(0);
      expect(b.build(ph).text, b.label).toBe(text);
    }
    // Most blocks carry a sample; a regression that made the probe
    // return null everywhere would otherwise pass silently.
    expect(withSample).toBeGreaterThan(20);
  });

  it("refuses a builder that uses the selection twice", () => {
    const twice = (s: string) => ({ text: `[${s || "x"}](#${s || "x"})` });
    expect(placeholderRange(twice, twice("").text)).toBeNull();
  });
});
