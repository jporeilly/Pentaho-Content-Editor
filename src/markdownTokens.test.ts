import { describe, it, expect } from "vitest";

import { highlightMarkdown, highlightLines, fenceRangeAt, markSpan, linesToHtml } from "./markdownTokens";

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

/** Strip every tag, leaving the plain source text. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("markSpan", () => {
  it("wraps exactly the requested columns", () => {
    const out = markSpan("abcdef", 3, 5, "m");
    expect(out).toBe('ab<span class="m">cd</span>ef');
  });

  it("uses 1-based columns with an exclusive end, as the verifier reports", () => {
    // A three-character tag at column 4 is reported 4-7.
    expect(textOf(markSpan("```wat", 4, 7, "m"))).toBe("```wat");
    expect(markSpan("```wat", 4, 7, "m")).toContain('<span class="m">wat</span>');
  });

  it("never changes the text, only the tags around it", () => {
    const html = highlightLines("- a **bold** word")[0].html;
    for (const [s, e] of [[1, 3], [3, 9], [1, 18], [5, 6]]) {
      expect(textOf(markSpan(html, s, e, "m")), `${s}-${e}`).toBe(textOf(html));
    }
  });

  it("splits across existing colour spans without interleaving tags", () => {
    // A single wrapper opening before a colour span and closing after it
    // would produce <a><b></a></b>, which browsers silently repair into
    // something else. Per-piece wrapping stays valid.
    const html = highlightLines("- a **bold** word")[0].html;
    const out = markSpan(html, 1, 18, "m");
    expect(textOf(out)).toBe("- a **bold** word");
    // Every tag closes in the order it opened.
    const stack: string[] = [];
    for (const tag of out.match(/<\/?span[^>]*>/g) ?? []) {
      if (tag.startsWith("</")) expect(stack.pop()).toBeDefined();
      else stack.push(tag);
    }
    expect(stack).toHaveLength(0);
  });

  it("counts an entity as one character, not as its spelling", () => {
    // `&lt;` is one `<` in the source the verifier measured. Counting
    // four would shift every column after the first angle bracket.
    const html = highlightLines("a <b> c")[0].html;
    expect(html).toContain("&lt;");
    // Columns 3-6 are "<b>" plus the space after it in the SOURCE.
    const out = markSpan(html, 3, 6, "m");
    expect(textOf(out)).toBe("a <b> c");
    expect(textOf(out.slice(out.indexOf('<span class="m">')))).toMatch(/^<b>/);
  });

  it("is a no-op for a degenerate or out-of-range span", () => {
    const html = "abc";
    expect(markSpan(html, 5, 5, "m")).toBe(html);   // zero width
    expect(markSpan(html, 5, 2, "m")).toBe(html);   // reversed
    expect(markSpan(html, 0, 2, "m")).toBe(html);   // 0 is not a column
    // Past the end simply marks nothing rather than throwing.
    expect(textOf(markSpan(html, 9, 12, "m"))).toBe("abc");
  });

  it("marks to the end of the line when the span runs past it", () => {
    expect(markSpan("abc", 2, 99, "m")).toBe('a<span class="m">bc</span>');
  });
});

describe("linesToHtml with marks", () => {
  it("applies a mark to the right line only", () => {
    const lines = highlightLines("one\ntwo\nthree");
    const marks = new Map([[2, [{ startCol: 1, endCol: 4, className: "m" }]]]);
    const html = linesToHtml(lines, marks);
    const blocks = html.split('<div class="hl-line"');
    expect(blocks[1]).not.toContain('class="m"');
    expect(blocks[2]).toContain('class="m"');
    expect(blocks[3]).not.toContain('class="m"');
  });

  it("applies several marks on one line without disturbing each other", () => {
    // Two <dfn>s on a line is the case this exists for: both get marked,
    // and the later one's columns must still be valid after the earlier
    // one inserts tags. Hence right-to-left.
    const lines = highlightLines("Some AAAA here and BBBB too.");
    const marks = new Map([[1, [
      { startCol: 6, endCol: 10, className: "m1" },
      { startCol: 20, endCol: 24, className: "m2" },
    ]]]);
    const html = linesToHtml(lines, marks);
    expect(html).toContain('<span class="m1">AAAA</span>');
    expect(html).toContain('<span class="m2">BBBB</span>');
    expect(textOf(html)).toBe("Some AAAA here and BBBB too.");
  });

  it("is unchanged when there are no marks", () => {
    const lines = highlightLines("one\ntwo");
    expect(linesToHtml(lines)).toBe(linesToHtml(lines, new Map()));
  });
});
