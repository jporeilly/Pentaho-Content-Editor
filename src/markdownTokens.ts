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
//   • a trailing newline gets a trailing space, because a <pre> ending
//     in \n renders one line shorter than the textarea does and every
//     colour below the fold slides up by a line.
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

/**
 * Highlight a markdown body. Returns HTML for the layer behind the
 * textarea; the caller must render it with the textarea's exact font,
 * size, line-height, padding and wrapping.
 */
export function highlightMarkdown(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    // ── Fenced code. The fence marker itself is part of the block, and
    // nothing inside is interpreted — a `#` in a shell script is a
    // comment, not a heading.
    const fenceHit = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(span("code", line));
      if (fenceHit && fenceHit[1][0] === fence[0] && fenceHit[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceHit) {
      fence = fenceHit[1];
      out.push(span("code", line));
      continue;
    }

    // ── Pentaho buttons, before the generic HTML rule: these are the
    // inserts whose exact spelling decides behaviour, so they are worth
    // spotting at a glance.
    if (PENTAHO.test(line)) { out.push(span("pentaho", line)); continue; }

    // ── Headings.
    if (/^\s{0,3}#{1,6}\s/.test(line)) { out.push(span("heading", line)); continue; }

    // ── Callouts and quotes.
    if (/^\s*>/.test(line)) { out.push(span("callout", line)); continue; }

    // ── Block-level structure: rules, tables, directives, HTML blocks.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(span("block", line)); continue; }
    if (/^\s*:::/.test(line)) { out.push(span("block", line)); continue; }
    if (/^\s*\|/.test(line)) { out.push(span("block", line)); continue; }
    if (/^\s*<\/?(figure|figcaption|details|summary|div|button|img|video|br|hr)\b/i.test(line)) {
      out.push(span("block", line));
      continue;
    }
    // An HTML comment line, which is how author notes are written.
    if (/^\s*(<!--|-->)/.test(line)) { out.push(span("block", line)); continue; }

    // ── Lists. The MARKER is toned; the text after it keeps its inline
    // colours, so a bold word inside a bullet still reads as emphasis.
    const list = /^(\s*)([-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)/.exec(line);
    if (list) {
      out.push(escape(list[1]) + span("list", list[2]) + inline(line.slice(list[0].length)));
      continue;
    }

    out.push(inline(line));
  }

  const html = out.join("\n");
  // A <pre> whose content ends in a newline renders one line shorter
  // than the textarea does, so everything below the fold drifts up by a
  // line. The trailing space gives that last line something to occupy.
  return html.endsWith("\n") ? html + " " : html;
}
