// Course structure sidebar — the editor's tree of topics and labs.
// Lets an author: click a lab to edit it, reorder labs (up/down, across
// topic boundaries), rename a lab inline, and create a new lab. Reorders
// and renames persist to SUMMARY.md + manifests via PUT /structure; new
// labs go through the Node scaffolder via POST /labs.

import { useCallback, useEffect, useState } from "react";
import { api, type Structure, type StructureLab, type Source } from "./api";

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
}

/** Flattened [topicIndex, labIndex] address of a lab, for reordering. */
type Addr = { t: number; l: number };

export function StructurePanel({ course, activeSlug, onSelect, refreshKey, onSources }: StructurePanelProps) {
  const [structure, setStructure] = useState<Structure>({ topics: [] });
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

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

  // Flatten to a linear list of addresses so up/down can cross topics.
  const flat: Addr[] = structure.topics.flatMap((t, ti) =>
    t.labs.map((_l, li) => ({ t: ti, l: li })),
  );

  function move(addr: Addr, dir: -1 | 1) {
    const idx = flat.findIndex((a) => a.t === addr.t && a.l === addr.l);
    const target = flat[idx + dir];
    if (!target) return;
    const next: Structure = structuredClone(structure);
    const [lab] = next.topics[addr.t].labs.splice(addr.l, 1);
    // Insert relative to the target's topic/position.
    const insertTopic = target.t;
    let insertPos = target.l + (dir === 1 ? 1 : 0);
    if (addr.t === target.t && addr.l < target.l) insertPos -= 1;
    next.topics[insertTopic].labs.splice(insertPos, 0, lab);
    persist(next);
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

  async function newLab() {
    const title = window.prompt("New lab title?");
    if (!title) return;
    const topics = structure.topics.map((t) => t.title);
    const topic =
      window.prompt(
        `Topic? (existing: ${topics.join(", ") || "none"})`,
        topics[topics.length - 1] ?? "Workshops",
      ) ?? "Workshops";
    const kind = window.confirm("OK = workshop (tracked steps), Cancel = page")
      ? "workshop"
      : "page";
    setBusy(true);
    try {
      setStructure(await api.createLab(course, title, topic, kind));
    } catch (e) {
      window.alert(`Couldn’t create lab: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function aiLab() {
    const title = window.prompt("Lab title for the AI to draft?");
    if (!title) return;
    const outline = window.prompt(
      "Optional: outline the points to cover (one line, e.g. 'open Spoon; add CSV input; preview; run').",
      "",
    ) ?? "";
    const topics = structure.topics.map((t) => t.title);
    const topic =
      window.prompt(`Topic?`, topics[topics.length - 1] ?? "Workshops") ?? "Workshops";
    setGenerating(true);
    try {
      const res = await api.generateLab(course, title, outline, topic, "workshop");
      setStructure(res.structure);
      onSelect(res.slug);
      onSources?.(res.sources ?? []);
    } catch (e) {
      window.alert(`AI draft failed: ${(e as Error).message}`);
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
            onClick={aiLab}
            disabled={busy || generating || aiReady === false}
            title={
              aiReady === false
                ? "AI provider not ready — open Settings (⚙ in the header) to configure"
                : "Draft a new lab with the configured AI provider"
            }
          >
            {generating ? "Drafting…" : "✨ AI Lab"}
          </button>
          <button type="button" className="author-mini-btn" onClick={newLab} disabled={busy || generating} title="New blank lab">
            + Lab
          </button>
        </span>
      </div>
      <div className="author-structure-body">
        {structure.topics.map((topic, ti) => (
          <div key={topic.title + ti} className="author-topic">
            <div className="author-topic-title">{topic.title}</div>
            {topic.labs.map((lab, li) => {
              const idx = flat.findIndex((a) => a.t === ti && a.l === li);
              return (
                <div
                  key={lab.slug}
                  className={`author-lab-row${lab.slug === activeSlug ? " is-active" : ""}`}
                >
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
                      title={`${lab.slug} — double-click to rename`}
                    >
                      {lab.kind === "page" ? "📄" : "🧪"} {lab.title}
                    </button>
                  )}
                  <span className="author-lab-actions">
                    <button type="button" className="author-mini-btn" disabled={busy || idx <= 0} onClick={() => move({ t: ti, l: li }, -1)} title="Move up">↑</button>
                    <button type="button" className="author-mini-btn" disabled={busy || idx >= flat.length - 1} onClick={() => move({ t: ti, l: li }, 1)} title="Move down">↓</button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {structure.topics.length === 0 && <div className="author-structure-empty">No labs yet.</div>}
      </div>
    </aside>
  );
}
