// New-course modal. Replaces the old window.prompt/confirm flow, which
// was fragile (native dialogs, invisible errors) — the "click OK, nothing
// happens" report. All courses are hands-on workshops built from scratch,
// so there's no academy option: just a title, and errors show inline.

import { useState } from "react";
import { api } from "./api";

interface NewCourseModalProps {
  onClose: () => void;
  onCreated: (courseId: string) => void;
}

export function NewCourseModal({ onClose, onCreated }: NewCourseModalProps) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    const t = title.trim();
    if (!t) { setError("Give the course a title."); return; }
    setBusy(true);
    setError("");
    try {
      const created = await api.createCourse(t, "workshop");
      onCreated(created.id);
      onClose();
    } catch (e) {
      setError((e as Error).message || "Couldn’t create the course.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="author-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="author-modal" onClick={(e) => e.stopPropagation()}>
        <div className="author-modal-head">
          <span>New course</span>
          {!busy && <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>}
        </div>
        <div className="author-modal-body">
          <label className="author-field">
            <span>Course title</span>
            <input
              className="author-input"
              value={title}
              autoFocus
              placeholder="e.g. Pentaho Data Integration Basics"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            />
          </label>
          <p className="author-hint">
            Creates a hands-on workshop with a starter “Getting Started” lab
            you can edit right away.
          </p>
          {error && <p className="author-error">{error}</p>}
        </div>
        <div className="author-modal-foot">
          <button type="button" className="author-tool" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="author-save" onClick={create} disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create course"}
          </button>
        </div>
      </div>
    </div>
  );
}
