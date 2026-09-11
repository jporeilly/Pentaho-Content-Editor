// Welcome-page editor.
//
// The Welcome page has no guide.md — the learner app generates it
// entirely from course.json plus the topic tree, so there was nowhere
// to "edit" it. Its fields were buried in the ⚙ Course modal as a
// blind form: type a video URL, save, switch to the app, look.
//
// This pane puts those fields beside a live WelcomeScreen rendered by
// the app's own component, so the author edits the page they can see —
// the same deal the lab editor gives them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Structure } from "./api";
import { WelcomeScreen } from "../components/WelcomeScreen";
import type { CourseManifest, TopicNode } from "../content/types";

interface WelcomePaneProps {
  course: string;
  /** Bumped by the parent when the structure changes, so the outline
   *  preview picks up renames / reorders. */
  refreshKey?: number;
  setStatus: (s: string) => void;
  /** Editor-pane width, in px — the splitter drives it here too. */
  editorPx: number;
  /** The shell's pane divider, rendered between form and preview. */
  splitter?: React.ReactNode;
  /** The AI assistant, rendered under the form exactly as it sits under
   *  the guide textarea. Passed in rather than mounted here so the
   *  shell keeps ownership of the Chat toggle. */
  chat?: React.ReactNode;
}

interface ModuleSummary { title: string; summary: string }

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Editor Structure -> the app's TopicNode[], so WelcomeScreen can
 *  render the real outline with the real lab titles. */
function toTopics(structure: Structure): TopicNode[] {
  return structure.topics.map((t) => ({
    slug: t.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    title: t.title,
    labs: t.labs.map((l) => ({ slug: l.slug, title: l.title, kind: l.kind })),
  }));
}

export function WelcomePane({ course, refreshKey, setStatus, editorPx, splitter, chat }: WelcomePaneProps) {
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [structure, setStructure] = useState<Structure>({ topics: [] });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Edited fields.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eyebrow, setEyebrow] = useState("");
  const [video, setVideo] = useState("");
  const [caption, setCaption] = useState("");
  const [analyticsNote, setAnalyticsNote] = useState("");
  const [summaries, setSummaries] = useState<ModuleSummary[]>([]);

  const load = useCallback(() => {
    if (!course) return;
    api.getCourse(course).then((c) => {
      setRaw(c);
      const w = (c.welcome ?? {}) as Record<string, unknown>;
      setTitle(str(c.title));
      setDescription(str(c.description));
      setEyebrow(str(w.eyebrow));
      setVideo(str(w.video));
      setCaption(str(w.caption));
      setAnalyticsNote(str(w.analyticsNote));
      setSummaries(
        Array.isArray(c.moduleSummaries)
          ? (c.moduleSummaries as ModuleSummary[]).map((m) => ({
              title: str(m?.title),
              summary: str(m?.summary),
            }))
          : [],
      );
      setDirty(false);
    }).catch((e) => setStatus(`✗ Couldn't load course.json: ${(e as Error).message}`));
    api.getStructure(course).then(setStructure).catch(() => setStructure({ topics: [] }));
  }, [course, setStatus]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const topics = useMemo(() => toTopics(structure), [structure]);

  // What the learner would see with the current form values — built
  // from the real course.json so untouched fields (theme, tier,
  // launchers, certification) preview correctly too.
  const previewCourse = useMemo<CourseManifest | null>(() => {
    if (!raw) return null;
    const welcome: Record<string, unknown> = { ...(raw.welcome as object ?? {}) };
    welcome.eyebrow = eyebrow || undefined;
    welcome.video = video || undefined;
    welcome.caption = caption || undefined;
    welcome.analyticsNote = analyticsNote || undefined;
    return {
      ...(raw as unknown as CourseManifest),
      title,
      description,
      welcome,
      moduleSummaries: summaries.filter((m) => m.title.trim()),
    } as CourseManifest;
  }, [raw, title, description, eyebrow, video, caption, analyticsNote, summaries]);

  const firstSlug = topics[0]?.labs[0]?.slug ?? null;

  function edit<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setDirty(true); };
  }

  // Add a row for every topic in the outline that has no summary yet —
  // the Welcome outline shows a blurb per module, and hand-matching
  // titles to SUMMARY.md was the fiddly part of keeping them in sync.
  function syncSummaryRows() {
    const have = new Set(summaries.map((m) => m.title.trim()));
    const missing = topics
      .map((t) => t.title)
      .filter((t) => !have.has(t.trim()))
      .map((t) => ({ title: t, summary: "" }));
    if (!missing.length) {
      setStatus("Every topic already has a summary row.");
      return;
    }
    setSummaries([...summaries, ...missing]);
    setDirty(true);
    setStatus(`Added ${missing.length} summary row${missing.length === 1 ? "" : "s"} — write the blurbs, then Save.`);
  }

  async function save() {
    if (!course) return;
    setSaving(true);
    setStatus("Saving the Welcome page…");
    try {
      const welcomeRest = { ...(raw?.welcome as object ?? {}) } as Record<string, unknown>;
      for (const k of ["eyebrow", "video", "caption", "analyticsNote"]) delete welcomeRest[k];
      await api.putCourse(course, {
        title: title.trim(),
        description: description.trim(),
        welcome: {
          ...welcomeRest,
          eyebrow: eyebrow.trim() || undefined,
          video: video.trim() || undefined,
          caption: caption.trim() || undefined,
          analyticsNote: analyticsNote.trim() || undefined,
        },
        moduleSummaries: summaries
          .filter((m) => m.title.trim())
          .map((m) => ({ title: m.title.trim(), summary: m.summary.trim() })),
      });
      setDirty(false);
      setStatus("✓ Welcome page saved to course.json.");
      load();
    } catch (e) {
      setStatus(`✗ Couldn't save the Welcome page: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="author-editor-col" style={{ flexBasis: editorPx }}>
        <div className="author-editor-bar">
          <span className="author-toolbar-label">Welcome page</span>
          <span className="author-welcome-note">
            Generated from <code>course.json</code> — there is no guide.md for this page.
          </span>
          <span className="author-header-spacer" />
          <button
            type="button"
            className="author-mini-btn"
            onClick={syncSummaryRows}
            title="Add a summary row for every topic in the outline that doesn't have one"
          >
            ⟳ Sync topics
          </button>
          <button type="button" className="author-save" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>

        <div className="author-form">
          <label className="author-field">
            <span>Course title</span>
            <input className="author-input" value={title} onChange={(e) => edit(setTitle)(e.target.value)} />
          </label>
          <label className="author-field">
            <span>Description</span>
            <textarea
              className="author-input author-textarea-sm"
              rows={3}
              value={description}
              onChange={(e) => edit(setDescription)(e.target.value)}
            />
          </label>
          <label className="author-field">
            <span>Eyebrow label</span>
            <input
              className="author-input"
              value={eyebrow}
              placeholder="Defaults to the course tier (e.g. Practitioner)"
              onChange={(e) => edit(setEyebrow)(e.target.value)}
            />
          </label>
          <label className="author-field">
            <span>Tour video URL</span>
            <input
              className="author-input"
              value={video}
              placeholder="https://vimeo.com/… or a bundled .mp4"
              onChange={(e) => edit(setVideo)(e.target.value)}
            />
          </label>
          <label className="author-field">
            <span>Video caption</span>
            <input className="author-input" value={caption} onChange={(e) => edit(setCaption)(e.target.value)} />
          </label>
          <label className="author-field">
            <span>Analytics disclosure</span>
            <textarea
              className="author-input author-textarea-sm"
              rows={2}
              value={analyticsNote}
              placeholder="Shown in the disclosure box at the top of Welcome"
              onChange={(e) => edit(setAnalyticsNote)(e.target.value)}
            />
          </label>

          <fieldset className="author-fieldset">
            <legend>Module summaries</legend>
            <p className="author-hint">
              One blurb per topic in the outline below. A topic with no row shows its labs without a summary.
            </p>
            {summaries.map((m, i) => (
              <div key={i} className="author-summary-row">
                <input
                  className="author-input"
                  value={m.title}
                  placeholder="Topic title (must match the outline)"
                  onChange={(e) => {
                    const next = [...summaries];
                    next[i] = { ...next[i], title: e.target.value };
                    setSummaries(next);
                    setDirty(true);
                  }}
                />
                <textarea
                  className="author-input author-textarea-sm"
                  rows={2}
                  value={m.summary}
                  placeholder="What this module covers"
                  onChange={(e) => {
                    const next = [...summaries];
                    next[i] = { ...next[i], summary: e.target.value };
                    setSummaries(next);
                    setDirty(true);
                  }}
                />
                <button
                  type="button"
                  className="author-mini-btn"
                  title="Remove this summary"
                  onClick={() => {
                    setSummaries(summaries.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="author-mini-btn"
              onClick={() => { setSummaries([...summaries, { title: "", summary: "" }]); setDirty(true); }}
            >
              + Summary
            </button>
          </fieldset>
        </div>
        {chat}
      </div>
      {splitter}
      <section className="author-preview">
        <div className="author-preview-guide">
          {previewCourse && (
            <WelcomeScreen
              course={previewCourse}
              topics={topics}
              firstSlug={firstSlug}
              resumeSlug={null}
              resumeTitle={null}
              totalLabs={topics.reduce((n, t) => n + t.labs.length, 0)}
              onSelect={() => {}}
            />
          )}
        </div>
      </section>
    </>
  );
}
