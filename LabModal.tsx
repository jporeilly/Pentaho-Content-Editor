// New-lab / AI-lab dialog. Replaces the window.prompt / confirm / alert
// flow that "New Lab" and "AI Lab" used — the same fragile native-dialog
// pattern (invisible errors, "OK does nothing" in some webviews) that was
// already removed from New Course. One form, two modes:
//   • "new" — title + topic + kind (workshop / page)
//   • "ai"  — title + topic + an optional outline the model drafts from
//
// The topic field offers the course's existing topics via a datalist but
// accepts a new one. Errors render inline; the parent controls busy state
// and keeps the modal open on failure.

import { useState } from "react";
import { Modal } from "./Modal";

export interface LabDraft {
  title: string;
  topic: string;
  kind: "workshop" | "page";
  outline?: string;
}

interface LabModalProps {
  /** "page" is "new" with the Kind dropdown pre-set — still switchable. */
  mode: "new" | "page" | "ai";
  /** Existing topic names, for the datalist + a sensible default. */
  topics: string[];
  /** An operation is in flight (creating / drafting). */
  busy: boolean;
  /** Error to show inline (set by the parent on a failed submit). */
  error?: string;
  onClose: () => void;
  onSubmit: (draft: LabDraft) => void;
}

export function LabModal({ mode, topics, busy, error, onClose, onSubmit }: LabModalProps) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState(topics[topics.length - 1] ?? "Workshops");
  // Which button was pressed decides the starting kind; the dropdown
  // below still switches it, so "+ Page" is a shortcut, not a mode.
  const [kind, setKind] = useState<"workshop" | "page">(
    mode === "page" ? "page" : "workshop",
  );
  const [outline, setOutline] = useState("");

  const isAi = mode === "ai";
  const canSubmit = !!title.trim() && !busy;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      topic: topic.trim() || "Workshops",
      kind: isAi ? "workshop" : kind,
      outline: isAi ? outline.trim() : undefined,
    });
  }

  // The heading and button follow the CURRENT kind, not the button that
  // opened the modal — switch the dropdown to Page and the dialog stops
  // calling it a lab.
  const noun = kind === "page" ? "page" : "lab";
  const primaryLabel = isAi
    ? (busy ? "Drafting…" : "✨ Draft with AI")
    : (busy ? "Creating…" : `Create ${noun}`);

  return (
    <Modal
      title={isAi ? "Draft a lab with AI" : `New ${noun}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="author-save" onClick={submit} disabled={!canSubmit}>
            {primaryLabel}
          </button>
        </>
      }
    >
      <label className="author-field">
        <span>Lab title</span>
        <input
          className="author-input"
          value={title}
          autoFocus
          placeholder={isAi ? "e.g. Load a CSV into a table" : "e.g. Install Spoon"}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isAi) submit(); }}
        />
      </label>

      <label className="author-field">
        <span>Topic</span>
        <input
          className="author-input"
          value={topic}
          list="author-lab-topics"
          placeholder="Workshops"
          onChange={(e) => setTopic(e.target.value)}
        />
        <datalist id="author-lab-topics">
          {topics.map((t) => <option key={t} value={t} />)}
        </datalist>
      </label>

      {isAi ? (
        <label className="author-field">
          <span>Outline <span className="author-hint" style={{ display: "inline" }}>(optional)</span></span>
          <textarea
            className="author-input"
            rows={3}
            value={outline}
            placeholder="Points to cover, one per line — e.g. open Spoon; add CSV input; preview; run"
            onChange={(e) => setOutline(e.target.value)}
          />
        </label>
      ) : (
        <label className="author-field">
          <span>Kind</span>
          <select className="author-input" value={kind} onChange={(e) => setKind(e.target.value as "workshop" | "page")}>
            <option value="workshop">Workshop — steps the learner ticks off</option>
            <option value="page">Page — reference content, no tracked steps</option>
          </select>
        </label>
      )}

      {error && <p className="author-error">{error}</p>}
    </Modal>
  );
}
