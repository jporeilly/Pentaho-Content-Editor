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
import { Splitter, useSplit } from "./Splitter";
import { WelcomePane } from "./WelcomePane";
import { useProviderHealth, useCourses, useLab, useAi } from "./hooks";

// Pane floors, in px. Narrower than these and the pane stops being
// useful: the editor can no longer show a wrapped markdown line, and
// the preview stops representing what a learner's window looks like.
// Kept beside each other because the sidebar's clamp is derived from
// both of them.
const MIN_EDITOR = 320;
const MIN_PREVIEW = 300;
/** Width of a .author-splitter, matching the CSS `flex: 0 0 6px`. */
const SPLITTER_PX = 6;

/** Severity of a status message, read off the leader the callers use. */
function statusTone(s: string): "" | "is-ok" | "is-bad" | "is-warn" {
  if (!s) return "";
  if (s.startsWith("✗") || /^Save failed|failed:/i.test(s)) return "is-bad";
  if (s.startsWith("⚠")) return "is-warn";
  if (s.startsWith("✓") || s.startsWith("Saved")) return "is-ok";
  return "";
}

export function App() {
  // The one status line — shared across every action. It lives in the
  // bottom status bar, not the header: a long message (the save-conflict
  // warning is a full sentence) used to stretch the header's flex row
  // and push the Save button clean off the right of the window —
  // precisely when the author most needed to press it.
  const [status, setStatus] = useState<string>("");

  // Pane sizing. Both seams are draggable and remembered per browser;
  // double-click a divider to restore the default.
  //
  // The last argument is what must be left for the OTHER side of the
  // divider, and it differs per seam: drag the sidebar and the whole
  // editor+preview area has to survive; drag the editor and only the
  // preview does. Without it a wide sidebar could squeeze the panes to
  // nothing on a small window.
  const sidebar = useSplit(
    "pcm-author-sidebar-px", 260, 180, 480,
    MIN_EDITOR + SPLITTER_PX + MIN_PREVIEW,
  );
  const editor = useSplit(
    "pcm-author-editor-px", 620, MIN_EDITOR, 1400,
    MIN_PREVIEW + SPLITTER_PX,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // The Welcome page has no guide.md — it is generated from
  // course.json — so it gets its own pane rather than a lab slug.
  const [welcomeMode, setWelcomeMode] = useState(false);

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

  // Per-lab progress-tracking toggle (manifest.noProgress). Manifest-only
  // save: the guide text on disk is never touched by this control, so a
  // tab holding an older copy can't write it back. Pending edits stay pending.
  async function toggleTracking() {
    if (!course || !lab || !detail) return;
    const next = detail.manifest?.noProgress ? null : true;
    try {
      const updated = await api.saveLab(course, lab, null, { noProgress: next });
      setDetail(updated); // response carries the new manifest
      setStatus(next ? "Tracking off for this lab." : "Tracking on for this lab.");
      bumpStructure();
    } catch (e) {
      setStatus(`✗ Couldn't change tracking: ${(e as Error).message}`);
    }
  }

  // Per-lab timing (manifest.estimatedMinutes). The Welcome page's total
  // time is the sum of these, so authors set them here. Blank hands the
  // estimate back to the step-count heuristic. Manifest-only save: the
  // guide text on disk is never touched by this control.
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
      const updated = await api.saveLab(course, lab, null, { estimatedMinutes: minutes });
      setDetail(updated); // response carries the new manifest
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

      <div className="author-body" ref={sidebar.containerRef}>
        {sidebarOpen ? (
          <>
            <div className="author-structure-wrap" style={{ width: sidebar.px }}>
              <StructurePanel
                course={course}
                activeSlug={lab}
                onSelect={(slug) => { setWelcomeMode(false); setLab(slug); }}
                refreshKey={structureKey}
                onSources={setSources}
                onCollapse={() => setSidebarOpen(false)}
                welcomeActive={welcomeMode}
                onSelectWelcome={() => setWelcomeMode(true)}
              />
            </div>
            <Splitter
              label="Sidebar width"
              value={sidebar.px}
              onDrag={sidebar.set}
              onReset={sidebar.reset}
            />
          </>
        ) : (
          <button
            type="button"
            className="author-rail"
            onClick={() => setSidebarOpen(true)}
            title="Show the course structure"
          >
            »
          </button>
        )}
        {welcomeMode ? (
          <div className="author-panes" ref={editor.containerRef}>
            <WelcomePane
              course={course}
              refreshKey={structureKey}
              setStatus={setStatus}
              editorPx={editor.px}
              splitter={
                <Splitter
                  label="Editor / preview split"
                  value={editor.px}
                  onDrag={editor.set}
                  onReset={editor.reset}
                />
              }
            />
          </div>
        ) : detail ? (
          <div className="author-panes" ref={editor.containerRef}>
            <div className="author-editor-col" style={{ flexBasis: editor.px }}>
            <section className="author-editor">
              <div className="author-editor-bar">
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
              <Toolbar textarea={textareaRef.current} value={body} onChange={onBodyChange} />
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
            <Splitter
              label="Editor / preview split"
              value={editor.px}
              onDrag={editor.set}
              onReset={editor.reset}
            />
            <section className="author-preview">
              <Preview
                body={body}
                baseUrl={baseUrl}
                labSlug={lab}
                glossary={glossary}
                manifest={detail.manifest}
              />
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

      {/* Status bar — the one place actions report back. Full width so
          a long message wraps instead of shoving the header controls
          off-screen, and it sits where the eye already is after a save. */}
      <footer className={`author-statusbar ${statusTone(status)}`.trim()}>
        <span className="author-statusbar-text">{status || " "}</span>
        {status && (
          <button
            type="button"
            className="author-mini-btn author-statusbar-clear"
            onClick={() => setStatus("")}
            title="Clear this message"
          >
            Clear
          </button>
        )}
      </footer>
    </div>
  );
}
