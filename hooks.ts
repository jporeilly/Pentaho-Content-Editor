// Editor state hooks pulled out of App.tsx so the component stays a thin
// view over four cohesive concerns:
//
//   useProviderHealth — the active LLM provider's connection status
//   useCourses        — course list + selected course/lab + glossary
//   useLab            — the open lab's body, dirty/save, caret insert
//   useAi             — rewrite / review / verify / image actions
//
// A few pieces are genuinely shared and threaded between hooks: `setStatus`
// (the one header status line), `structureKey` (bumped on save/settings to
// refresh the tree), and `lastRewrite` (set by a rewrite, cleared by any
// manual edit or lab switch).

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent, type DragEvent,
} from "react";
import { api, type CourseSummary, type LabDetail, type ProviderHealth, type Source } from "./api";

/** One-level undo range for the last AI rewrite. */
export interface RewriteUndo {
  start: number;
  end: number;
  original: string;
}

// ── Provider health ───────────────────────────────────────────────

export function useProviderHealth() {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const refreshHealth = useCallback(() => {
    api.providerHealth().then(setHealth).catch(() => setHealth(null));
  }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);
  return { health, refreshHealth };
}

// ── Courses: list + selection + glossary ──────────────────────────

export function useCourses(setStatus: (s: string) => void) {
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [course, setCourse] = useState<string>("");
  const [lab, setLab] = useState<string>("");
  const [glossary, setGlossary] = useState<Record<string, string>>({});

  // Boot: API health, then the course list (select the first).
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

  // Course change: reset selection, pick the first lab, load the glossary.
  useEffect(() => {
    if (!course) return;
    setLab("");
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
  }, [course, setStatus]);

  // After a course is created/imported: refresh the list, select it, announce.
  const onCourseCreated = useCallback(async (courseId: string) => {
    try {
      const list = await api.listCourses();
      setCourses(list);
      setCourse(courseId); // switches, loads its starter lab
      setStatus(`Opened course “${courseId}”.`);
    } catch (e) {
      setStatus(`Created, but couldn’t refresh: ${(e as Error).message}`);
    }
  }, [setStatus]);

  return { apiUp, courses, setCourses, course, setCourse, lab, setLab, glossary, onCourseCreated };
}

// ── Lab content: body, dirty/save, caret insert ───────────────────

export function useLab(course: string, lab: string, setStatus: (s: string) => void) {
  const [detail, setDetail] = useState<LabDetail | null>(null);
  const [body, setBody] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [structureKey, setStructureKey] = useState(0);
  // Cleared on any manual edit or lab switch; set by an AI rewrite.
  const [lastRewrite, setLastRewrite] = useState<RewriteUndo | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const bumpStructure = useCallback(() => setStructureKey((k) => k + 1), []);

  // Lab change: load the body.
  useEffect(() => {
    if (!course || !lab) { setDetail(null); setBody(""); return; }
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
    return () => { cancelled = true; };
  }, [course, lab, setStatus]);

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

  const insertAtCaret = useCallback((text: string) => {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? body.length;
    onBodyChange(body.slice(0, start) + text + body.slice(end), start + text.length);
  }, [body, onBodyChange]);

  const save = useCallback(async () => {
    if (!course || !lab) return;
    setSaving(true);
    setStatus("Saving…");
    try {
      const updated = await api.saveLab(course, lab, body);
      setDetail(updated);
      setDirty(false);
      bumpStructure(); // refresh titles/metadata in the tree
      const m = updated.manifest as any;
      setStatus(`Saved · ${m.stepCount} steps · ~${m.estimatedMinutes} min${m.hasVideo ? " · has video" : ""}`);
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [course, lab, body, bumpStructure, setStatus]);

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

  return {
    detail, setDetail, body, setBody, dirty, setDirty, saving, save,
    onBodyChange, insertAtCaret, textareaRef, baseUrl,
    structureKey, bumpStructure, lastRewrite, setLastRewrite,
  };
}

// ── AI actions: rewrite / review / verify / images ────────────────

interface UseAiArgs {
  course: string;
  body: string;
  setBody: (s: string) => void;
  setDirty: (d: boolean) => void;
  setStatus: (s: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  insertAtCaret: (text: string) => void;
  bumpStructure: () => void;
  lastRewrite: RewriteUndo | null;
  setLastRewrite: (r: RewriteUndo | null) => void;
}

export function useAi(args: UseAiArgs) {
  const {
    course, body, setBody, setDirty, setStatus,
    textareaRef, insertAtCaret, bumpStructure, lastRewrite, setLastRewrite,
  } = args;

  const [working, setWorking] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [reviewOut, setReviewOut] = useState<string | null>(null);
  const [verifyOut, setVerifyOut] = useState<{ ok: boolean; output: string } | null>(null);

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
  }, [body, setBody, setDirty, setLastRewrite, setStatus, textareaRef]);

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
  }, [body, lastRewrite, setBody, setDirty, setLastRewrite, setStatus, textareaRef]);

  const uploadAndInsertImage = useCallback(async (file: File | Blob, filename?: string) => {
    if (!course) return;
    setWorking(true);
    setStatus("Uploading image…");
    try {
      const { name, path } = await api.uploadAsset(course, file, filename);
      insertAtCaret(`![${name}](${path})\n\n`);
      setStatus(`Inserted ${name}.`);
      bumpStructure();
    } catch (e) {
      setStatus(`Image upload failed: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }, [course, insertAtCaret, bumpStructure, setStatus]);

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
  }, [body, setStatus]);

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
  }, [course, setStatus]);

  return {
    working, sources, setSources, reviewOut, setReviewOut, verifyOut, setVerifyOut,
    rewriteSelection, undoRewrite, uploadAndInsertImage, onEditorPaste, onEditorDrop,
    runReview, runVerify,
  };
}
