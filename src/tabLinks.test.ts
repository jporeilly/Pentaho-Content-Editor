import { describe, it, expect } from "vitest";

import { tabsInBody, tabLink } from "./tabLinks";
import { tabAnchorIds } from "@app/components/Tabs";

// Linking to a tab, and the half of the contract that lives here.
//
// A `### Title` inside a `::: tabs` block is a TAB, not a heading. The
// Engine gives it an anchor derived from its title so a guide can say
// `[see Troubleshooting](#tab-troubleshooting)`; this module finds those
// tabs in the source so the editor can offer them by name instead of
// making an author guess the slug and learn at review time whether the
// guess was right.
//
// The slug rule is mirrored, which this project has learned to distrust:
// countSteps had four copies and three were wrong, detectHasVideo had
// two and they disagreed about Vimeo. So the last test here imports the
// Engine's real implementation through @app and asserts the two agree -
// the same shape as the code-menu contract.

describe("tabsInBody", () => {
  it("finds the tabs and the anchor that reaches each", () => {
    const body = "::: tabs\n\n### Windows\n\nDo this.\n\n### macOS\n\nDo that.\n\n:::\n";
    expect(tabsInBody(body).map((t) => [t.title, t.slug])).toEqual([
      ["Windows", "tab-windows"],
      ["macOS", "tab-macos"],
    ]);
  });

  it("ignores headings outside a tabs block", () => {
    const body = "## A real step\n\n### A sub-step\n\n::: tabs\n\n### A tab\n\n:::\n\n### After\n";
    expect(tabsInBody(body).map((t) => t.title)).toEqual(["A tab"]);
  });

  it("reads nested colon runs, which is how the courses write parts", () => {
    const body = "::::tabs\n\n### Outer\n\n:::tabs\n\n### Inner\n\n:::\n\n::::\n";
    expect(tabsInBody(body).map((t) => t.title)).toEqual(["Outer", "Inner"]);
  });

  it("is not fooled by a tabs block inside a code fence", () => {
    const body = "```\n::: tabs\n### Not a tab\n```\n\n::: tabs\n\n### Real\n\n:::\n";
    expect(tabsInBody(body).map((t) => t.title)).toEqual(["Real"]);
  });

  it("numbers duplicate titles so the menu does not show two of the same", () => {
    const body = "::: tabs\n\n### Windows\n\n:::\n\n::: tabs\n\n### Windows\n\n:::\n";
    expect(tabsInBody(body).map((t) => t.slug)).toEqual(["tab-windows", "tab-windows-2"]);
  });

  it("reports the source line, so the editor can jump there too", () => {
    const body = "intro\n\n::: tabs\n\n### Windows\n\n:::\n";
    expect(tabsInBody(body)[0].line).toBe(5);
  });

  it("finds nothing in a guide with no tabs", () => {
    expect(tabsInBody("## Just a step\n\nProse.\n")).toEqual([]);
  });
});

describe("tabLink", () => {
  it("writes the markdown an author would otherwise hand-type", () => {
    const [tab] = tabsInBody("::: tabs\n\n### Troubleshooting\n\n:::\n");
    expect(tabLink(tab)).toBe("[Troubleshooting](#tab-troubleshooting)");
  });
});

describe("the slug agrees with the Engine's", () => {
  it("matches tabAnchorIds for the same titles", () => {
    // The assertion that matters. If the Engine's rule moves, the links
    // this editor writes stop resolving - silently, because a dead
    // anchor scrolls nowhere and reports nothing.
    const titles = [
      "Windows", "macOS / Linux", "Troubleshooting",
      "Step 1 — Extract", "  padded  ", "###", "Ünïcodé",
    ];
    const body = `::: tabs\n\n${titles.map((t) => `### ${t}\n\nbody.\n`).join("\n")}\n:::\n`;
    const mine = tabsInBody(body).map((t) => t.slug);
    expect(mine).toEqual(tabAnchorIds(titles));
  });
});
