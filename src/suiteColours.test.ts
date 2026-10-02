import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { SECTION_COLOURS } from "./StructurePanel";
import { DEFAULT_EDITOR_THEME, themeDef } from "./theme";

// The suite look (1.25.0): Parchment is the Exam Bank's palette, it is the
// default, and colour carries a role. These read the stylesheet itself,
// because a token that quietly moved back is exactly the regression to
// catch and no component test would see it.
const css = readFileSync(new URL("./author.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("the suite look", () => {
  it("opens on Parchment, a light palette", () => {
    expect(DEFAULT_EDITOR_THEME).toBe("parchment");
    expect(themeDef("parchment").dark).toBe(false);
  });

  it("gives Parchment the Exam Bank's ground, text and teal accent", () => {
    const p = block(":root.author-theme-parchment");
    expect(p).toContain("--author-bg: #f6f3ec");
    expect(p).toContain("--author-text: #1f2a37");
    expect(p).toContain("--author-accent: #16707c");
  });

  it("defines every role colour for both kinds of ground", () => {
    for (const sel of [":root", ":root.author-light"]) {
      const b = css.slice(css.lastIndexOf(`${sel} {`));
      for (const role of ["ai", "add", "info", "bad"]) {
        expect(b, `${sel} --author-c-${role}`).toMatch(new RegExp(`--author-c-${role}:`));
      }
    }
  });

  it("has a colour for each section the sidebar cycles through", () => {
    for (let i = 0; i < SECTION_COLOURS; i++) {
      expect(css, `section ${i}`).toContain(`.author-sec-${i} { --section: var(--author-sec-${i}); }`);
      expect(css).toMatch(new RegExp(`--author-sec-${i}: #`));
    }
  });
});
