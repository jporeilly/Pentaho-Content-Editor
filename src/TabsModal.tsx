// Insert a tab widget: name the tabs, get the directive.
//
// The toolbar used to insert a fixed two-tab Windows / macOS stub, so
// a three-tab widget meant copying the ::: fence and its heading level
// by hand - and an unclosed ::: is one of the two errors the course
// verifier treats as fatal. Building it here means the fence always
// closes.

import { useState } from "react";

import { Modal } from "./Modal";

interface TabsModalProps {
  onInsert: (markdown: string) => void;
  onClose: () => void;
  /** A Windows 11 course (course.json platform "windows11",
   *  COURSE-STANDARD 3.5): no macOS / Linux tab to start from. */
  windowsOnly?: boolean;
}

/** The pair almost every existing widget uses, so it stays one click. */
export const DEFAULT_TABS = ["Windows", "macOS / Linux"];
/** In a Windows 11 course a tab block is never an OS choice; numbered
 *  steps are what DI and BA use tabs for. */
export const WINDOWS_ONLY_TABS = ["1. First step", "2. Second step"];

export function TabsModal({ onInsert, onClose, windowsOnly = false }: TabsModalProps) {
  const [titles, setTitles] = useState<string[]>(windowsOnly ? WINDOWS_ONLY_TABS : DEFAULT_TABS);

  const setTitle = (i: number, v: string) =>
    setTitles((prev) => prev.map((t, j) => (j === i ? v : t)));
  const addTab = () => setTitles((prev) => [...prev, `Tab ${prev.length + 1}`]);
  const removeTab = (i: number) =>
    setTitles((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const clean = titles.map((t) => t.trim()).filter(Boolean);
  const markdown =
    "::: tabs\n\n" +
    clean.map((t) => `### ${t}\n\n${t} steps.\n\n`).join("") +
    ":::\n\n";

  return (
    <Modal
      title="Insert tabs"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="author-save"
            disabled={clean.length === 0}
            onClick={() => { onInsert(markdown); onClose(); }}
          >
            Insert {clean.length} tab{clean.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="author-field">
        <span>Tab titles</span>
        <div className="author-tabs-list">
          {titles.map((t, i) => (
            <div key={i} className="author-tabs-row">
              <input
                className="author-input"
                value={t}
                autoFocus={i === 0}
                placeholder={`Tab ${i + 1}`}
                onChange={(e) => setTitle(i, e.target.value)}
              />
              <button
                type="button"
                className="author-mini-btn"
                onClick={() => removeTab(i)}
                disabled={titles.length === 1}
                aria-label={`Remove ${t || `tab ${i + 1}`}`}
                title={titles.length === 1 ? "A widget needs at least one tab" : "Remove this tab"}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="author-tool author-tabs-add" onClick={addTab}>+ Add tab</button>
      </div>

      <div className="author-field">
        <span>What gets inserted</span>
        <pre className="author-table-preview">{markdown.trimEnd()}</pre>
      </div>
    </Modal>
  );
}
