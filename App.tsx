// Course Editor — MVP vertical slice.
//
// Pick a course -> pick a lab -> edit its guide.md with the insert-block
// toolbar -> see a live preview rendered by the app's own MarkdownBody
// -> save to disk (which re-stamps the manifest's derived metrics).
//
// Later phases add: structure tree with drag-reorder, course.json /
// manifest metadata forms, and new-course / new-lab UI (wrapping the
// same logic as the CLI scaffolder).

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { api, type CourseSummary, type LabDetail, type ProviderHealth, type Source } from "./api";
import { Toolbar } from "./Toolbar";
import { Preview } from "./Preview";
import { StructurePanel } from "./StructurePanel";
import { SettingsModal } from "./SettingsModal";
import { ImportModal } from "./ImportModal";
import { NewCourseModal } from "./NewCourseModal";
import { LabFilesModal } from "./LabFilesModal";
import { CourseSettingsModal } from "./CourseSettingsModal";

export function App() {
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [course, setCourse] = useState<string>("");
  const [lab, setLab] = useState<string>("");

  const [detail, setDetail] = useState<LabDetail | null>(null);
  const [body, setBody] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [glossary, setGlossary] = useState<Record<string, string>>({});
  const [structureKey, setStructureKey] = useState(0);
  const [verifyOut, setVerifyOut] = useState<{ ok: boolean; output: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  // One-level undo for the last AI rewrite (so the button can toggle
  // between Rewrite and Reset). Cleared on any manual edit or lab switch.
  const [lastRewrite, setLastRewrite] = useState<{ start: number; end: number; original: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showNewCourse, setShowNewCourse] = useState(false);
  // Pentaho docs the last AI action was grounded in (shown as citations).
  const [sources, setSources] = useState<Source[]>([]);
  const [reviewOut, setReviewOut] = useState<string | null>(null);
  const [showLabFiles, setShowLabFiles] = useState(false);
  const [showCourseSettings, setShowCourseSettings] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Boot: health + course list ────────────────────────────────────
  useEffect(() => {
    api
      .health()
      .then(() => {
        setApiUp(true);
        return api.listCourses();
      })
      .then((cs) => {
        setCourses(cs);
        if (cs.length) setCourse(cs[0].id);
      })
      .catch(() => setApiUp(false));
  }, []);

  const refreshHealth = useCallback(() => {
    api.providerHealth().then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  // ── Course change: pick first lab + load glossary ─────────────────
  useEffect(() => {
    if (!course) return;
    setLab("");
    setDetail(null);
    setBody("");
    api
      .listLabs(course)
      .then((ls) => {
        if (ls.length) setLab(ls[0].slug);
      })
      .catch((e) => setStatus(`Couldn’t load labs: ${(e as Error).message}`));
    // Glossary is best-effort — served through the tree endpoint.
    fetch(`${api.base}/api/courses/${course}/tree/glossary.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((g) => setGlossary(g ?? {}))
      .catch(() => setGlossary({}));
  }, [course]);

  // ── Lab change: load body ─────────────────────────────────────────
  useEffect(() => {
    if (!course || !lab) return;
    let cancelled = false;
    api
      .getLab(course, lab)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setBody(d.body);
        setDirty(false);
        setLastRewrite(null);
        setStatus("");
      })
      .catch((e) => {
        if (!cancelled) setStatus(`Couldn’t load lab: ${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [course, lab]);

  const baseUrl = useMemo(
    () => (course && lab ? api.assetBaseUrl(course, lab) : ""),
    [course, lab],
  );

  const onBodyChange = useCallback((next: string, caret?: number) => {
    setBody(next);
    setDirty(true);
    setLastRewrite(null); // a manual edit invalidates the rewrite undo range
    if (caret !== undefined && textareaRef.current) {
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(caret, caret);
      });
    }
  }, []);

  const save = useCallback(async () => {
    if (!course || !lab) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const updated = await api.saveLab(course, lab, body);
      setDetail(updated);
      setDirty(false);
      setStructureKey((k) => k + 1); // refresh titles/metadata in the tree
      const m = updated.manifest as any;
      setStatus(`Saved · ${m.stepCount} steps · ~${m.estimatedMinutes} min${m.hasVideo ? " · has video" : ""}`);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [course, lab, body]);

  // After a course is created/imported: refresh the list, select it, and
  // announce it. Shared by New Course and Import.
  const onCourseCreated = useCallback(async (courseId: string) => {
    try {
      const list = await api.listCourses();
      setCourses(list);
      setCourse(courseId); // switches, loads its starter lab
      setStatus(`Opened course “${courseId}”.`);
    } catch (e) {
      setStatus(`Created, but couldn’t refresh: ${(e as Error).message}`);
    }
  }, []);

  const rewriteSelection = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    if (!selected.trim()) {
      setStatus("Select some text in the editor first, then Rewrite.");
      return;
    }
    setWorking(true);
    setStatus("Rewriting selection…");
    try {
      const { text, sources: srcs } = await api.rewrite(selected);
      const next = body.slice(0, start) + text + body.slice(end);
      setBody(next);
      setDirty(true);
      setLastRewrite({ start, end: start + text.length, original: selected });
      setSources(srcs ?? []);
      setStatus("Rewrote selection — review, Reset to undo, or Save.");
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start, start + text.length);
      });
    } catch (e) {
      setStatus(`Rewrite failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }, [body]);

  const undoRewrite = useCallback(() => {
    if (!lastRewrite) return;
    const { start, end, original } = lastRewrite;
    const next = body.slice(0, start) + original + body.slice(end);
    setBody(next);
    setDirty(true);
    setLastRewrite(null);
    setStatus("Reverted the rewrite.");
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(start, start + original.length); }
    });
  }, [body, lastRewrite]);

  const insertAtCaret = useCallback((text: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? body.length;
    onBodyChange(body.slice(0, start) + text + body.slice(end), start + text.length);
  }, [body, onBodyChange]);

  const uploadAndInsertImage = useCallback(async (file: File | Blob, filename?: string) => {
    if (!course) return;
    setWorking(true);
    setStatus("Uploading image…");
    try {
      const { name, path } = await api.uploadAsset(course, file, filename);
      insertAtCaret(`![${name}](${path})\n\n`);
      setStatus(`Inserted ${name}.`);
      setStructureKey((k) => k + 1);
    } catch (e) {
      setStatus(`Image upload failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }, [course, insertAtCaret]);

  const onEditorPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    for (const it of Array.from(e.clipboardData?.items ?? [])) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); uploadAndInsertImage(f, `pasted-${Date.now()}.png`); return; }
      }
    }
  }, [uploadAndInsertImage]);

  const onEditorDrop = useCallback((e: DragEvent<HTMLTextAreaElement>) => {
    const imgs = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (imgs.length) { e.preventDefault(); imgs.forEach((f) => uploadAndInsertImage(f)); }
  }, [uploadAndInsertImage]);

  const runReview = useCallback(async () => {
    if (!body.trim()) { setStatus("Nothing to review yet."); return; }
    setWorking(true);
    setStatus("Reviewing lab with AI…");
    setReviewOut(null);
    try {
      const { review, sources: srcs } = await api.review(body);
      setReviewOut(review);
      setSources(srcs ?? []);
      setStatus("Review ready — see the panel.");
    } catch (e) {
      setStatus(`Review failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }, [body]);

  const runVerify = useCallback(async () => {
    if (!course) return;
    setWorking(true);
    setVerifyOut(null);
    setStatus("Verifying…");
    try {
      const res = await api.verifyCourse(course);
      setVerifyOut(res);
      setStatus(res.ok ? "Verify passed ✓" : "Verify found issues — see panel");
    } catch (e) {
      setStatus(`Verify failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }, [course]);

  // Ctrl/Cmd+S to save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

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
        <div className="author-header-spacer" />
        <span className="author-status">{status}</span>
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
          onSaved={() => { refreshHealth(); setStructureKey((k) => k + 1); }}
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
          onSaved={() => { api.listCourses().then(setCourses); setStructureKey((k) => k + 1); }}
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
