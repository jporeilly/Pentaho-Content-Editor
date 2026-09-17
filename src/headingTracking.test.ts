import { describe, it, expect } from "vitest";

import { toggleHeadingAt, trackingStateAt } from "./headingTracking";

// Toggling one heading's step checkbox. The page-level control is a
// toggle, so this is too - writing an untracked heading from the menu
// only helps at the moment you type it, and "this Troubleshooting
// section should not be a step" is a thought you have while reading a
// guide that is already written.

const ok = (body: string, caret: number) => {
  const out = toggleHeadingAt(body, caret);
  if ("problem" in out) throw new Error(`expected a toggle, got ${out.problem}`);
  return out.ok;
};

describe("toggleHeadingAt", () => {
  it("turns tracking off by marking the heading", () => {
    const body = "## Troubleshooting\n\nText.\n";
    const out = ok(body, 3);
    expect(out.text).toBe("## Troubleshooting <!-- no-step -->\n\nText.\n");
    expect(out.tracked).toBe(false);
  });

  it("turns it back on by removing the marker", () => {
    const body = "## Troubleshooting <!-- no-step -->\n\nText.\n";
    const out = ok(body, 3);
    expect(out.text).toBe("## Troubleshooting\n\nText.\n");
    expect(out.tracked).toBe(true);
  });

  it("round-trips to exactly the original text", () => {
    // A toggle that does not return you to where you started is a
    // toggle that quietly rewrites guides.
    const body = "### Set up your environment\n\nBody.\n";
    const off = ok(body, 5);
    const on = ok(off.text, 5);
    expect(on.text).toBe(body);
  });

  it("reads a marker written by hand, however it is spaced", () => {
    for (const marker of ["<!--no-step-->", "<!--  No-Step  -->", "<!-- nostep -->"]) {
      const out = ok(`## Notes ${marker}\n`, 3);
      expect(out.text, marker).toBe("## Notes\n");
      expect(out.tracked, marker).toBe(true);
    }
  });

  it("selects the title, not the marker", () => {
    const body = "## Troubleshooting\n";
    const out = ok(body, 3);
    expect(out.text.slice(out.start, out.end)).toBe("Troubleshooting");
    expect(out.title).toBe("Troubleshooting");
  });

  it("works from anywhere on the heading line", () => {
    const body = "## Troubleshooting\n\nText.\n";
    for (const caret of [0, 2, 8, 18]) {
      expect(ok(body, caret).text, `caret ${caret}`).toContain("<!-- no-step -->");
    }
  });

  it("acts on the line the caret is ON, never the heading above", () => {
    // Toggling "the section I am inside" is unpredictable in a long
    // guide: the caret is usually in prose, and the author would not
    // see what changed three screens up.
    const body = "## A heading\n\nProse the caret is in.\n";
    const out = toggleHeadingAt(body, body.indexOf("Prose") + 2);
    expect("problem" in out && out.problem).toBe("not-a-heading");
  });

  it("explains itself on an H1 rather than doing nothing", () => {
    const out = toggleHeadingAt("# Part Two\n", 3);
    expect("problem" in out && out.problem).toBe("h1");
  });

  it("explains itself on an H4", () => {
    const out = toggleHeadingAt("#### Deep\n", 3);
    expect("problem" in out && out.problem).toBe("h4-plus");
  });

  it("refuses a heading that is really a tab title", () => {
    // Found by doing it: the template workshop's Troubleshooting is a
    // tab, and toggling it wrote the marker into the label the learner
    // clicks. A ### in a tabs block never had a checkbox to remove.
    const body = "::: tabs\n\n### Troubleshooting\n\nText.\n\n:::\n";
    const out = toggleHeadingAt(body, body.indexOf("### Trouble") + 5);
    expect("problem" in out && out.problem).toBe("tab-title");
  });

  it("still toggles a heading AFTER the tabs block closes", () => {
    const body = "::: tabs\n\n### A tab\n\nText.\n\n:::\n\n## A real step\n";
    const out = ok(body, body.indexOf("## A real step") + 4);
    expect(out.text).toContain("## A real step <!-- no-step -->");
  });

  it("sees through nested colon runs", () => {
    // :::: wrapping ::: is the shape the courses use for parts.
    const body = "::::tabs\n\n### Outer\n\n:::tabs\n\n### Inner\n\n:::\n\n::::\n\n## After\n";
    expect(
      "problem" in toggleHeadingAt(body, body.indexOf("### Inner") + 5) &&
        (toggleHeadingAt(body, body.indexOf("### Inner") + 5) as any).problem,
    ).toBe("tab-title");
    expect(ok(body, body.indexOf("## After") + 3).text).toContain("## After <!-- no-step -->");
  });

  it("is not fooled by a colon run inside a code fence", () => {
    const body = "```\n::: tabs\n```\n\n## A real step\n";
    expect(ok(body, body.indexOf("## A real step") + 4).text).toContain("<!-- no-step -->");
  });
});

describe("trackingStateAt", () => {
  it("reports the current state, or null off a heading", () => {
    expect(trackingStateAt("## Step\n", 3)).toBe(true);
    expect(trackingStateAt("## Step <!-- no-step -->\n", 3)).toBe(false);
    expect(trackingStateAt("Just prose.\n", 3)).toBe(null);
  });
});
