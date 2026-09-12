// Course structure sidebar — the editor's tree of topics and labs.
// Lets an author: click a lab to edit it, reorder labs (up/down, across
// topic boundaries), rename a lab inline, and create a new lab. Reorders
// and renames persist to SUMMARY.md + manifests via PUT /structure; new
// labs go through the Node scaffolder via POST /labs.

import { useCallback, useEffect, useState } from "react";
// Same icon set the learner sidebar uses (Sidebar.tsx), so the
// author's tree reads exactly like the tree learners navigate:
// Home for Welcome, FileText for a page, FlaskConical for a workshop.
import { FileText, FlaskConical, Home } from "lucide-react";
import { api, type Structure, type StructureLab, type Source } from "./api";
import { LabModal, type LabDraft } from "./LabModal";

interface StructurePanelProps {
  course: string;
  /** Currently-open lab slug (highlighted). */
  activeSlug: string;
  /** Called when the author clicks a lab to edit it. */
  onSelect: (slug: string) => void;
  /** Bumped by the parent after a save so titles refresh. */
  refreshKey?: number;
  /** Report the docs an AI action was grounded in, for citation display. */
  onSources?: (sources: Source[]) => void;
  /** Hide the sidebar — the shell shows a thin rail to bring it back. */
  onCollapse?: () => void;
  /** True while the Welcome pane is open (no lab is selected). */
  welcomeActive?: boolean;
  /** Open the Welcome-page editor. */
  onSelectWelcome?: () => void;
}

/** Flattened [topicIndex, labIndex] address of a lab, for reordering. */

export function StructurePanel({ course, activeSlug, onSelect, refreshKey, onSources, onCollapse, welcomeActive, onSelectWelcome }: StructurePanelProps) {
  const [structure, setStructure] = useState<Structure>({ topics: [] });
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dropSlug, setDropSlug] = useState<string | null>(null);
  // Which lab-creation modal is open ("new" or "ai"), and its inline error.
  const [labModal, setLabModal] = useState<"new" | "page" | "ai" | null>(null);
  const [labModalError, setLabModalError] = useState("");

  const load = useCallback(() => {
    if (!course) return;
    api.getStructure(course).then(setStructure).catch(() => setStructure({ topics: [] }));
  }, [course]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Probe the active LLM provider so the AI button can enable/disable +
  // explain itself. refreshKey re-runs it (e.g. after a settings change).
  useEffect(() => {
    api.providerHealth().then((h) => setAiReady(h.ok)).catch(() => setAiReady(false));
  }, [refreshKey]);

  const persist = useCallback(async (next: Structure) => {
    setStructure(next); // optimistic
    setBusy(true);
    try {
      setStructure(await api.putStructure(course, next));
    } catch {
      load(); // revert to server truth on failure
    } finally {
      setBusy(false);
    }
  }, [course, load]);

  // ── Drag-and-drop reordering (across topics) ──────────────────────
  function popLab(next: Structure, slug: string): StructureLab | null {
    for (const t of next.topics) {
      const i = t.labs.findIndex((l) => l.slug === slug);
      if (i >= 0) return t.labs.splice(i, 1)[0];
    }
    return null;
  }

  function dropOnLab(sourceSlug: string, targetSlug: string) {
    if (sourceSlug === targetSlug) return;
    const next: Structure = structuredClone(structure);
    const lab = popLab(next, sourceSlug);
    if (!lab) return;
    for (const t of next.topics) {
      const i = t.labs.findIndex((l) => l.slug === targetSlug);
      if (i >= 0) { t.labs.splice(i, 0, lab); persist(next); return; }
    }
  }

  function dropOnTopic(sourceSlug: string, topicTitle: string) {
    const next: Structure = structuredClone(structure);
    const lab = popLab(next, sourceSlug);
    if (!lab) return;
    const t = next.topics.find((x) => x.title === topicTitle);
    if (t) { t.labs.push(lab); persist(next); }
  }

  function beginRename(lab: StructureLab) {
    setEditing(lab.slug);
    setDraftTitle(lab.title);
  }
  function commitRename(ti: number, li: number) {
    const title = draftTitle.trim();
    setEditing(null);
    if (!title || title === structure.topics[ti].labs[li].title) return;
    const next: Structure = structuredClone(structure);
    next.topics[ti].labs[li].title = title;
    persist(next);
  }

  // Topic (section header) rename — same double-click flow as labs.
  // Topic titles are the `## …` headers in SUMMARY.md; put_structure
  // rewrites them, and lab links inside the section are untouched.
  function beginTopicRename(ti: number) {
    setEditingTopic(ti);
    setDraftTitle(structure.topics[ti].title);
  }
  function commitTopicRename(ti: number) {
    const title = draftTitle.trim();
    setEditingTopic(null);
    if (!title || title === structure.topics[ti].title) return;
    const next: Structure = structuredClone(structure);
    next.topics[ti].title = title;
    persist(next);
  }

  function openLabModal(mode: "new" | "page" | "ai") {
    setLabModalError("");
    setLabModal(mode);
  }

  async function submitNewLab(draft: LabDraft) {
    setLabModalError("");
    setBusy(true);
    try {
      setStructure(await api.createLab(course, draft.title, draft.topic, draft.kind));
      setLabModal(null);
    } catch (e) {
      setLabModalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitAiLab(draft: LabDraft) {
    setLabModalError("");
    setGenerating(true);
    try {
      const res = await api.generateLab(course, draft.title, draft.outline ?? "", draft.topic, "workshop");
      setStructure(res.structure);
      onSelect(res.slug);
      onSources?.(res.sources ?? []);
      setLabModal(null);
    } catch (e) {
      setLabModalError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <aside className="author-structure">
      <div className="author-structure-head">
        <span>Structure</span>
        <span className="author-structure-actions">
          <button
            type="button"
            className="author-mini-btn"
            onClick={() => openLabModal("ai")}
            disabled={busy || generating || aiReady === false}
            title={
              aiReady === false
                ? "AI provider not ready — open Settings (⚙ in the header) to configure"
                : "Draft a new lab with the configured AI provider"
            }
          >
            {generating ? "Drafting…" : "✨ AI Lab"}
          </button>
          <button type="button" className="author-mini-btn" onClick={() => openLabModal("new")} disabled={busy || generating} title="New blank workshop — numbered steps the learner ticks off">
            + Lab
          </button>
          {/* The Kind dropdown inside the modal could always make a
              page, but nothing on this bar said so, so authors looked
              for a button and concluded pages were workshops-only. The
              dropdown is still there and still switchable — this only
              changes which way it starts. */}
          <button type="button" className="author-mini-btn" onClick={() => openLabModal("page")} disabled={busy || generating} title="New blank page — reference content, no tracked steps">
            + Page
          </button>
          {onCollapse && (
            <button type="button" className="author-mini-btn" onClick={onCollapse} title="Hide the structure sidebar">
              «
            </button>
          )}
        </span>
      </div>
      <div className="author-structure-body">
        {onSelectWelcome && (
          <div className={`author-lab-row author-welcome-row${welcomeActive ? " is-active" : ""}`}>
            <button
              type="button"
              className="author-lab-label"
              onClick={onSelectWelcome}
              title="The course landing page — generated from course.json"
            >
              <Home size={12} strokeWidth={2} className="author-lab-icon" aria-hidden />
              Welcome
            </button>
          </div>
        )}
        {structure.topics.map((topic, ti) => (
          <div
            key={topic.title + ti}
            className="author-topic"
            onDragOver={(e) => { if (dragSlug) e.preventDefault(); }}
            onDrop={(e) => { if (dragSlug) { e.preventDefault(); dropOnTopic(dragSlug, topic.title); setDragSlug(null); setDropSlug(null); } }}
          >
            {editingTopic === ti ? (
              <input
                className="author-lab-rename"
                value={draftTitle}
                autoFocus
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => commitTopicRename(ti)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitTopicRename(ti);
                  if (e.key === "Escape") setEditingTopic(null);
                }}
              />
            ) : (
              <div
                className="author-topic-title"
                onDoubleClick={() => beginTopicRename(ti)}
                title="Double-click to rename this section"
              >
                {topic.title}
              </div>
            )}
            {topic.labs.map((lab, li) => (
              <div
                key={lab.slug}
                draggable={editing !== lab.slug && !busy}
                onDragStart={(e) => { setDragSlug(lab.slug); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDragSlug(null); setDropSlug(null); }}
                onDragOver={(e) => { if (dragSlug && dragSlug !== lab.slug) { e.preventDefault(); e.stopPropagation(); setDropSlug(lab.slug); } }}
                onDragLeave={() => setDropSlug((s) => (s === lab.slug ? null : s))}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragSlug) dropOnLab(dragSlug, lab.slug); setDragSlug(null); setDropSlug(null); }}
                className={
                  `author-lab-row${lab.slug === activeSlug && !welcomeActive ? " is-active" : ""}` +
                  `${dropSlug === lab.slug ? " is-drop" : ""}${dragSlug === lab.slug ? " is-dragging" : ""}`
                }
              >
                <span className="author-lab-grip" title="Drag to reorder">⋮⋮</span>
                {editing === lab.slug ? (
                  <input
                    className="author-lab-rename"
                    value={draftTitle}
                    autoFocus
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => commitRename(ti, li)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(ti, li);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="author-lab-label"
                    onClick={() => onSelect(lab.slug)}
                    onDoubleClick={() => beginRename(lab)}
                    title={`${lab.slug} — drag to reorder, double-click to rename`}
                  >
                    {lab.kind === "page" ? (
                      <FileText size={12} strokeWidth={2} className="author-lab-icon" aria-hidden />
                    ) : (
                      <FlaskConical size={12} strokeWidth={2} className="author-lab-icon" aria-hidden />
                    )}
                    {lab.title}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
        {structure.topics.length === 0 && <div className="author-structure-empty">No labs yet.</div>}
      </div>

      {labModal && (
        <LabModal
          mode={labModal}
          topics={structure.topics.map((t) => t.title)}
          busy={busy || generating}
          error={labModalError}
          onClose={() => setLabModal(null)}
          onSubmit={labModal === "ai" ? submitAiLab : submitNewLab}
        />
      )}
    </aside>
  );
}
