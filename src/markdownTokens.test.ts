import { describe, it, expect } from "vitest";

import { highlightMarkdown } from "./markdownTokens";

/** Undo the highlighter: strip spans, unescape entities. */
function plain(html: string): string {
  return html
    .replace(/<span class="tok-[a-z]+">/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Which tone a line was given, or "" for untoned body text. */
function toneOf(body: string, lineIndex = 0): string {
  const line = highlightMarkdown(body).split("\n")[lineIndex];
  return /^<span class="tok-([a-z]+)">/.exec(line)?.[1] ?? "";
}

describe("highlightMarkdown — text fidelity", () => {
  // THE invariant. The highlight layer sits behind a transparent
  // textarea; if a single character is added, dropped or moved, the
  // colours slide out from under the text and the caret lands in the
  // wrong colour. Everything else is cosmetic next to this.
  const bodies: [string, string][] = [
    ["a heading", "# Title\n\nSome body text.\n"],
    ["lists", "- one\n- two **bold**\n1. first\n- [ ] todo\n- [x] done\n"],
    ["a callout", "> **Note:**\n>\n> Body of the note.\n"],
    ["code fence", "```sql\nSELECT * FROM t WHERE a < 3 AND b > 1;\n```\n"],
    ["html block", '<figure class="pcm-float-left">\n\n![alt](../x.png)\n\n</figure>\n'],
    ["a table", "| a | b |\n| --- | --- |\n| 1 | 2 |\n"],
    ["entities", "5 < 6 && 7 > 2 — a & b\n"],
    ["trailing newlines", "one\n\n\n"],
    ["no trailing newline", "just one line"],
    ["empty", ""],
    ["only newlines", "\n\n\n"],
    ["windows-ish text", "line one\nline two\n"],
    ["unicode", "café — naïve 日本語 🎉\n"],
  ];

  for (const [name, body] of bodies) {
    it(`round-trips ${name} unchanged`, () => {
      const round = plain(highlightMarkdown(body));
      // The trailing space is deliberate padding for a <pre> that ends
      // in a newline; it is the one permitted difference.
      expect(round === body || round === body + " ").toBe(true);
    });
  }

  it("never lets a stray < open a tag in the layer", () => {
    const html = highlightMarkdown("if a <b> then\n");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toMatch(/<b>/);
  });

  it("pads a body ending in a newline so the last line keeps its height", () => {
    // Without this a <pre> renders one line shorter than the textarea
    // and every colour below the fold slides up by a line.
    expect(highlightMarkdown("x\n").endsWith(" ")).toBe(true);
    expect(highlightMarkdown("x").endsWith(" ")).toBe(false);
  });
});

describe("highlightMarkdown — tones match the insert families", () => {
  it("tones headings, callouts and lists", () => {
    expect(toneOf("## Step one")).toBe("heading");
    expect(toneOf("> **Note:** something")).toBe("callout");
    expect(toneOf("- a bullet")).toBe("list");
    expect(toneOf("1. numbered")).toBe("list");
    expect(toneOf("- [ ] a task")).toBe("list");
  });

  it("tones block structure", () => {
    expect(toneOf("| a | b |")).toBe("block");
    expect(toneOf("::: tabs")).toBe("block");
    expect(toneOf("---")).toBe("block");
    expect(toneOf("<figure>")).toBe("block");
    expect(toneOf("<!-- AUTHOR NOTES -->")).toBe("block");
  });

  it("tones a Pentaho button above the generic HTML rule", () => {
    // These are the inserts whose exact spelling decides behaviour, so
    // they must not disappear into the general run of HTML.
    expect(toneOf('<button data-launch="spoon" data-path="files/x.ktr">Open</button>')).toBe("pentaho");
    expect(toneOf('<button data-graph="files/x.ktr">Graph</button>')).toBe("pentaho");
    expect(toneOf('<div data-env-check="tryit"></div>')).toBe("pentaho");
  });

  it("treats a whole fenced block as code, markers included", () => {
    const html = highlightMarkdown("```bash\n# not a heading\necho hi\n```\n");
    const lines = html.split("\n");
    for (let i = 0; i < 4; i++) {
      expect(lines[i], `line ${i}`).toContain('class="tok-code"');
    }
    // The # inside the fence is a shell comment, NOT a heading.
    expect(lines[1]).not.toContain("tok-heading");
  });

  it("closes a fence only on a matching marker", () => {
    // A ~~~ inside a ``` block does not end it.
    const html = highlightMarkdown("```\n~~~\nstill code\n```\nafter\n");
    const lines = html.split("\n");
    expect(lines[2]).toContain("tok-code");
    expect(lines[4]).not.toContain("tok-code");
  });

  it("colours the list marker but leaves the text its own inline tones", () => {
    const html = highlightMarkdown("- a **bold** word");
    expect(html).toContain('<span class="tok-list">- </span>');
    expect(html).toContain('<span class="tok-text">**bold**</span>');
  });

  it("tones inline code, links and images", () => {
    expect(highlightMarkdown("use `npm run dev` now")).toContain('<span class="tok-code">`npm run dev`</span>');
    expect(highlightMarkdown("see [docs](http://x)")).toContain('<span class="tok-media">[docs](http://x)</span>');
    expect(highlightMarkdown("![alt](x.png)")).toContain('<span class="tok-media">![alt](x.png)</span>');
  });

  it("does not nest a span inside another span's markup", () => {
    // A chain of replaces would re-scan already-emitted markup and put
    // a span inside a class attribute.
    const html = highlightMarkdown("**bold** and `code` and *it*");
    expect(html).not.toMatch(/class="tok-[a-z]*<span/);
    expect(plain(html)).toBe("**bold** and `code` and *it*");
  });

  it("leaves plain prose untoned", () => {
    expect(toneOf("Just an ordinary sentence.")).toBe("");
  });
});
