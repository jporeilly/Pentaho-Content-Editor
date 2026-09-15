// The command palette: one box that reaches every insert block.
//
// Opens on Ctrl/Cmd+/ or Ctrl/Cmd+Shift+P. Type, arrow, Enter.
//
// Why it exists: the insert row is ten menus over thirty-six blocks.
// Below about 1100px it wraps and pushes its last entry out of sight
// behind a 30px scroller, and even at full width, reaching "Image —
// float right" means reading ten labels, guessing a menu, opening it and
// reading nine more. This is the way in that does not depend on the row
// being complete.

import { useEffect, useMemo, useRef, useState } from "react";

import { rankCommands, moveSelection, type Command } from "./commandRanking";

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => rankCommands(commands, query), [commands, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // A new query is a new list; keeping the old index would leave the
  // highlight on whatever happens to be in that slot now.
  useEffect(() => { setSelected(0); }, [query]);

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    const row = listRef.current?.children[selected] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    // Close FIRST: the command inserts at the caret, and the textarea
    // cannot take the caret back while the palette still holds focus.
    onClose();
    cmd.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => moveSelection(s, 1, results.length)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => moveSelection(s, -1, results.length)); return; }
    if (e.key === "Enter") { e.preventDefault(); run(results[selected]); }
  };

  return (
    <div className="author-palette-backdrop" onMouseDown={onClose}>
      {/* Stop the backdrop's close from firing for clicks inside. */}
      <div className="author-palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <input
          ref={inputRef}
          className="author-palette-input"
          placeholder="Insert a block… (try 'image', 'callout', 'table')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search insert blocks"
        />
        <div className="author-palette-list" ref={listRef} role="listbox">
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={`author-palette-row${i === selected ? " is-selected" : ""}`}
              data-tone={cmd.group.toLowerCase()}
              // Mouse move, not enter: entering re-selects a row the
              // pointer merely happens to be resting over when the list
              // re-renders under it, stealing the keyboard's highlight.
              onMouseMove={() => setSelected(i)}
              onClick={() => run(cmd)}
              title={cmd.title}
            >
              <span className="author-palette-group">{cmd.group}</span>
              <span className="author-palette-label">{cmd.label}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="author-palette-empty">No block matches “{query}”.</div>
          )}
        </div>
        <div className="author-palette-foot">
          <span>↑↓ to move</span>
          <span>Enter to insert</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
