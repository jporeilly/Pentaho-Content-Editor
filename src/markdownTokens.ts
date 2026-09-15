// Colour the markdown source using the same hues as the insert menus.
//
// A heading in the toolbar is blue, so a `##` line in the source is blue
// too; Media is cyan, so an image line is cyan. One vocabulary in both
// places, so you can find the callout you just wrote without reading the
// text — which is the whole point of colouring the source at all.
//
// A <textarea> cannot colour its own contents, so the editor paints this
// markup in a layer BEHIND a transparent textarea. That makes exactness
// the requirement: the two must agree on every character's position, or
// the colours drift away from the text under the caret. Hence:
//
//   • escape() runs on every piece of text, so a stray < cannot open a
//     tag in the highlight layer and swallow the rest of the line;
//   • whitespace is never collapsed, trimmed or normalised — what goes
//     in comes out, byte for byte, with only spans added;
//   • each source line becomes its own block, so "a\n" is two lines here
//     exactly as the textarea counts it. A single <pre> could not do
//     that — one ending in \n renders a line short, and every colour
//     below the fold slid up by one.
//
// Line-based, with one piece of state (are we inside a fence?). A guide
// is a few hundred lines and this runs per keystroke, so it stays a
// single pass with no backtracking.

export type Tone =
  | "heading" | "callout" | "list" | "text"
  | "media" | "code" | "block" | "pentaho";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const span = (tone: Tone, s: string) => `<span class="tok-${tone}">${escape(s)}</span>`;

/**
 * Inline constructs, applied within a single line of body text.
 *
 * One regex with alternatives rather than a chain of replaces: chained
 * replaces re-scan text that earlier passes have already wrapped in
 * markup, so a `**bold**` inside an already-emitted span gets a second
 * span nested in its class attribute.
 *
 * Order inside the alternation matters — image before link (an image is
 * a link with a `!`), and code before emphasis, since backticks are
 * literal inside code.
 */
const INLINE = new RegExp(
  [
    "(`[^`\\n]+`)",                       // inline code
    "(!\\[[^\\]\\n]*\\]\\([^)\\n]*\\))",  // image
    "(\\[[^\\]\\n]*\\]\\([^)\\n]*\\))",   // link
    "(\\*\\*[^*\\n]+\\*\\*)",             // bold
    "(~~[^~\\n]+~~)",                     // strikethrough
    "(\\*[^*\\n]+\\*)",                   // italic
  ].join("|"),
  "g",
);

function inline(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    out += escape(text.slice(last, at));
    const tok = m[0];
    if (tok.startsWith("`")) out += span("code", tok);
    else if (tok.startsWith("![")) out += span("media", tok);
    else if (tok.startsWith("[")) out += span("media", tok);
    else out += span("text", tok);
    last = at + tok.length;
  }
  return out + escape(text.slice(last));
}

/** Markup carrying a Pentaho behaviour — the inserts whose spelling decides what happens. */
const PENTAHO = /data-(launch|graph|env-check|path)=/;

/** One source line, coloured, plus what the gutter and the caret need. */
export interface HighlightedLine {
  /** 1-based, as the verifier and AI review report them. */
  n: number;
  html: string;
  /** Inside a fenced block, the marker lines included. */
  inFence: boolean;
  /** This line IS a ``` marker — the pair a caret inside can light up. */
  isFenceMarker: boolean;
}

/**
 * The fenced block containing 0-based `line`, as the 0-based indices of
 * its opening and closing markers, or null.
 *
 * An UNCLOSED fence still returns a range, ending at the last line: a
 * missing close is one of the two errors the course verifier treats as
 * fatal, so the editor should show you the opener you never closed
 * rather than quietly matching nothing.
 */
export function fenceRangeAt(lines: HighlightedLine[], line: number): { start: number; end: number } | null {
  if (line < 0 || line >= lines.length || !lines[line].inFence) return null;
  let start = line;
  while (start > 0 && lines[start - 1].inFence && !lines[start].isFenceMarker) start--;
  // Walk back over the opener itself if the caret sat on the closer.
  while (start > 0 && lines[start - 1].inFence && !(lines[start].isFenceMarker && start !== line)) start--;
  let end = line;
  while (end < lines.length - 1 && lines[end + 1].inFence) end++;
  while (start > 0 && !lines[start].isFenceMarker) start--;
  return { start, end };
}

/**
 * Highlight a markdown body, line by line.
 *
 * Per line, not one blob, because three features hang off knowing where
 * a line starts: the gutter's number, the current-line band, and the
 * fence pair. It also removes the trailing-newline hack the single-blob
 * version needed — "a\n" is two lines here, exactly as the textarea
 * counts it, with no padding character invented to make the heights
 * agree.
 */
export function highlightLines(body: string): HighlightedLine[] {
  const lines = body.split("\n");
  const out: HighlightedLine[] = [];
  let fence: string | null = null;

  const push = (html: string, inFence: boolean, isFenceMarker: boolean) =>
    out.push({ n: out.length + 1, html, inFence, isFenceMarker });

  for (const line of lines) {
    // ── Fenced code. The fence marker itself is part of the block, and
    // nothing inside is interpreted — a `#` in a shell script is a
    // comment, not a heading.
    const fenceHit = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closes = !!fenceHit && fenceHit[1][0] === fence[0] && fenceHit[1].length >= fence.length;
      push(span("code", line), true, closes);
      if (closes) fence = null;
      continue;
    }
    if (fenceHit) {
      fence = fenceHit[1];
      push(span("code", line), true, true);
      continue;
    }

    // ── Pentaho buttons, before the generic HTML rule: these are the
    // inserts whose exact spelling decides behaviour, so they are worth
    // spotting at a glance.
    if (PENTAHO.test(line)) { push(span("pentaho", line), false, false); continue; }

    // ── Headings.
    if (/^\s{0,3}#{1,6}\s/.test(line)) { push(span("heading", line), false, false); continue; }

    // ── Callouts and quotes.
    if (/^\s*>/.test(line)) { push(span("callout", line), false, false); continue; }

    // ── Block-level structure: rules, tables, directives, HTML blocks.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { push(span("block", line), false, false); continue; }
    if (/^\s*:::/.test(line)) { push(span("block", line), false, false); continue; }
    if (/^\s*\|/.test(line)) { push(span("block", line), false, false); continue; }
    if (/^\s*<\/?(figure|figcaption|details|summary|div|button|img|video|br|hr)\b/i.test(line)) {
      push(span("block", line), false, false);
      continue;
    }
    // An HTML comment line, which is how author notes are written.
    if (/^\s*(<!--|-->)/.test(line)) { push(span("block", line), false, false); continue; }

    // ── Lists. The MARKER is toned; the text after it keeps its inline
    // colours, so a bold word inside a bullet still reads as emphasis.
    const list = /^(\s*)([-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)/.exec(line);
    if (list) {
      push(escape(list[1]) + span("list", list[2]) + inline(line.slice(list[0].length)), false, false);
      continue;
    }

    push(inline(line), false, false);
  }

  return out;
}

/**
 * The layer's markup: one block per source line, carrying its number for
 * the gutter.
 *
 * Built as one HTML string rather than as React children because the
 * caret moves far more often than the text changes: the current-line and
 * fence-pair classes are toggled straight on these nodes, so moving the
 * caret costs two className writes instead of re-rendering a hundred
 * elements.
 */
export function linesToHtml(lines: HighlightedLine[]): string {
  return lines.map((l) => `<div class="hl-line" data-n="${l.n}">${l.html}</div>`).join("");
}

export function highlightMarkdown(body: string): string {
  return linesToHtml(highlightLines(body));
}
