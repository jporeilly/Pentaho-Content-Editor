// Insert-block toolbar. Each button wraps the current selection (or
// inserts a placeholder) with one of the renderer's supported blocks, so
// an author never has to remember the markdown/directive syntax. The
// heavy lifting is a single applySnippet() that edits the textarea value
// through a controlled onChange, preserving undo where the browser
// allows.

interface ToolbarProps {
  /** The live textarea element, for selection-aware insertion. */
  textarea: HTMLTextAreaElement | null;
  /** Current body value. */
  value: string;
  /** Commit a new body value + desired caret position. */
  onChange: (next: string, caret?: number) => void;
}

interface Block {
  label: string;
  title: string;
  /** Build the inserted text. `sel` is the current selection (may be ""). */
  build: (sel: string) => { text: string; caretOffset?: number };
}

const BLOCKS: Block[] = [
  {
    label: "H2 Step",
    title: "Heading — becomes a tracked step with a checkbox",
    build: (s) => ({ text: `## ${s || "Step title"}\n\n` }),
  },
  {
    label: "H3",
    title: "Sub-heading (also a tracked step)",
    build: (s) => ({ text: `### ${s || "Sub-step"}\n\n` }),
  },
  {
    label: "Callout",
    title: "Note callout box",
    build: (s) => ({ text: `> **Note:**\n>\n> ${s || "Something worth highlighting."}\n\n` }),
  },
  {
    label: "Warning",
    title: "Warning callout box",
    build: (s) => ({ text: `> **Warning:**\n>\n> ${s || "Something to watch out for."}\n\n` }),
  },
  {
    label: "Bullets",
    title: "Bulleted list",
    build: (s) => ({ text: `- ${s || "First item"}\n- Second item\n- Third item\n\n` }),
  },
  {
    label: "Steps 1-2-3",
    title: "Numbered list",
    build: (s) => ({ text: `1. ${s || "First"}\n2. Second\n3. Third\n\n` }),
  },
  {
    label: "Code",
    title: "Fenced code block with copy button",
    build: (s) => ({ text: "```sql\n" + (s || "SELECT 1;") + "\n```\n\n" }),
  },
  {
    label: "Image",
    title: "Shared course image (../_assets/images/…)",
    build: (s) => ({ text: `![${s || "alt text"}](../_assets/images/example.png)\n\n` }),
  },
  {
    label: "Link",
    title: "Hyperlink (external opens in the system browser)",
    build: (s) => ({ text: `[${s || "link text"}](https://docs.pentaho.com)` }),
  },
  {
    label: "Divider",
    title: "Horizontal rule / section break",
    build: () => ({ text: `\n---\n\n` }),
  },
  {
    label: "Video",
    title: "Loom / YouTube / inline video",
    build: (s) => ({ text: `![${s || "Walkthrough"}](https://www.loom.com/share/REPLACE_ID)\n\n` }),
  },
  {
    label: "Tabs",
    title: "Interactive tab widget",
    build: () => ({
      text:
        ":::tabs\n\n### Windows\n\nWindows steps.\n\n### macOS / Linux\n\nUnix steps.\n\n:::\n\n",
    }),
  },
  {
    label: "Launch btn",
    title: "Button that opens a file in Spoon",
    build: () => ({
      text: `<button data-launch="spoon" data-path="files/example.ktr">Open in Pentaho Data Integration</button>\n\n`,
    }),
  },
  {
    label: "Graph btn",
    title: "Button that opens the flowchart viewer",
    build: () => ({
      text: `<button data-graph="files/example.ktr">View graph</button>\n\n`,
    }),
  },
  {
    label: "Glossary",
    title: "Inline glossary term (add a matching glossary.json entry)",
    build: (s) => ({ text: `<dfn>${s || "term"}</dfn>` }),
  },
  {
    label: "Table",
    title: "Markdown table",
    build: () => ({
      text: `| Column | Column |\n| ------ | ------ |\n| Value  | Value  |\n\n`,
    }),
  },
];

export function Toolbar({ textarea, value, onChange }: ToolbarProps) {
  function insert(block: Block) {
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const sel = value.slice(start, end);
    const { text } = block.build(sel);
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    onChange(next, caret);
    // Restore focus + caret after React re-renders.
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      }
    });
  }

  return (
    <div className="author-toolbar">
      {BLOCKS.map((b) => (
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
