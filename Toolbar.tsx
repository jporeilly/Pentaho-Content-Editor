// Insert-block toolbar. Blocks are organised into a few grouped dropdown
// menus (Callout / Heading / List / Media / Block / Pentaho) plus a couple
// of standalone buttons, so the toolbar stays compact. Each menu inserts
// the chosen block at the caret.

import { Menu } from "./Menu";
import { toggleWrap } from "./markdownKeys";

// Inline formatting. These share `toggleWrap` with the keyboard
// shortcuts rather than re-implementing the wrap, so a button and its
// Ctrl-key can never disagree about what "bold" does - including the
// unwrap-on-second-press that stops ****doubled**** markers.
interface Format {
  label: string;
  title: string;
  marker: string;
  /** Modifier class, so the button previews what it does. */
  cls: string;
}

const FORMATS: Format[] = [
  { label: "B", title: "Bold (Ctrl+B)", marker: "**", cls: "is-bold" },
  { label: "I", title: "Italic (Ctrl+I)", marker: "*", cls: "is-italic" },
  { label: "</>", title: "Inline code", marker: "`", cls: "is-code" },
  { label: "S", title: "Strikethrough", marker: "~~", cls: "is-strike" },
];

interface ToolbarProps {
  /** The live textarea element, for selection-aware insertion. */
  textarea: HTMLTextAreaElement | null;
  /** Current body value. */
  value: string;
  /** Commit a new body value + desired caret position. */
  onChange: (next: string, caret?: number) => void;
}

interface Block {
  /** Menu group; standalone buttons use "". */
  group: string;
  label: string;
  title: string;
  build: (sel: string) => { text: string };
}

// A selection is used as image alt text only when it looks like one: a
// single line with no markdown link/image syntax. Selecting a whole block
// and choosing Image used to wrap that block as the alt text.
const altFrom = (s: string) => (s && !/[\n\[\]()]/.test(s) ? s : "alt text");
// Exported for the coverage test: the Callout menu and the renderer's
// tag parser are two lists in two files, and nothing tied them together
// until a kind (Success) turned out to render fine but have no button.
export const BLOCKS: Block[] = [
  // ── Headings ──
  { group: "Heading", label: "Step (H2)", title: "Heading — a tracked step with a checkbox",
    build: (s) => ({ text: `## ${s || "Step title"}\n\n` }) },
  { group: "Heading", label: "Sub-step (H3)", title: "Sub-heading (also a tracked step)",
    build: (s) => ({ text: `### ${s || "Sub-step"}\n\n` }) },

  // ── Callouts (note / tip / warning / critical / objectives / under the hood) ──
  { group: "Callout", label: "Note", title: "Informational note",
    build: (s) => ({ text: `> **Note:**\n>\n> ${s || "Something worth highlighting."}\n\n` }) },
  { group: "Callout", label: "Under the hood", title: "Explain what the engine just did — put it AFTER the action",
    build: (s) => ({ text: `> **Under the hood:**\n>\n> ${s || "What just happened, and why the tool could do it that way."}\n\n` }) },
  { group: "Callout", label: "Tip", title: "Helpful tip",
    build: (s) => ({ text: `> **Tip:**\n>\n> ${s || "A handy shortcut or idiom."}\n\n` }) },
  { group: "Callout", label: "Warning", title: "Warning callout",
    build: (s) => ({ text: `> **Warning:**\n>\n> ${s || "Something to watch out for."}\n\n` }) },
  { group: "Callout", label: "Critical", title: "Critical / danger callout",
    build: (s) => ({ text: `> **Critical:**\n>\n> ${s || "This can cause data loss or a broken environment."}\n\n` }) },
  { group: "Callout", label: "Success", title: "Confirm the learner got the right result",
    build: (s) => ({ text: `> **Success:**\n>\n> ${s || "What you should be looking at now."}\n\n` }) },
  { group: "Callout", label: "Objectives", title: "Lab objectives callout",
    build: (s) => ({ text: `> **Objectives:**\n>\n> ${s || "By the end of this lab you will…"}\n\n` }) },
  { group: "Callout", label: "Quote", title: "Plain quote — an untagged blockquote, rendered as a casual italic quote",
    build: (s) => ({ text: `> ${s || "Quoted text."}\n\n` }) },

  // ── Lists ──
  { group: "List", label: "Bullets", title: "Bulleted list",
    build: (s) => ({ text: `- ${s || "First item"}\n- Second item\n- Third item\n\n` }) },
  { group: "List", label: "Numbered", title: "Numbered list",
    build: (s) => ({ text: `1. ${s || "First"}\n2. Second\n3. Third\n\n` }) },
  { group: "List", label: "Task list", title: "Checklist the learner can tick off (GitHub-flavoured task list)",
    build: (s) => ({ text: `- [ ] ${s || "First thing to do"}\n- [ ] Second thing\n\n` }) },

  // ── Media ──
  // Standard image insert (also what the upload / paste / drop path emits):
  // a <figure> with the image flush-left and a centred <figcaption>, so
  // every caption gets the theme's 12.5px italic caption style rather
  // than body-text size.
  { group: "Media", label: "Image", title: "Shared course image with a centred caption (../_assets/images/…)",
    build: (s) => ({ text: `<figure>\n\n![${altFrom(s)}](../_assets/images/example.png)\n\n<div align="center">\n<figcaption><em>Caption</em></figcaption>\n</div>\n</figure>\n\n` }) },
  // Course videos live on Vimeo, so that is the default the button
  // writes. An Unlisted video's link carries an access hash as a second
  // path segment and the player refuses the bare id without it, so the
  // placeholder keeps that shape - paste the whole link over it.
  // VideoEmbed also still accepts YouTube and Loom URLs.
  { group: "Media", label: "Video", title: "Vimeo (also YouTube / Loom) - paste the whole share link, access hash and all",
    build: (s) => ({ text: `![${s || "Walkthrough"}](https://vimeo.com/VIDEO_ID/ACCESS_HASH)\n\n` }) },
  // The caption row matches the Welcome page's: the renderer puts the
  // same lucide video icon in front of it when the class is present.
  { group: "Media", label: "Video — with caption", title: "Vimeo video with a captioned row underneath, matching the Welcome page",
    build: (s) => ({ text: `<figure>\n\n![${s || "Walkthrough"}](https://vimeo.com/VIDEO_ID/ACCESS_HASH)\n\n<figcaption class="pcm-video-caption">Watch: what this lab builds</figcaption>\n\n</figure>\n\n` }) },
  // Alignment wrappers. The blank lines INSIDE the wrapper are load-bearing:
  // without them CommonMark keeps the ![…] line inside the HTML block and
  // renders it as literal text instead of an image.
  { group: "Media", label: "Image — centred", title: "Centred image with an optional caption (house pattern for dialog screenshots)",
    build: (s) => ({ text: `<div align="center">\n<figure>\n\n![${altFrom(s)}](../_assets/images/example.png#w=420)\n\n<figcaption><em>Caption</em></figcaption>\n</figure>\n</div>\n\n` }) },
  { group: "Media", label: "Image — float right", title: "Image on the right with the text wrapping beside it; the next step heading starts below it",
    build: (s) => ({ text: `<figure class="pcm-float-right">\n\n![${altFrom(s)}](../_assets/images/example.png#w=320)\n\n<div align="center">\n<figcaption><em>Caption</em></figcaption>\n</div>\n</figure>\n\n` }) },
  { group: "Media", label: "Image — float left", title: "Image on the left with the text wrapping beside it; the next step heading starts below it",
    build: (s) => ({ text: `<figure class="pcm-float-left">\n\n![${altFrom(s)}](../_assets/images/example.png#w=320)\n\n<div align="center">\n<figcaption><em>Caption</em></figcaption>\n</div>\n</figure>\n\n` }) },

  // ── Block ──
  { group: "Block", label: "Code", title: "Fenced code block with copy button",
    build: (s) => ({ text: "```sql\n" + (s || "SELECT 1;") + "\n```\n\n" }) },
  { group: "Block", label: "Tabs", title: "Interactive tab widget",
    build: () => ({ text: "::: tabs\n\n### Windows\n\nWindows steps.\n\n### macOS / Linux\n\nUnix steps.\n\n:::\n\n" }) },
  { group: "Block", label: "Table", title: "Markdown table",
    build: () => ({ text: `| Column | Column |\n| ------ | ------ |\n| Value  | Value  |\n\n` }) },
  { group: "Block", label: "Link", title: "Hyperlink",
    build: (s) => ({ text: `[${s || "link text"}](https://docs.pentaho.com)` }) },
  { group: "Block", label: "Divider", title: "Horizontal rule / section break",
    build: () => ({ text: `\n---\n\n` }) },
  { group: "Block", label: "Collapsible", title: "Fold a long aside away behind a one-line summary",
    build: (s) => ({ text: `<details>\n<summary>Show the details</summary>\n\n${s || "The long version, folded away until asked for."}\n\n</details>\n\n` }) },
  { group: "Media", label: "PDF", title: "Embed a PDF from the lab's files/ folder",
    build: (s) => ({ text: `![${s || "Reference sheet"}](files/example.pdf)\n\n` }) },

  // ── Text (inline emphasis + alignment) ──
  // Semantic, not decorative: each maps to a theme token, so the same
  // markup reads correctly in light and dark and stays consistent across
  // courses. Authors get no raw colour or size - a hard-coded colour
  // breaks one theme, and a font size invites a fake heading, which
  // silently drops the step out of progress tracking.
  { group: "Text", label: "Highlight", title: "Mark a value the learner must not miss",
    build: (s) => ({ text: `<span class="pcm-mark">${s || "the exact value"}</span>` }) },
  { group: "Text", label: "Muted", title: "De-emphasise an aside",
    build: (s) => ({ text: `<span class="pcm-dim">${s || "less important detail"}</span>` }) },
  { group: "Text", label: "Attention", title: "Flag something inline that matters",
    build: (s) => ({ text: `<span class="pcm-attn">${s || "do not skip this"}</span>` }) },
  // Blank lines inside the wrapper are load-bearing, as with the images.
  { group: "Text", label: "Centred", title: "Centre a paragraph",
    build: (s) => ({ text: `<div align="center">\n\n${s || "Centred text."}\n\n</div>\n\n` }) },
  { group: "Text", label: "Right-aligned", title: "Right-align a paragraph",
    build: (s) => ({ text: `<div align="right">\n\n${s || "Right-aligned text."}\n\n</div>\n\n` }) },

  // ── Pentaho ──
  { group: "Pentaho", label: "Open in PDI", title: "Button that opens a file in Spoon",
    build: () => ({ text: `<button data-launch="spoon" data-path="files/example.ktr">Open in Pentaho Data Integration</button>\n\n` }) },
  { group: "Pentaho", label: "View graph", title: "Button that opens the flowchart viewer",
    build: () => ({ text: `<button data-graph="files/example.ktr">View graph</button>\n\n` }) },
  // The live prerequisite panel. Its spelling is the whole point of
  // having a button: the attribute value picks the profile, and a typo
  // silently renders the full check instead of the course's own.
  { group: "Pentaho", label: "Env check — full", title: "Prerequisite panel: every check, including the containers",
    build: () => ({ text: `<div data-env-check=""></div>\n\n` }) },
  { group: "Pentaho", label: "Env check — try-it lab", title: "Prerequisite panel: containers + MySQL + PDI + Ollama (the 2-hour lab)",
    build: () => ({ text: `<div data-env-check="tryit"></div>\n\n` }) },
  { group: "Pentaho", label: "Env check — server", title: "Prerequisite panel: Pentaho Server + sample data only (BA/CT/ME/SW)",
    build: () => ({ text: `<div data-env-check="server"></div>\n\n` }) },
  { group: "Pentaho", label: "Env check — AI", title: "Prerequisite panel: PDI + Ollama + Python + the AI lab services",
    build: () => ({ text: `<div data-env-check="ai"></div>\n\n` }) },
  { group: "Pentaho", label: "Env check — streaming", title: "Prerequisite panel: everything plus the MQTT/AMQP brokers",
    build: () => ({ text: `<div data-env-check="streaming"></div>\n\n` }) },

  // ── Standalone (inline) ──
  { group: "", label: "＋ Glossary", title: "Inline glossary term (add a glossary.json entry)",
    build: (s) => ({ text: `<dfn>${s || "term"}</dfn>` }) },
];

const GROUP_ORDER = ["Heading", "Callout", "List", "Text", "Media", "Block", "Pentaho"];

export function Toolbar({ textarea, value, onChange }: ToolbarProps) {
  function insert(block: Block) {
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const sel = value.slice(start, end);
    const { text } = block.build(sel);
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    onChange(next, caret);
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      }
    });
  }

  // Inline formatting wraps the SELECTION, so it goes through
  // toggleWrap rather than the insert path, which replaces it.
  function format(marker: string) {
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = toggleWrap({ text: value, start, end }, marker);
    onChange(next.text, next.end);
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(next.start, next.end);
      }
    });
  }

  const byGroup = (g: string) => BLOCKS.filter((b) => b.group === g);
  const standalone = BLOCKS.filter((b) => b.group === "");

  return (
    <div className="author-toolbar">
      <span className="author-toolbar-label">Format</span>
      {FORMATS.map((f) => (
        <button
          key={f.marker}
          type="button"
          className={`author-toolbar-btn author-toolbar-fmt ${f.cls}`}
          title={f.title}
          onMouseDown={(e) => e.preventDefault()} /* keep the selection */
          onClick={() => format(f.marker)}
        >
          {f.label}
        </button>
      ))}
      <span className="author-toolbar-sep" aria-hidden />
      <span className="author-toolbar-label">Insert</span>
      {GROUP_ORDER.map((group) => (
        <Menu
          key={group}
          label={group}
          title={`Insert a ${group.toLowerCase()} block`}
          items={byGroup(group).map((b) => ({
            label: b.label,
            title: b.title,
            onSelect: () => insert(b),
          }))}
        />
      ))}
      {standalone.map((b) => (
        <button
          key={b.label}
          type="button"
          className="author-toolbar-btn"
          title={b.title}
          onClick={() => insert(b)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
