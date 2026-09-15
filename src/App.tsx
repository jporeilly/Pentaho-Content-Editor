// Pentaho Content Editor — MVP vertical slice.
//
// Pick a course -> pick a lab -> edit its guide.md with the insert-block
// toolbar -> see a live preview rendered by the app's own MarkdownBody
// -> save to disk (which re-stamps the manifest's derived metrics).
//
// Later phases add: structure tree with drag-reorder, course.json /
// manifest metadata forms, and new-course / new-lab UI (wrapping the
// same logic as the CLI scaffolder).

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { linkScrollers } from "./scrollSync";
import { highlightMarkdown } from "./markdownTokens";
import { Toolbar } from "./Toolbar";
import { FindBar } from "./FindBar";
import { Preview } from "./Preview";
import { StructurePanel } from "./StructurePanel";
import { SettingsModal } from "./SettingsModal";
import { ImportModal } from "./ImportModal";
import { NewCourseModal } from "./NewCourseModal";
import { LabFilesModal } from "./LabFilesModal";
import { CourseSettingsModal } from "./CourseSettingsModal";
import { ChatPanel } from "./ChatPanel";
import { Splitter, useSplit } from "./Splitter";
import { Menu } from "./Menu";
import { useEditorTheme, EDITOR_THEMES } from "./theme";
import { handleMarkdownKey } from "./markdownKeys";
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
  const theme = useEditorTheme();
  // The Welcome page has no guide.md — it is generated from
  // course.json — so it gets its own pane rather than a lab slug.
  const [welcomeMode, setWelcomeMode] = useState(false);

  const { health, refreshHealth } = useProviderHealth();
  const { apiUp, courses, setCourses, course, setCourse, lab, setLab, glossary, courseVersion, onCourseCreated } =
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
  const previewRef = useRef<HTMLElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const [showFind, setShowFind] = useState(false);

  // Colour the markdown source with the same hues the insert menus use:
  // a heading is blue in both, Media is cyan in both. Remembered per
  // browser, and switchable from the Theme menu — the layer has to line
  // up with the textarea character for character, and if a font ever
  // makes it drift, turning it off must not mean editing CSS.
  const [syntaxColour, setSyntaxColour] = useState<boolean>(() => {
    try { return localStorage.getItem("pcm-author-syntax") !== "off"; } catch { return true; }
  });
  function toggleSyntaxColour() {
    setSyntaxColour((on) => {
      const next = !on;
      try { localStorage.setItem("pcm-author-syntax", next ? "on" : "off"); } catch { /* best effort */ }
      return next;
    });
  }
  // Re-tokenised per keystroke. A guide is a few hundred lines and this
  // is one pass with no backtracking, so it costs less than the render
  // it feeds.
  const highlighted = useMemo(
    () => (syntaxColour ? highlightMarkdown(body) : ""),
    [body, syntaxColour],
  );

  // Ctrl/Cmd+F opens find & replace. Captured on the window rather than
  // the textarea so it works wherever the focus happens to be, and
  // preventDefault stops the browser's own find bar, which searches the
  // RENDERED page - so it would hit the preview and the sidebar, never
  // the markdown source the author is actually editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowFind(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the two panes looking at the same part of the lab.
  //
  // Re-linked when the open lab changes or the Welcome pane swaps in,
  // because those unmount the preview section and the ref goes stale.
  //
  // `detail` is in the deps and has to be: a lab is selected BEFORE its
  // body arrives, so on the `lab` change alone this effect ran against a
  // textarea that had not mounted yet, found a null ref, and never re-ran
  // — the panes simply never linked. `detail` landing is what puts both
  // elements on the page.
  //
  // NOT on `body`: that changes on every keystroke, and tearing the
  // listeners down and back up mid-gesture loses the scroll in progress.
  useEffect(() => {
    const ta = textareaRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    return linkScrollers(ta, pv);
  }, [lab, welcomeMode, detail, textareaRef]);

  if (apiUp === false) {
    return (
      <div className="author-splash">
        <h1>Pentaho Content Editor</h1>
        <p className="author-error">Can’t reach the editor API at {api.base}.</p>
        <p>Start both halves from the repository root:</p>
        <pre>{`.\\start-editor.ps1`}</pre>
        <p>Or just the API, in a second terminal:</p>
        <pre>{`cd api
.venv\\Scripts\\python -m uvicorn app:app --port 8000`}</pre>
        <p className="author-hint">
          No <code>.venv</code> yet? Create it once:{" "}
          <code>py -3 -m venv api\.venv</code> then{" "}
          <code>api\.venv\Scripts\python -m pip install -r api\requirements.txt</code>
        </p>
      </div>
    );
  }

  return (
    <div className="author-root">
      <header className="author-header">
        <span className="author-brand">Pentaho Content Editor</span>
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
        <Menu
          label="Theme"
          title="Editor appearance, and which theme the preview renders in"
          items={[
            // Editor palettes first, then the preview pair. The preview
            // stays two-valued on purpose: it simulates what a learner
            // can actually have, and the app ships light and dark only.
            ...EDITOR_THEMES.map((t) => ({
              label: `${theme.editor === t.id ? "* " : "\u00a0\u00a0"}Editor - ${t.label}`,
              title: t.hint,
              onSelect: () => theme.setEditor(t.id),
            })),
            { label: `${syntaxColour ? "* " : "\u00a0\u00a0"}Colour the markdown`,
              title: "Tint the source with the same hues the insert menus use - headings blue, media cyan, code green",
              onSelect: toggleSyntaxColour },
            { label: `${theme.preview === "light" ? "* " : "\u00a0\u00a0"}Preview - Light`,
              title: "Render the preview the way a learner on the light theme sees it",
              onSelect: () => theme.setPreview("light") },
            { label: `${theme.preview === "dark" ? "* " : "\u00a0\u00a0"}Preview - Dark`,
              title: "Render the preview on the app's dark surface - catches hard-coded colours and white-background screenshots",
              onSelect: () => theme.setPreview("dark") },
          ]}
        />
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
              // The Chat toggle used to flip to active here and render
              // nothing, because the panel only existed in the lab
              // branch. There is no caret on this page, so the panel
              // comes without its Insert action rather than with one
              // that does nothing.
              chat={
                showChat ? (
                  <ChatPanel
                    onClose={() => setShowChat(false)}
                    context={`Welcome page for the course "${course}".`}
                    onInsert={() => {}}
                    canInsert={false}
                    ready={health?.ok !== false}
                  />
                ) : null
              }
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
              {showFind && (
                <FindBar
                  body={body}
                  onChange={onBodyChange}
                  textarea={textareaRef.current}
                  onClose={() => setShowFind(false)}
                  onStatus={setStatus}
                />
              )}
              {/* The textarea and its colour layer share this box so the
                  layer can sit exactly over the text and nothing else —
                  positioned on the section instead, `inset: 0` would put
                  it over the toolbar too. */}
              <div className="author-editor-stack">
              <textarea
                ref={textareaRef}
                className="author-textarea"
                value={body}
                spellCheck
                onChange={(e) => onBodyChange(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl+B/I/K, Tab indent, Enter continues a list.
                  // handleMarkdownKey returns null for anything it
                  // doesn't own, so Ctrl+S still reaches the save
                  // handler and ordinary typing is untouched.
                  const ta = e.currentTarget;
                  const edit = handleMarkdownKey(e, {
                    text: body, start: ta.selectionStart, end: ta.selectionEnd,
                  });
                  if (!edit) return;
                  e.preventDefault();
                  onBodyChange(edit.text);
                  // After React commits the new value, not before.
                  requestAnimationFrame(() => ta.setSelectionRange(edit.start, edit.end));
                }}
                onPaste={onEditorPaste}
                onDrop={onEditorDrop}
                onScroll={(e) => {
                  // Keep the colour layer under the text it belongs to.
                  const h = highlightRef.current;
                  if (!h) return;
                  h.scrollTop = e.currentTarget.scrollTop;
                  h.scrollLeft = e.currentTarget.scrollLeft;
                }}
              />
              {syntaxColour && (
                /* The colour layer, BEHIND a textarea whose own text is
                   transparent. A textarea cannot colour its contents, so
                   this is the only way short of replacing it outright.
                   aria-hidden: it is a duplicate of text the textarea
                   already exposes, and a screen reader should not meet
                   the guide twice. */
                <pre
                  ref={highlightRef}
                  className="author-highlight"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              )}
              </div>
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
            <section className="author-preview" ref={previewRef}>
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
        {/* Which content and which build - the same pairing the
            learner's sidebar shows, so a screenshot from either side
            identifies itself. */}
        <span
          className="author-version"
          title="Course content version (course.json) and the app build this editor ships with"
        >
          {courseVersion ? `Course v${courseVersion} \u00b7 ` : ""}Editor v{__APP_VERSION__}
        </span>
      </footer>
    </div>
  );
}
