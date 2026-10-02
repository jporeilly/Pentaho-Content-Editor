// Course structure sidebar — the editor's tree of topics and labs.
// Lets an author: click a lab to edit it, reorder labs (up/down, across
// topic boundaries), rename a lab inline, and create a new lab. Reorders
// and renames persist to SUMMARY.md + manifests via PUT /structure; new
// labs go through the Node scaffolder via POST /labs.

import { useCallback, useEffect, useRef, useState } from "react";
// Same icon set the learner sidebar uses (Sidebar.tsx), so the
// author's tree reads exactly like the tree learners navigate:
// Home for Welcome, FileText for a page, FlaskConical for a workshop.
import { FileText, FlaskConical, Home } from "lucide-react";
import { api, type Structure, type StructureLab, type StructureTopic, type Source } from "./api";
import {
  allTopics, indentBlocked, indentTopic, outdentTopic, popLab, setTopicPage, topicAt,
} from "./topicTree";
import { LabModal, type LabDraft } from "./LabModal";

/** How many section colours the sidebar cycles through (`--author-sec-0`
 *  … in author.css). Each top-level section takes the next, so where a lab
 *  sits in the course shows as a colour, the way the Exam Bank's rail
 *  colours its three groups. Six before a repeat: more sections than that
 *  are rare, and a seventh hue would be too close to one of the six. */
export const SECTION_COLOURS = 6;

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
  /** Every structure this panel holds once loaded, including its own
   *  optimistic edits - so the toolbar's Link to page menu lists a lab
   *  the moment it is created or renamed, not after the next refresh. */
  onStructure?: (structure: Structure) => void;
  /** Hide the sidebar — the shell shows a thin rail to bring it back. */
  onCollapse?: () => void;
  /** True while the Welcome pane is open (no lab is selected). */
  welcomeActive?: boolean;
  /** Open the Welcome-page editor. */
  onSelectWelcome?: () => void;
}

export function StructurePanel({ course, activeSlug, onSelect, refreshKey, onSources, onStructure, onCollapse, welcomeActive, onSelectWelcome }: StructurePanelProps) {
  const [structure, setStructure] = useState<Structure>({ topics: [] });
  // The initial empty tree is a placeholder, not the course: reporting
  // it would blank the Link to page menu until the fetch lands.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) onStructure?.(structure);
  }, [structure, onStructure]);
  // Free-text filter over the tree. Courses run to eighteen entries and
  // the only way to reach one was to read the list.
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Topic address is a PATH ("0", "0.2") rather than an index, because a
  // sub-topic's position is only meaningful relative to its parent.
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dropSlug, setDropSlug] = useState<string | null>(null);
  // Which lab-creation modal is open ("new" or "ai"), and its inline error.
  const [labModal, setLabModal] = useState<"new" | "page" | "ai" | null>(null);
  const [labModalError, setLabModalError] = useState("");
  // Slug whose delete button is armed — one at a time.
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!course) return;
    api.getStructure(course)
      .then((s) => { loaded.current = true; setStructure(s); })
      .catch(() => setStructure({ topics: [] }));
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

  // ── Drag-and-drop reordering (across topics, at any depth) ────────
  // The tree walkers live in topicTree.ts so they can be tested without
  // a DOM. They all recurse: with sub-topics in play, a flat pass over
  // `structure.topics` silently misses anything under a `###`.
  function dropOnLab(sourceSlug: string, targetSlug: string) {
    if (sourceSlug === targetSlug) return;
    const next: Structure = structuredClone(structure);
    const lab = popLab(next, sourceSlug);
    if (!lab) return;
    for (const { topic } of allTopics(next.topics)) {
      const i = topic.labs.findIndex((l) => l.slug === targetSlug);
      if (i >= 0) { topic.labs.splice(i, 0, lab); persist(next); return; }
    }
  }

  function dropOnTopic(sourceSlug: string, path: number[]) {
    const next: Structure = structuredClone(structure);
    const lab = popLab(next, sourceSlug);
    if (!lab) return;
    topicAt(next, path).labs.push(lab);
    persist(next);
  }

  // ── Indent / outdent a topic ──────────────────────────────────────
  // Outline semantics: indenting makes a topic the last child of the
  // sibling above it (`##` becomes `###`); outdenting makes it the next
  // sibling of its parent. Its own labs and children travel with it.
  function doIndent(path: number[]) {
    const next = indentTopic(structure, path);
    if (next) persist(next);
  }

  function doOutdent(path: number[]) {
    const next = outdentTopic(structure, path);
    if (next) persist(next);
  }

  // Promote a guide to be its section's own page, or send it back to the
  // list. The header then opens that guide while the chevron still
  // expands the group, so a "Review Flat Files" page stops duplicating
  // the "Flat Files" header above it.
  function doSetPage(path: number[], slug: string | null) {
    const next = setTopicPage(structure, path, slug);
    if (next !== structure) persist(next);
  }

  function beginRename(lab: StructureLab) {
    setEditing(lab.slug);
    setDraftTitle(lab.title);
  }
  function commitRename(path: number[], li: number) {
    const title = draftTitle.trim();
    setEditing(null);
    if (!title || title === topicAt(structure, path).labs[li].title) return;
    const next: Structure = structuredClone(structure);
    topicAt(next, path).labs[li].title = title;
    persist(next);
  }

  // Topic (section header) rename — same double-click flow as labs.
  // Topic titles are the `##`/`###` headers in SUMMARY.md; put_structure
  // rewrites them, and lab links inside the section are untouched.
  function beginTopicRename(path: number[]) {
    setEditingTopic(path.join("."));
    setDraftTitle(topicAt(structure, path).title);
  }
  function commitTopicRename(path: number[]) {
    const title = draftTitle.trim();
    setEditingTopic(null);
    if (!title || title === topicAt(structure, path).title) return;
    const next: Structure = structuredClone(structure);
    topicAt(next, path).title = title;
    persist(next);
  }

  function openLabModal(mode: "new" | "page" | "ai") {
    setLabModalError("");
    setLabModal(mode);
  }

  async function deleteLab(slug: string) {
    setDeleteArmed(null);
    setBusy(true);
    try {
      const next = await api.deleteLab(course, slug);
      setStructure(next);
      // The deleted lab may be the one open in the editor. Move to the
      // Welcome page rather than leave the panes showing a lab that no
      // longer exists on disk.
      if (slug === activeSlug) onSelectWelcome?.();
    } catch {
      load(); // server truth — the delete may have half-applied
    } finally {
      setBusy(false);
    }
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

  // Filtering HIDES rows, it never rebuilds the list. Reordering and
  // inline rename address a lab by its [topicIndex, labIndex] position
  // in `structure`, so a filtered array would renumber every lab after
  // the first hidden one and move the wrong file. The maps below still
  // run over everything; only the rendered output is dropped.
  const needle = filter.trim().toLowerCase();
  const filtering = needle.length > 0;
  const labHit = (lab: StructureLab) =>
    lab.title.toLowerCase().includes(needle) || lab.slug.toLowerCase().includes(needle);
  // A topic that matches by name shows all of its labs - you searched
  // for the topic, so you want what is in it.
  const topicHit = (title: string) => title.toLowerCase().includes(needle);
  // A topic stays visible if it matches, if one of its labs matches, or
  // if anything in its subtree does — otherwise filtering would hide the
  // parent and orphan a matching sub-topic.
  const topicVisible = (topic: StructureTopic): boolean =>
    !filtering ||
    topicHit(topic.title) ||
    topic.labs.some(labHit) ||
    (topic.children ?? []).some(topicVisible);
  const labVisible = (topicTitle: string, lab: StructureLab) =>
    !filtering || topicHit(topicTitle) || labHit(lab);

  const hitCount = filtering
    ? allTopics(structure.topics).reduce(
        (n, { topic }) => n + topic.labs.filter((l) => labVisible(topic.title, l)).length,
        0,
      )
    : 0;

  // One topic and everything under it. Recursive, so a sub-topic gets
  // the same header, drag target, rename and delete affordances as a
  // top-level one — `path` is its address in the tree (see the note on
  // `editingTopic`). Indentation is driven by depth, not by nesting the
  // markup, so a deep row still lines up with the panel's grid.
  function renderTopic(topic: StructureTopic, path: number[]) {
    if (!topicVisible(topic)) return null;
    const depth = path.length - 1;
    const key = path.join(".");
    const blocked = indentBlocked(structure, path);
    const canOutdent = path.length > 1;
    return (
      <div
        key={key + topic.title}
        // author-sec-N: each top-level section has its own colour, and
        // its sub-topics carry it on (the custom property cascades).
        className={`author-topic author-topic--depth-${Math.min(depth, 3)} author-sec-${path[0] % SECTION_COLOURS}`}
        onDragOver={(e) => { if (dragSlug) e.preventDefault(); }}
        onDrop={(e) => { if (dragSlug) { e.preventDefault(); dropOnTopic(dragSlug, path); setDragSlug(null); setDropSlug(null); } }}
      >
        {editingTopic === key ? (
          <input
            className="author-lab-rename"
            value={draftTitle}
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={() => commitTopicRename(path)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTopicRename(path);
              if (e.key === "Escape") setEditingTopic(null);
            }}
          />
        ) : (
          <div className="author-topic-row">
            <div
              className="author-topic-title"
              onDoubleClick={() => beginTopicRename(path)}
              title="Double-click to rename this section"
            >
              {topic.title}
            </div>
            {/* Indent / outdent. An explicit pair of controls rather
                than a drag-right gesture: dragging already means "move
                this lab", and overloading it with a second meaning
                that depends on horizontal distance is guesswork for
                the author and ambiguous for the drop handler. */}
            <span className="author-topic-nest">
              <button
                type="button"
                className="author-nest-btn"
                disabled={busy || !!blocked || filtering}
                onClick={() => doIndent(path)}
                title={
                  filtering
                    ? "Clear the filter to restructure — positions shift while rows are hidden"
                    : blocked ?? `Indent — make "${topic.title}" a sub-topic of the section above`
                }
                aria-label={`Indent ${topic.title}`}
              >
                →
              </button>
              <button
                type="button"
                className="author-nest-btn"
                disabled={busy || !canOutdent || filtering}
                onClick={() => doOutdent(path)}
                title={
                  filtering
                    ? "Clear the filter to restructure — positions shift while rows are hidden"
                    : canOutdent
                      ? `Outdent — move "${topic.title}" back up a level`
                      : "Already a top-level topic"
                }
                aria-label={`Outdent ${topic.title}`}
              >
                ←
              </button>
            </span>
          </div>
        )}
        {topic.page && (!filtering || labVisible(topic.title, topic.page)) && (
          <div
            className={
              "author-lab-row author-page-row" +
              (topic.page.slug === activeSlug && !welcomeActive ? " is-active" : "")
            }
          >
            <span className="author-page-badge" title="This section's own page — the header opens it">§</span>
            <button
              type="button"
              className="author-lab-label"
              onClick={() => onSelect(topic.page!.slug)}
              title={`${topic.page.slug} — opened by clicking "${topic.title}" in the learner sidebar`}
            >
              <FileText size={12} strokeWidth={2} className="author-lab-icon" aria-hidden />
              {topic.page.title}
            </button>
            <button
              type="button"
              className="author-nest-btn"
              disabled={busy || filtering}
              onClick={() => doSetPage(path, null)}
              title={`Demote — put "${topic.page.title}" back in the list as an ordinary entry`}
              aria-label={`Demote ${topic.page.title}`}
            >
              ↓
            </button>
          </div>
        )}
        {topic.labs.map((lab, li) => !labVisible(topic.title, lab) ? null : (
          <div
            key={lab.slug}
            /* Dragging is off while filtering: a drop lands relative
               to the labs you can SEE, and with rows hidden that is
               not where the author thinks it is. */
            draggable={editing !== lab.slug && !busy && !filtering}
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
                onBlur={() => commitRename(path, li)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(path, li);
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
            {/* Click to arm, click again to delete. A folder and a
                SUMMARY bullet do not come back, so a single stray
                click must not be enough - but typing a phrase per
                lab (as the course delete demands) is too heavy for
                something this routine. Arming clears on blur. */}
            {editing !== lab.slug && (
              <button
                type="button"
                className="author-nest-btn"
                disabled={busy || filtering}
                onClick={() => doSetPage(path, lab.slug)}
                title={
                  filtering
                    ? "Clear the filter to restructure"
                    : `Make "${lab.title}" the page for "${topic.title}" — the section header opens it`
                }
                aria-label={`Make ${lab.title} the section page`}
              >
                ↑
              </button>
            )}
            {editing !== lab.slug && (
              <button
                type="button"
                className={`author-lab-delete${deleteArmed === lab.slug ? " is-armed" : ""}`}
                disabled={busy}
                onClick={() => {
                  if (deleteArmed === lab.slug) void deleteLab(lab.slug);
                  else setDeleteArmed(lab.slug);
                }}
                onBlur={() => setDeleteArmed((s) => (s === lab.slug ? null : s))}
                title={
                  deleteArmed === lab.slug
                    ? `Delete ${lab.slug} and its SUMMARY entry — this cannot be undone`
                    : `Delete ${lab.kind === "page" ? "page" : "lab"}…`
                }
                aria-label={deleteArmed === lab.slug ? `Confirm delete ${lab.title}` : `Delete ${lab.title}`}
              >
                {deleteArmed === lab.slug ? "Delete?" : "🗑"}
              </button>
            )}
          </div>
        ))}
        {(topic.children ?? []).map((child, ci) => renderTopic(child, [...path, ci]))}
      </div>
    );
  }

  return (
    <aside className="author-structure">
      <div className="author-structure-head">
        <span>Structure</span>
        <span className="author-structure-actions">
          <button
            type="button"
            className="author-mini-btn role-ai"
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
          <button type="button" className="author-mini-btn role-add" onClick={() => openLabModal("new")} disabled={busy || generating} title="New blank workshop — numbered steps the learner ticks off">
            + Lab
          </button>
          {/* The Kind dropdown inside the modal could always make a
              page, but nothing on this bar said so, so authors looked
              for a button and concluded pages were workshops-only. The
              dropdown is still there and still switchable — this only
              changes which way it starts. */}
          <button type="button" className="author-mini-btn role-add" onClick={() => openLabModal("page")} disabled={busy || generating} title="New blank page — reference content, no tracked steps">
            + Page
          </button>
          {onCollapse && (
            <button type="button" className="author-mini-btn" onClick={onCollapse} title="Hide the structure sidebar">
              «
            </button>
          )}
        </span>
      </div>
      <div className="author-structure-filter">
        <input
          type="search"
          className="author-filter-input"
          placeholder="Filter labs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setFilter(""); } }}
          aria-label="Filter the course structure"
        />
        {filtering && (
          <span className="author-filter-count">
            {hitCount === 0 ? "no matches" : `${hitCount} lab${hitCount === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      <div className="author-structure-body">
        {onSelectWelcome && !filtering && (
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
        {structure.topics.map((topic, i) => renderTopic(topic, [i]))}
        {structure.topics.length === 0 && <div className="author-structure-empty">No labs yet.</div>}
      </div>

      {labModal && (
        <LabModal
          mode={labModal}
          /* Sub-topics are offered too — a new lab belongs under
             "Flat Files" as readily as under "Data Sources". */
          topics={allTopics(structure.topics).map(({ topic }) => topic.title)}
          busy={busy || generating}
          error={labModalError}
          onClose={() => setLabModal(null)}
          onSubmit={labModal === "ai" ? submitAiLab : submitNewLab}
        />
      )}
    </aside>
  );
}
