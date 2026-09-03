// Insert-block toolbar. Blocks are organised into a few grouped dropdown
// menus (Callout / Heading / List / Media / Block / Pentaho) plus a couple
// of standalone buttons, so the toolbar stays compact. Each dropdown
// inserts the chosen block at the caret, then resets to its label.

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

const BLOCKS: Block[] = [
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
  { group: "Callout", label: "Objectives", title: "Lab objectives callout",
    build: (s) => ({ text: `> **Objectives:**\n>\n> ${s || "By the end of this lab you will…"}\n\n` }) },

  // ── Lists ──
  { group: "List", label: "Bullets", title: "Bulleted list",
    build: (s) => ({ text: `- ${s || "First item"}\n- Second item\n- Third item\n\n` }) },
  { group: "List", label: "Numbered", title: "Numbered list",
    build: (s) => ({ text: `1. ${s || "First"}\n2. Second\n3. Third\n\n` }) },

  // ── Media ──
  { group: "Media", label: "Image", title: "Shared course image (../_assets/images/…)",
    build: (s) => ({ text: `![${s || "alt text"}](../_assets/images/example.png)\n\n` }) },
  { group: "Media", label: "Video", title: "Loom / YouTube / inline video",
    build: (s) => ({ text: `![${s || "Walkthrough"}](https://www.loom.com/share/REPLACE_ID)\n\n` }) },
  // Alignment wrappers. The blank lines INSIDE the wrapper are load-bearing:
  // without them CommonMark keeps the ![…] line inside the HTML block and
  // renders it as literal text instead of an image.
  { group: "Media", label: "Image — centred", title: "Centred image with an optional caption (house pattern for dialog screenshots)",
    build: (s) => ({ text: `<div align="center">\n<figure>\n\n![${s || "alt text"}](../_assets/images/example.png#w=420)\n\n<figcaption>Caption — delete this line if not needed</figcaption>\n</figure>\n</div>\n\n` }) },
  { group: "Media", label: "Image — float right", title: "Image on the right with the text wrapping beside it; the next step heading starts below it",
    build: (s) => ({ text: `<figure class="pcm-float-right">\n\n![${s || "alt text"}](../_assets/images/example.png#w=320)\n\n<figcaption>Caption — delete this line if not needed</figcaption>\n</figure>\n\n` }) },
  { group: "Media", label: "Image — float left", title: "Image on the left with the text wrapping beside it; the next step heading starts below it",
    build: (s) => ({ text: `<figure class="pcm-float-left">\n\n![${s || "alt text"}](../_assets/images/example.png#w=320)\n\n<figcaption>Caption — delete this line if not needed</figcaption>\n</figure>\n\n` }) },

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

  // ── Pentaho ──
  { group: "Pentaho", label: "Open in PDI", title: "Button that opens a file in Spoon",
    build: () => ({ text: `<button data-launch="spoon" data-path="files/example.ktr">Open in Pentaho Data Integration</button>\n\n` }) },
  { group: "Pentaho", label: "View graph", title: "Button that opens the flowchart viewer",
    build: () => ({ text: `<button data-graph="files/example.ktr">View graph</button>\n\n` }) },

  // ── Standalone (inline) ──
  { group: "", label: "＋ Glossary", title: "Inline glossary term (add a glossary.json entry)",
    build: (s) => ({ text: `<dfn>${s || "term"}</dfn>` }) },
];

const GROUP_ORDER = ["Heading", "Callout", "List", "Media", "Block", "Pentaho"];

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

  const byGroup = (g: string) => BLOCKS.filter((b) => b.group === g);
  const standalone = BLOCKS.filter((b) => b.group === "");

  return (
    <div className="author-toolbar">
      {GROUP_ORDER.map((group) => (
        <select
          key={group}
          className="author-toolbar-select"
          value=""
          title={`Insert a ${group.toLowerCase()} block`}
          onChange={(e) => {
            const block = byGroup(group).find((b) => b.label === e.target.value);
            if (block) insert(block);
            e.target.value = ""; // reset to the label
          }}
        >
          <option value="" disabled>{group} ▾</option>
          {byGroup(group).map((b) => (
            <option key={b.label} value={b.label} title={b.title}>{b.label}</option>
          ))}
        </select>
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
