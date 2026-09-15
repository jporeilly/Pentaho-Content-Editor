import { describe, it, expect } from "vitest";

import { highlightMarkdown, highlightLines, fenceRangeAt } from "./markdownTokens";

/** Undo the highlighter: one block per source line, spans stripped. */
function plain(html: string): string {
  return html
    .split(/<div class="hl-line" data-n="\d+">/)
    .slice(1)                       // drop the empty piece before the first block
    .map((chunk) => chunk.replace(/<\/div>$/, ""))
    .join("\n")
    .replace(/<span class="tok-[a-z]+">/g, "")
    .replace(/<\/span>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Which tone a line was given, or "" for untoned body text. */
function toneOf(body: string, lineIndex = 0): string {
  const html = highlightLines(body)[lineIndex]?.html ?? "";
  return /^<span class="tok-([a-z]+)">/.exec(html)?.[1] ?? "";
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
    ["unicode", "café — naïve 日本語 🎉\n"],
  ];

  for (const [name, body] of bodies) {
    it(`round-trips ${name} unchanged`, () => {
      expect(plain(highlightMarkdown(body))).toBe(body);
    });
  }

  it("emits exactly one block per source line", () => {
    // This is what makes the heights agree. A single <pre> ending in a
    // newline renders one line short, and every colour below the fold
    // slid up by one; a block per line counts the way a textarea does.
    const count = (s: string) => (highlightMarkdown(s).match(/class="hl-line"/g) ?? []).length;
    expect(count("a")).toBe(1);
    expect(count("a\n")).toBe(2);
    expect(count("a\n\n")).toBe(3);
    expect(count("")).toBe(1);
    expect(count("\n\n\n")).toBe(4);
  });

  it("numbers the blocks from 1, as the verifier reports them", () => {
    const html = highlightMarkdown("one\ntwo\nthree");
    expect(html).toContain('data-n="1"');
    expect(html).toContain('data-n="3"');
    expect(html).not.toContain('data-n="0"');
  });

  it("never lets a stray < open a tag in the layer", () => {
    const html = highlightMarkdown("if a <b> then\n");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toMatch(/<b>/);
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
    const lines = highlightLines("```bash\n# not a heading\necho hi\n```\nafter");
    for (let i = 0; i < 4; i++) expect(lines[i].html, `line ${i}`).toContain('class="tok-code"');
    // The # inside the fence is a shell comment, NOT a heading.
    expect(lines[1].html).not.toContain("tok-heading");
    expect(lines[4].html).not.toContain("tok-code");
  });

  it("closes a fence only on a matching marker", () => {
    // A ~~~ inside a ``` block does not end it.
    const lines = highlightLines("```\n~~~\nstill code\n```\nafter");
    expect(lines[2].inFence).toBe(true);
    expect(lines[4].inFence).toBe(false);
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
    const html = highlightMarkdown("**bold** and `code` and *it*");
    expect(html).not.toMatch(/class="tok-[a-z]*<span/);
    expect(plain(html)).toBe("**bold** and `code` and *it*");
  });

  it("leaves plain prose untoned", () => {
    expect(toneOf("Just an ordinary sentence.")).toBe("");
  });
});

describe("fenceRangeAt", () => {
  const body = "intro\n```sql\nSELECT 1;\nSELECT 2;\n```\nafter\n";
  const lines = highlightLines(body);

  it("finds the pair from anywhere inside the block", () => {
    for (const caret of [1, 2, 3, 4]) {
      expect(fenceRangeAt(lines, caret), `from line ${caret}`).toEqual({ start: 1, end: 4 });
    }
  });

  it("returns null outside any fence", () => {
    expect(fenceRangeAt(lines, 0)).toBeNull();
    expect(fenceRangeAt(lines, 5)).toBeNull();
  });

  it("is null-safe at the edges", () => {
    expect(fenceRangeAt(lines, -1)).toBeNull();
    expect(fenceRangeAt(lines, 999)).toBeNull();
    expect(fenceRangeAt([], 0)).toBeNull();
  });

  it("still ranges an UNCLOSED fence, to the end", () => {
    // An unclosed fence is one of the two errors the verifier treats as
    // fatal. Showing the opener you never closed is more use than
    // matching nothing at all.
    const open = highlightLines("intro\n```sql\nSELECT 1;\n");
    expect(fenceRangeAt(open, 2)).toEqual({ start: 1, end: 3 });
  });
});
