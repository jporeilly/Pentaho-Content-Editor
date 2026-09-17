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
// manual edit, lab switch, or SUCCESSFUL save - once the rewrite is on
// disk there is nothing left to undo, and the button sat on "↺ Reset"
// through a save and a publish because saving was missing from this list).

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent, type DragEvent,
} from "react";
import {
  api, type CourseSummary, type LabDetail, type ProviderHealth, type RepoStatus,
  type SetupStatus, type Source,
} from "./api";
import { parseFindings, tagLocated, type Finding } from "./reviewFindings";

/** A completed AI review: the findings to mark with, and the raw answer
 *  behind them for the case where nothing could be parsed out of it. */
export interface ReviewResult {
  text: string;
  findings: Finding[];
}

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

// ── First run: is this machine set up to edit anything? ───────────
//
// Asked once at boot, ahead of the course list, because a machine that
// does not know where its courses are cannot produce one. It is also
// where the packaged editor reports what it cannot do here — a missing
// Node costs four buttons and nothing else, and the author should hear
// that once rather than four times.

export function useSetup(setStatus: (s: string) => void) {
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.setup();
      setSetup(next);
      return next;
    } catch {
      // The API being unreachable is a different screen's problem
      // (useCourses' apiUp); leaving this null keeps the two apart.
      setSetup(null);
      return null;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Announce a degraded machine ONCE, and only when the editor is
  // otherwise usable: on the setup screen the same facts are already
  // spelled out in full, so repeating them in the status line would be
  // noise at the exact moment the author is reading the long version.
  useEffect(() => {
    if (setup?.valid && setup.unavailable.length) {
      setStatus(`⚠ Not available here: ${setup.unavailable.join(" · ")}`);
    }
  }, [setup, setStatus]);

  return { setup, refresh };
}

// ── The checkout, and whether it has moved on without us ──────────
//
// The editor writes into a repository other people publish into. Nothing
// warned about that: you could rewrite a guide that was replaced
// upstream this morning and only find out at Publish.
//
// Fetched once on load, because that is the moment the answer is worth
// having, and then only when the author asks. A poll would put a network
// round trip on a timer for a number that changes when someone else
// pushes - rare, and not worth the VPN dialogue.

export function useRepoStatus() {
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async (doFetch: boolean) => {
    setChecking(true);
    try {
      setRepo(await api.repoStatus(doFetch));
    } catch {
      // The pill simply does not appear. An editor whose header nags
      // about git while you are trying to write is worse than one that
      // quietly says nothing.
      setRepo(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { check(true); }, [check]);

  return { repo, checking, recheck: () => check(true) };
}

// ── Courses: list + selection + glossary ──────────────────────────

export function useCourses(setStatus: (s: string) => void) {
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [course, setCourse] = useState<string>("");
  const [lab, setLab] = useState<string>("");
  const [glossary, setGlossary] = useState<Record<string, string>>({});
  // course.json's `version` - the CONTENT version, which moves
  // independently of the app build and is what a learner quotes
  // in a support question.
  const [courseVersion, setCourseVersion] = useState<string>("");

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
    // Content version, also best-effort — a course without one just
    // shows the app version on its own.
    api.getCourse(course)
      .then((c) => setCourseVersion(typeof c.version === "string" ? c.version : ""))
      .catch(() => setCourseVersion(""));
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

  return { apiUp, courses, setCourses, course, setCourse, lab, setLab, glossary, courseVersion, onCourseCreated };
}

// ── Unsaved-draft backup ──────────────────────────────────────────
// Every edit is mirrored to localStorage so a page reload (F5, a crash,
// the dev server's full reload) doesn't lose the text. A draft is put
// back only while the disk copy is still the one it was typed against
// (same bodyHash) — if someone saved the lab in between, the draft is
// stale and is dropped in favour of the newer text.
interface Draft { body: string; baseHash?: string; at: number }
const draftKey = (course: string, lab: string) => `pcm-author-draft:${course}/${lab}`;
function readDraft(course: string, lab: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(course, lab));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch { return null; }
}
function writeDraft(course: string, lab: string, draft: Draft) {
  try { localStorage.setItem(draftKey(course, lab), JSON.stringify(draft)); } catch { /* best effort */ }
}
function clearDraft(course: string, lab: string) {
  try { localStorage.removeItem(draftKey(course, lab)); } catch { /* ignore */ }
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
  // Set after a 409 so the very next Save overwrites the disk copy.
  const forceNext = useRef(false);

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
        setLastRewrite(null);
        forceNext.current = false;
        const draft = readDraft(course, lab);
        if (draft && draft.body !== d.body && draft.baseHash === d.bodyHash) {
          // The page went away with unsaved text and nobody has saved this
          // lab since: bring the text back, still unsaved.
          setBody(draft.body);
          setDirty(true);
          const at = new Date(draft.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setStatus(`Restored unsaved text from ${at} — not saved yet. Ctrl+S keeps it.`);
        } else {
          if (draft) clearDraft(course, lab); // stale: the lab was saved after it was typed
          setBody(d.body);
          setDirty(false);
          setStatus("");
        }
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

  const baseHash = detail?.bodyHash;
  const onBodyChange = useCallback((next: string, caret?: number) => {
    setBody(next);
    setDirty(true);
    setLastRewrite(null); // a manual edit invalidates the rewrite undo range
    if (course && lab) writeDraft(course, lab, { body: next, baseHash, at: Date.now() });
    if (caret !== undefined && textareaRef.current) {
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(caret, caret);
      });
    }
  }, [course, lab, baseHash]);

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
      const updated = await api.saveLab(course, lab, body, undefined, {
        baseHash: detail?.bodyHash,
        force: forceNext.current,
      });
      forceNext.current = false;
      clearDraft(course, lab);
      setDetail(updated);
      setDirty(false);
      // The rewrite is on disk now, so there is nothing left to undo. Only
      // on SUCCESS: a save that failed wrote nothing, and ↺ Reset is still
      // exactly what an author might want next - put the original back and
      // save that instead.
      setLastRewrite(null);
      bumpStructure(); // refresh titles/metadata in the tree
      const m = updated.manifest as any;
      setStatus(`Saved · ${m.stepCount} steps · ~${m.estimatedMinutes} min${m.hasVideo ? " · has video" : ""}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/changed on disk/i.test(msg)) {
        // Another tab (or an external edit) saved this lab after we loaded
        // it. Nothing was written. One more Save overwrites on purpose.
        forceNext.current = true;
        setStatus("✗ Not saved: this lab changed on disk since you opened it (another editor tab?). Press Save again to overwrite it, or press F5 to load the newer text.");
      } else {
        setStatus(`Save failed: ${msg}`);
      }
    } finally {
      setSaving(false);
    }
  }, [course, lab, body, detail?.bodyHash, bumpStructure, setStatus, setLastRewrite]);

  // Warn before the page unloads with unsaved text — F5, closing the tab,
  // and the dev server's full reloads all pass through here.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
  const [reviewOut, setReviewOut] = useState<ReviewResult | null>(null);
  const [verifyOut, setVerifyOut] = useState<{ ok: boolean; output: string } | null>(null);

  /**
   * Rewrite one range of the body, optionally with an instruction.
   *
   * The single path by which generated text reaches a guide. Applying a
   * review finding goes through here rather than getting a route of its
   * own: it is the same call, on a range the author can see selected,
   * landing in the buffer under the same one-level undo. A second way in
   * would be a second thing to make safe.
   */
  const rewriteRange = useCallback(async (
    start: number,
    end: number,
    instruction?: string,
    working?: string,
  ) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const passage = body.slice(start, end);
    if (!passage.trim()) {
      setStatus("There is nothing to rewrite there.");
      return;
    }
    setWorking(true);
    setStatus(working ?? "Rewriting selection…");
    try {
      const { text, sources: srcs } = await api.rewrite(passage, instruction);
      const next = body.slice(0, start) + text + body.slice(end);
      setBody(next);
      setDirty(true);
      setLastRewrite({ start, end: start + text.length, original: passage });
      setSources(srcs ?? []);
      setStatus(
        instruction
          ? "Applied — read it, then ↺ Reset if it is not what you wanted."
          : "Rewrote selection — review, Reset to undo, or Save.",
      );
      // Selected, not just inserted: the author should see exactly what
      // changed, and the next keystroke replaces it if it is wrong.
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

  const rewriteSelection = useCallback(async () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart === ta.selectionEnd) {
      setStatus("Select some text in the editor first, then Rewrite.");
      return;
    }
    await rewriteRange(ta.selectionStart, ta.selectionEnd);
  }, [rewriteRange, setStatus, textareaRef]);

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
      // Standard image insert — mirrors Toolbar's "Image" entry: figure,
      // flush-left image, centred <figcaption> (theme caption style).
      insertAtCaret(`<figure>\n\n![${name}](${path})\n\n<div align="center">\n<figcaption><em>Caption</em></figcaption>\n</div>\n</figure>\n\n`);
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
        // Named by timestamp alone. The old "pasted-" prefix said how
        // the image arrived, which is no business of the filename and
        // read badly in the alt text the insert writes; every other
        // image in the courses is a bare number.
        if (f) { e.preventDefault(); uploadAndInsertImage(f, `${Date.now()}.png`); return; }
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
      const { review, findings, sources: srcs } = await api.review(body);
      // Stamped against the body that was reviewed, NOT re-derived later:
      // once the author starts editing, a finding that no longer matches
      // could be one they have just fixed or one the model invented, and
      // only a mark taken at this moment tells the two apart.
      const parsed = tagLocated(body, parseFindings(findings));
      setReviewOut({ text: review, findings: parsed });
      setSources(srcs ?? []);
      const marked = parsed.filter((f) => f.locatedAtRun).length;
      setStatus(
        parsed.length
          ? `Review ready — ${parsed.length} finding${parsed.length === 1 ? "" : "s"}, ${marked} marked in the source.`
          : "Review ready — see the panel.",
      );
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
    rewriteSelection, rewriteRange, undoRewrite, uploadAndInsertImage, onEditorPaste, onEditorDrop,
    runReview, runVerify,
  };
}
