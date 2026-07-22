// Import modal — create a course from a document (PDF/DOCX/PPTX/MD/TXT).
// Outline-first: upload → the LLM proposes a course structure → the author
// reviews/edits the titles → build (generates each lab from the outline +
// source). Requires an LLM provider to be configured (Settings ⚙).

import { useState } from "react";
import { api, type Outline } from "./api";

interface ImportModalProps {
  onClose: () => void;
  /** Called with the new course id after a successful build. */
  onBuilt: (courseId: string) => void;
}

type Phase = "pick" | "review" | "building";

export function ImportModal({ onClose, onBuilt }: ImportModalProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [importId, setImportId] = useState("");
  const [outline, setOutline] = useState<Outline | null>(null);
  const [kind] = useState<"workshop" | "academy">("workshop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.importOutline(file);
      setImportId(res.importId);
      setOutline(res.outline);
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!outline) return;
    setPhase("building");
    setBusy(true);
    setError("");
    try {
      const res = await api.importBuild(importId, outline, kind);
      onBuilt(res.courseId);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPhase("review");
    } finally {
      setBusy(false);
    }
  }

  // Outline editing helpers
  function setCourseTitle(v: string) {
    setOutline((o) => (o ? { ...o, courseTitle: v } : o));
  }
  function setLabTitle(ti: number, li: number, v: string) {
    setOutline((o) => {
      if (!o) return o;
      const next = structuredClone(o);
      next.topics[ti].labs[li].title = v;
      return next;
    });
  }
  function setTopicTitle(ti: number, v: string) {
    setOutline((o) => {
      if (!o) return o;
      const next = structuredClone(o);
      next.topics[ti].title = v;
      return next;
    });
  }
  function removeLab(ti: number, li: number) {
    setOutline((o) => {
      if (!o) return o;
      const next = structuredClone(o);
      next.topics[ti].labs.splice(li, 1);
      return next;
    });
  }

  const labCount = outline?.topics.reduce((n, t) => n + t.labs.length, 0) ?? 0;

  return (
    <div className="author-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="author-modal" onClick={(e) => e.stopPropagation()}>
        <div className="author-modal-head">
          <span>Create a course from a document</span>
          {!busy && <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>}
        </div>

        <div className="author-modal-body">
          {phase === "pick" && (
            <>
              <p className="author-hint">
                Upload a PDF, DOCX, PPTX, Markdown, or text file. The AI will
                propose a course outline you can edit before it builds the labs.
              </p>
              <input
                type="file"
                accept=".pdf,.docx,.pptx,.md,.markdown,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && <p className="author-hint">Selected: {file.name}</p>}
            </>
          )}

          {phase === "review" && outline && (
            <>
              <label className="author-field">
                <span>Course title</span>
                <input
                  className="author-input"
                  value={outline.courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                />
              </label>
              <p className="author-hint">{labCount} lab(s) proposed — edit or remove any, then build.</p>
              {outline.topics.map((topic, ti) => (
                <div key={ti} className="author-outline-topic">
                  <input
                    className="author-input author-outline-topic-title"
                    value={topic.title}
                    onChange={(e) => setTopicTitle(ti, e.target.value)}
                  />
                  {topic.labs.map((lab, li) => (
                    <div key={li} className="author-outline-lab">
                      <input
                        className="author-input"
                        value={lab.title}
                        onChange={(e) => setLabTitle(ti, li, e.target.value)}
                        title={lab.summary}
                      />
                      <button type="button" className="author-mini-btn" onClick={() => removeLab(ti, li)} title="Remove lab">✕</button>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {phase === "building" && (
            <p>Generating {labCount} lab(s) with the AI… this can take a minute.</p>
          )}

          {error && <p className="author-error">{error}</p>}
        </div>

        <div className="author-modal-foot">
          {phase === "pick" && (
            <>
              <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
              <button type="button" className="author-save" onClick={analyze} disabled={!file || busy}>
                {busy ? "Analyzing…" : "Analyze"}
              </button>
            </>
          )}
          {phase === "review" && (
            <>
              <button type="button" className="author-tool" onClick={() => setPhase("pick")} disabled={busy}>Back</button>
              <button type="button" className="author-save" onClick={build} disabled={busy || labCount === 0}>
                Build course ({labCount})
              </button>
            </>
          )}
          {phase === "building" && <span className="author-status">Building…</span>}
        </div>
      </div>
    </div>
  );
}
