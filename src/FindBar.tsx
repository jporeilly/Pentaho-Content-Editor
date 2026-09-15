// Find and replace, over the open lab's body.
//
// Opens on Ctrl/Cmd+F, closes on Escape — the two bindings every editor
// has, so nobody has to be told. It drives the real textarea: a match is
// shown by selecting it and scrolling it into view, rather than by
// painting a highlight layer over a plain <textarea>, which cannot be
// done without reimplementing the text rendering.

import { useEffect, useMemo, useRef, useState } from "react";

import { findMatches, nextMatch, replaceAt, replaceAll, matchLabel } from "./findReplace";

interface FindBarProps {
  body: string;
  onChange: (next: string) => void;
  textarea: HTMLTextAreaElement | null;
  onClose: () => void;
  /** Report what happened to the one status line. */
  onStatus?: (message: string) => void;
}

export function FindBar({ body, onChange, textarea, onClose, onStatus }: FindBarProps) {
  const [needle, setNeedle] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(-1);
  const findRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(
    () => findMatches(body, needle, { caseSensitive }),
    [body, needle, caseSensitive],
  );

  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, []);

  // A new search is a new set of positions; keeping the old index would
  // point at a match that has moved or gone.
  useEffect(() => { setCurrent(-1); }, [needle, caseSensitive]);

  const show = (index: number) => {
    const m = matches[index];
    if (!m || !textarea) return;
    setCurrent(index);
    // Select it, then let the browser scroll it into view. Focusing the
    // textarea would steal the caret from the search box mid-typing, so
    // the selection is set without focus and the scroll is done by hand.
    textarea.setSelectionRange(m.start, m.end);
    const before = body.slice(0, m.start).split("\n").length - 1;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18;
    const target = before * lineHeight - textarea.clientHeight / 2;
    textarea.scrollTop = Math.max(0, target);
  };

  const step = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const caret = current >= 0 && matches[current]
      ? matches[current].start + (direction === 1 ? 1 : 0)
      : (textarea?.selectionStart ?? 0);
    show(nextMatch(matches, caret, direction));
  };

  const replaceCurrent = () => {
    const m = matches[current] ?? matches[0];
    if (!m) return;
    const { text } = replaceAt(body, m, replacement);
    onChange(text);
    // The list is stale the instant the text changes; land on the next
    // match after the edit rather than trusting the old index.
    setCurrent(-1);
    onStatus?.(`Replaced 1 of ${matches.length}.`);
  };

  const replaceEvery = () => {
    const { text, count } = replaceAll(body, needle, replacement, { caseSensitive });
    if (count === 0) { onStatus?.("Nothing to replace."); return; }
    onChange(text);
    setCurrent(-1);
    onStatus?.(`Replaced ${count} occurrence${count === 1 ? "" : "s"}.`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    // Enter walks the matches; Shift+Enter walks them backwards.
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  };

  return (
    <div className="author-findbar" onKeyDown={onKey}>
      <input
        ref={findRef}
        className="author-find-input"
        placeholder="Find"
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        aria-label="Find in this lab"
      />
      <input
        className="author-find-input"
        placeholder="Replace with"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        aria-label="Replace with"
      />
      <span className={`author-find-count${matches.length === 0 && needle ? " is-empty" : ""}`}>
        {needle ? matchLabel(matches, current) : ""}
      </span>
      <button type="button" className="author-toolbar-btn" onClick={() => step(-1)}
              disabled={matches.length === 0} title="Previous match (Shift+Enter)">↑</button>
      <button type="button" className="author-toolbar-btn" onClick={() => step(1)}
              disabled={matches.length === 0} title="Next match (Enter)">↓</button>
      <button type="button" className="author-toolbar-btn" onClick={replaceCurrent}
              disabled={matches.length === 0} title="Replace this match">Replace</button>
      <button type="button" className="author-toolbar-btn" onClick={replaceEvery}
              disabled={matches.length === 0} title="Replace every match in this lab">All</button>
      <label className="author-find-case" title="Match case">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
        Aa
      </label>
      <button type="button" className="author-toolbar-btn" onClick={onClose} title="Close (Escape)">✕</button>
    </div>
  );
}
