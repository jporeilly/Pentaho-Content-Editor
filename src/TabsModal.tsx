// Insert a tab widget: name the tabs, get the directive.
//
// The toolbar used to insert a fixed two-tab Windows / macOS stub, so
// a three-tab widget meant copying the ::: fence and its heading level
// by hand - and an unclosed ::: is one of the two errors the course
// verifier treats as fatal. Building it here means the fence always
// closes.
//
// Steps or choices (owner, 2026-10-19, the Content Manager 0.7.39 tab
// looks): the guide shows a block whose titles are all numbered as a
// STEPPER - numbered dots, Previous / Next - and any other block as tabs
// (a small switch inside another tab). So the author says which this
// is, and the dialog numbers the titles for steps: nobody has to know
// that the numbers are what decide it.

import { useState } from "react";

import { Modal } from "./Modal";

interface TabsModalProps {
  onInsert: (markdown: string) => void;
  onClose: () => void;
  /** A Windows 11 course (course.json platform "windows11",
   *  COURSE-STANDARD 3.5): no macOS / Linux tab to start from. */
  windowsOnly?: boolean;
}

export type TabsKind = "steps" | "choices";

/** The pair almost every existing widget uses, so it stays one click. */
export const DEFAULT_TABS = ["Windows", "macOS / Linux"];
/** In a Windows 11 course a tab block is never an OS choice; numbered
 *  steps are what DI and BA use tabs for. */
export const WINDOWS_ONLY_TABS = ["First step", "Second step"];

/** A title as typed, without a step number of its own ("2. Run" → "Run"),
 *  so steps are numbered once and choices are never numbered by accident. */
export function bareTitle(title: string): string {
  return title.trim().replace(/^\d+(?:\.\d+)*\.?\s+/, "");
}

/** The ::: tabs directive for these titles: numbered "1. ", "2. " ... for
 *  steps, as typed for choices. Empty titles are left out. */
export function tabsMarkdown(titles: string[], kind: TabsKind): string {
  const clean = titles.map(bareTitle).filter(Boolean);
  const named = kind === "steps" ? clean.map((t, i) => `${i + 1}. ${t}`) : clean;
  return "::: tabs\n\n" + named.map((t) => `### ${t}\n\n${t} steps.\n\n`).join("") + ":::\n\n";
}

export function TabsModal({ onInsert, onClose, windowsOnly = false }: TabsModalProps) {
  const [kind, setKind] = useState<TabsKind>(windowsOnly ? "steps" : "choices");
  const [titles, setTitles] = useState<string[]>(windowsOnly ? WINDOWS_ONLY_TABS : DEFAULT_TABS);

  const setTitle = (i: number, v: string) =>
    setTitles((prev) => prev.map((t, j) => (j === i ? v : t)));
  const addTab = () => setTitles((prev) => [...prev, kind === "steps" ? "New step" : `Tab ${prev.length + 1}`]);
  const removeTab = (i: number) =>
    setTitles((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  const count = titles.map(bareTitle).filter(Boolean).length;
  const markdown = tabsMarkdown(titles, kind);
  const noun = kind === "steps" ? "step" : "tab";

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
            disabled={count === 0}
            onClick={() => { onInsert(markdown); onClose(); }}
          >
            Insert {count} {noun}{count === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <fieldset className="author-fieldset">
        <legend>What are these?</legend>
        <label className="author-radio">
          <input type="radio" name="tabs-kind" checked={kind === "steps"} onChange={() => setKind("steps")} />
          <span className="author-radio-label">Steps, done in order</span>
          <span className="author-radio-note">
            Numbered for you. The guide shows numbered dots, the step's title, and Previous / Next.
          </span>
        </label>
        <label className="author-radio">
          <input type="radio" name="tabs-kind" checked={kind === "choices"} onChange={() => setKind("choices")} />
          <span className="author-radio-label">Choices, pick one</span>
          <span className="author-radio-note">
            An operating system, a tool, a variant. Tabs on one row (More for the rest), or a small switch inside another tab.
          </span>
        </label>
      </fieldset>

      <div className="author-field">
        <span>{kind === "steps" ? "Step titles" : "Tab titles"}</span>
        <div className="author-tabs-list">
          {titles.map((t, i) => (
            <div key={i} className="author-tabs-row">
              <input
                className="author-input"
                value={t}
                autoFocus={i === 0}
                placeholder={kind === "steps" ? `Step ${i + 1}` : `Tab ${i + 1}`}
                onChange={(e) => setTitle(i, e.target.value)}
              />
              <button
                type="button"
                className="author-mini-btn"
                onClick={() => removeTab(i)}
                disabled={titles.length === 1}
                aria-label={`Remove ${t || `${noun} ${i + 1}`}`}
                title={titles.length === 1 ? "A widget needs at least one tab" : `Remove this ${noun}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="author-tool author-tabs-add" onClick={addTab}>+ Add {noun}</button>
      </div>

      <div className="author-field">
        <span>What gets inserted</span>
        <pre className="author-table-preview">{markdown.trimEnd()}</pre>
      </div>
    </Modal>
  );
}
