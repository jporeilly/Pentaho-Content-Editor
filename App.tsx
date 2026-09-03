// Course Editor — MVP vertical slice.
//
// Pick a course -> pick a lab -> edit its guide.md with the insert-block
// toolbar -> see a live preview rendered by the app's own MarkdownBody
// -> save to disk (which re-stamps the manifest's derived metrics).
//
// Later phases add: structure tree with drag-reorder, course.json /
// manifest metadata forms, and new-course / new-lab UI (wrapping the
// same logic as the CLI scaffolder).

import { useRef, useState } from "react";
import { api } from "./api";
import { Toolbar } from "./Toolbar";
import { Preview } from "./Preview";
import { StructurePanel } from "./StructurePanel";
import { SettingsModal } from "./SettingsModal";
import { ImportModal } from "./ImportModal";
import { NewCourseModal } from "./NewCourseModal";
import { LabFilesModal } from "./LabFilesModal";
import { CourseSettingsModal } from "./CourseSettingsModal";
import { ChatPanel } from "./ChatPanel";
import { useProviderHealth, useCourses, useLab, useAi } from "./hooks";

export function App() {
  // The one header status line — shared across every action.
  const [status, setStatus] = useState<string>("");

  const { health, refreshHealth } = useProviderHealth();
  const { apiUp, courses, setCourses, course, setCourse, lab, setLab, glossary, onCourseCreated } =
    useCourses(setStatus);
  const {
    detail, setDetail, body, setBody, setDirty, dirty, saving, save,
    onBodyChange, insertAtCaret, textareaRef, baseUrl,
    structureKey, bumpStructure, lastRewrite, setLastRewrite,
  } = useLab(course, lab, setStatus);
  const {
    working, sources, setSources, reviewOut, setReviewOut, verifyOut, setVerifyOut,
    rewriteSelection, undoRewrite, uploadAndInsertImage, onEditorPaste, onEditorDrop,
    runReview, runVerify,
  } = useAi({
    course, body, setBody, setDirty, setStatus,
    textareaRef, insertAtCaret, bumpStructure, lastRewrite, setLastRewrite,
  });

  // One-click "commit + publish everything" from the toolbar: commits
  // this course's folder in the authoring repo (and pushes), then
  // publishes it to the distribution repo VMs sync from.
  const [publishing, setPublishing] = useState(false);
  async function publishAll() {
    if (!course) return;
    setPublishing(true);
    setStatus("Publishing…");
    try {
      const r = await api.publishCourse(course, undefined, true);
      const a = r.authoring;
      const authorNote = a
        ? a.committed
          ? `authoring ${String(a.commit).slice(0, 7)}`
          : "authoring clean"
        : "";
      const distNote = r.upToDate
        ? "distribution up to date"
        : `distribution ${r.commit.slice(0, 7)}`;
      setStatus(`✓ Published — ${authorNote}, ${distNote}`);
    } catch (e) {
      setStatus(`✗ Publish failed: ${(e as Error).message}`);
    } finally {
      setPublishing(false);
    }
  }

  // Per-lab progress-tracking toggle (manifest.noProgress). Saves the
  // current body along with the flag so nothing pending is lost.
  async function toggleTracking() {
    if (!course || !lab || !detail) return;
    const next = detail.manifest?.noProgress ? null : true;
    try {
      const updated = await api.saveLab(course, lab, body, { noProgress: next });
      setDetail(updated); // response carries the new manifest
      setDirty(false);
      setStatus(next ? "Tracking off for this lab." : "Tracking on for this lab.");
      bumpStructure();
    } catch (e) {
      setStatus(`✗ Couldn't change tracking: ${(e as Error).message}`);
    }
  }

  // Per-lab timing (manifest.estimatedMinutes). The Welcome page's total
  // time is the sum of these, so authors set them here. Blank hands the
  // estimate back to the step-count heuristic. Saves the current body
  // along with the value so nothing pending is lost.
  async function saveTiming(raw: string) {
    if (!course || !lab || !detail) return;
    const trimmed = raw.trim();
    const minutes = trimmed === "" ? null : Number(trimmed);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) {
      setStatus("✗ Timing must be a whole number of minutes (1–600), or blank for automatic.");
      return;
    }
    const current = (detail.manifest?.estimatedMinutes as number | undefined) ?? null;
    if (minutes === current) return;
    try {
      const updated = await api.saveLab(course, lab, body, { estimatedMinutes: minutes });
      setDetail(updated); // response carries the new manifest
      setDirty(false);
      setStatus(minutes === null
        ? `Timing back to automatic: ${String(updated.manifest?.estimatedMinutes)} min from the step count.`
        : `Timing set to ${minutes} min.`);
      bumpStructure();
    } catch (e) {
      setStatus(`✗ Couldn't change timing: ${(e as Error).message}`);
    }
  }

  // Modal / panel visibility.
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [showLabFiles, setShowLabFiles] = useState(false);
  const [showCourseSettings, setShowCourseSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  if (apiUp === false) {
    return (
      <div className="author-splash">
        <h1>Course Editor</h1>
        <p className="author-error">Can’t reach the editor API at {api.base}.</p>
        <p>Start it in a second terminal:</p>
        <pre>{`cd editor/api
pip install -r requirements.txt
uvicorn app:app --reload --port 8000`}</pre>
      </div>
    );
  }

  return (
    <div className="author-root">
      <header className="author-header">
        <span className="author-brand">Course Editor</span>
        <select
          className="author-select"
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          disabled={!courses.length}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
        <button type="button" className="author-tool" onClick={() => setShowNewCourse(true)} disabled={working} title="Create a new workshop course from scratch">
          ✚ New Course
        </button>
        <button type="button" className="author-tool" onClick={() => setShowImport(true)} disabled={working} title="Create a course from a PDF / DOCX / PPTX / Markdown document">
          ⬆ Import
        </button>
        <button type="button" className="author-tool" onClick={() => setShowCourseSettings(true)} disabled={working || !course} title="Edit course title, description, accent, and assistant models">
          ⚙ Course
        </button>
        <button type="button" className="author-tool" onClick={runVerify} disabled={working || !course} title="Check this course against the publishing guidelines">
          ✓ Verify
        </button>
        <button
          type="button"
          className="author-tool"
          onClick={publishAll}
          disabled={working || publishing || !course}
          title="One click, whole loop: commit + push the authoring repo, then publish this course to the distribution repo VMs sync from"
        >
          {publishing ? "Publishing…" : "⇧ Publish"}
        </button>
        <div className="author-header-spacer" />
        <span className="author-status">{status}</span>
        <button type="button" className={`author-tool${showChat ? " is-active" : ""}`} onClick={() => setShowChat((v) => !v)} title="Toggle the AI assistant chat">
          💬 Chat
        </button>
        <button
          type="button"
          className={`author-conn ${health?.ok ? "is-ok" : "is-bad"}`}
          onClick={() => setShowSettings(true)}
          title={health ? `${health.provider} · ${health.detail}${health.model ? ` · ${health.model}` : ""} — click to configure` : "AI provider — click to configure"}
        >
          <span className="author-conn-dot" />
          {health ? `${health.provider}${health.model ? ` · ${health.model}` : ""}` : "AI"}
          <span className="author-conn-gear">⚙</span>
        </button>
        <button
          type="button"
          className="author-save"
          onClick={save}
          disabled={!dirty || saving || !detail}
        >
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </header>

      {sources.length > 0 && (
        <div className="author-sources">
          <span className="author-sources-label">📚 Grounded in Pentaho docs:</span>
          {sources.map((s, i) => (
            <a key={i} className="author-source-link" href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
              {s.title}
            </a>
          ))}
          <button type="button" className="author-mini-btn" onClick={() => setSources([])}>Dismiss</button>
        </div>
      )}

      {reviewOut && (
        <div className="author-verify is-review">
          <div className="author-verify-head">
            <span>🔍 AI review</span>
            <button type="button" className="author-mini-btn" onClick={() => setReviewOut(null)}>Dismiss</button>
          </div>
          <pre className="author-verify-body">{reviewOut}</pre>
        </div>
      )}

      {verifyOut && (
        <div className={`author-verify ${verifyOut.ok ? "is-ok" : "is-bad"}`}>
          <div className="author-verify-head">
            <span>{verifyOut.ok ? "✓ Verify passed" : "⚠ Verify found issues"}</span>
            <button type="button" className="author-mini-btn" onClick={() => setVerifyOut(null)}>Dismiss</button>
          </div>
          <pre className="author-verify-body">{verifyOut.output}</pre>
        </div>
      )}

      <div className="author-body">
        <StructurePanel
          course={course}
          activeSlug={lab}
          onSelect={setLab}
          refreshKey={structureKey}
          onSources={setSources}
        />
        {detail ? (
          <div className="author-panes">
            <div className="author-editor-col">
            <section className="author-editor">
              <div className="author-editor-bar">
                <Toolbar textarea={textareaRef.current} value={body} onChange={onBodyChange} />
                <button
                  type="button"
                  className={`author-toolbar-btn author-rewrite${lastRewrite ? " is-undo" : ""}`}
                  onClick={lastRewrite ? undoRewrite : rewriteSelection}
                  disabled={working || (!lastRewrite && health?.ok === false)}
                  title={
                    lastRewrite
                      ? "Undo the last AI rewrite (restore the original text)"
                      : health?.ok === false
                        ? "AI provider not ready — see Settings"
                        : "Rewrite the selected text with AI"
                  }
                >
                  {lastRewrite ? "↺ Reset" : "✨ Rewrite"}
                </button>
                <button type="button" className="author-toolbar-btn" onClick={() => imageInputRef.current?.click()} disabled={working} title="Upload an image (or paste / drop one into the editor)">
                  🖼 Image
                </button>
                <button type="button" className="author-toolbar-btn" onClick={() => setShowLabFiles(true)} disabled={working} title="Manage this lab's downloadable files (.ktr / .kjb / data)">
                  📎 Files
                </button>
                <button
                  type="button"
                  className={`author-toolbar-btn${detail?.manifest?.noProgress ? " is-active" : ""}`}
                  onClick={toggleTracking}
                  disabled={working || !detail || detail.manifest?.kind === "page"}
                  title={
                    detail?.manifest?.kind === "page"
                      ? "Pages never track steps"
                      : detail?.manifest?.noProgress
                        ? "Tracking is OFF for this lab (no checkboxes / step numbers) — click to turn it on"
                        : "Tracking is ON — click to turn off checkboxes, progress, and step numbers for this lab"
                  }
                >
                  {detail?.manifest?.noProgress ? "◻ No tracking" : "☑ Tracking"}
                </button>
                <label
                  className="author-toolbar-timing"
                  title="Estimated minutes for this lab — the Welcome page's total time is the sum across labs. Blank = estimate from the step count."
                >
                  ⏱
                  <input
                    // Uncontrolled + keyed so switching labs (or a save) re-seeds the
                    // value without saving on every keystroke; blur / Enter commits.
                    key={`${lab ?? ""}:${String(detail?.manifest?.estimatedMinutes ?? "")}`}
                    type="number" min={1} max={600} step={5}
                    className="author-toolbar-select"
                    defaultValue={(detail?.manifest?.estimatedMinutes as number | undefined) ?? ""}
                    disabled={working || !detail}
                    onBlur={(e) => saveTiming(e.currentTarget.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  />
                  min
                </label>
                <button type="button" className="author-toolbar-btn author-review-btn" onClick={runReview} disabled={working || health?.ok === false} title={health?.ok === false ? "AI provider not ready — see Settings" : "AI review of this lab (quality, accuracy, completeness)"}>
                  🔍 Review
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAndInsertImage(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <textarea
                ref={textareaRef}
                className="author-textarea"
                value={body}
                spellCheck
                onChange={(e) => onBodyChange(e.target.value)}
                onPaste={onEditorPaste}
                onDrop={onEditorDrop}
              />
            </section>
            {showChat && (
              <ChatPanel
                onClose={() => setShowChat(false)}
                context={body}
                onInsert={insertAtCaret}
                ready={health?.ok !== false}
              />
            )}
            </div>
            <section className="author-preview">
              <Preview body={body} baseUrl={baseUrl} labSlug={lab} glossary={glossary} />
            </section>
          </div>
        ) : (
          <div className="author-splash"><p>Select a lab to edit.</p></div>
        )}
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => { refreshHealth(); bumpStructure(); }}
        />
      )}

      {showNewCourse && (
        <NewCourseModal
          onClose={() => setShowNewCourse(false)}
          onCreated={onCourseCreated}
        />
      )}

      {showLabFiles && course && lab && (
        <LabFilesModal
          course={course}
          lab={lab}
          onClose={() => setShowLabFiles(false)}
          onInsert={(text) => { insertAtCaret(text); setShowLabFiles(false); }}
        />
      )}

      {showCourseSettings && course && (
        <CourseSettingsModal
          course={course}
          onClose={() => setShowCourseSettings(false)}
          onSaved={() => { api.listCourses().then(setCourses); bumpStructure(); }}
          onDeleted={() => {
            setShowCourseSettings(false);
            setLab("");
            // Re-fetch the course list and land on the first remaining
            // course (or none — the picker shows the empty state).
            api.listCourses().then((cs) => {
              setCourses(cs);
              setCourse(cs[0]?.id ?? "");
            });
          }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onBuilt={(courseId, srcs) => {
            onCourseCreated(courseId);
            setSources(srcs);
            setStatus(`Imported “${courseId}” — review the AI-drafted labs.`);
          }}
        />
      )}
    </div>
  );
}
