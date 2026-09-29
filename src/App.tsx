// Pentaho Content Editor — MVP vertical slice.
//
// Pick a course -> pick a lab -> edit its guide.md with the insert-block
// toolbar -> see a live preview rendered by the app's own MarkdownBody
// -> save to disk (which re-stamps the manifest's derived metrics).
//
// Later phases add: structure tree with drag-reorder, course.json /
// manifest metadata forms, and new-course / new-lab UI (wrapping the
// same logic as the CLI scaffolder).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PebStatus, type StructureTopic } from "./api";
import { coursePages } from "./pageLinks";
import { linkScrollers } from "./scrollSync";
import { highlightLines, linesToHtml, fenceRangeAt } from "./markdownTokens";
import { parseVerifyOutput, problemsForGuide, byLine, unplaced } from "./verifyProblems";
import {
  anchorFindings, groupFindings, severityLabel, applyScope, rewriteInstruction,
  type AnchoredFinding,
} from "./reviewFindings";
import { annotateLines } from "./lineAnnotations";
import { scrollTopForLine } from "./outline";
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
import { toggleHeadingAt } from "./headingTracking";
import { pebButtonState } from "./pebButton";
import { restoreCaret } from "./caret";
import { useEditorTheme, EDITOR_THEMES } from "./theme";
import { handleMarkdownKey } from "./markdownKeys";
import { WelcomePane } from "./WelcomePane";
import { useProviderHealth, useCourses, useLab, useAi, useSetup, useRepoStatus } from "./hooks";
import { SetupPane } from "./SetupPane";

// Pane floors, in px. Narrower than these and the pane stops being
// useful: the editor can no longer show a wrapped markdown line, and
// the preview stops representing what a learner's window looks like.
// Kept beside each other because the sidebar's clamp is derived from
// both of them.
const MIN_EDITOR = 320;
const MIN_PREVIEW = 300;
/** Width of a .author-splitter, matching the CSS `flex: 0 0 6px`. */
const SPLITTER_PX = 6;

/** One AI-review finding: what is wrong, what to do, and the text it is about. */
function FindingRow({ f, onJump, onApply }: {
  f: AnchoredFinding;
  onJump?: (f: AnchoredFinding) => void;
  onApply?: (f: AnchoredFinding) => void;
}) {
  const jump = onJump && f.anchor ? () => onJump(f) : undefined;
  return (
    <li className={`author-finding is-${f.severity}`}>
      <span className="author-finding-sev">{severityLabel(f.severity)}</span>
      <div className="author-finding-text">
        <span className="author-finding-issue">{f.issue}</span>
        {f.fix && <span className="author-finding-fix">Fix: {f.fix}</span>}
        {f.quote && (
          jump ? (
            <button
              type="button"
              className="author-finding-quote is-jump"
              onClick={jump}
              title="Go to this text in the guide"
            >
              <span className="author-finding-quoted">“{f.quote}”</span>
              {/* Both notes are the difference between a mark you can
                  trust and one you should glance at first: a loose match
                  is not the text the model claims to have quoted, and a
                  quote occurring several times was marked in one of
                  them, chosen by nothing better than order. */}
              {!f.anchor!.exact && <em className="author-finding-note">matched loosely</em>}
              {f.anchor!.occurrences > 1 && (
                <em className="author-finding-note">{f.anchor!.occurrences} places — marked the first</em>
              )}
            </button>
          ) : (
            <span className="author-finding-quote">“{f.quote}”</span>
          )
        )}
        {/* Only where the finding is anchored: applying to a quote we
            could not find would be rewriting a passage chosen by
            accident. */}
        {onApply && f.anchor && (
          <button
            type="button"
            className="author-finding-apply"
            onClick={() => onApply(f)}
            title={
              "Rewrite the block this quote sits in, asking for this fix.\n\n" +
              "The result lands in the editor for you to read — nothing is saved, " +
              "and ↺ Reset puts the original back."
            }
          >
            Apply with AI
          </button>
        )}
      </div>
    </li>
  );
}

function FindingGroup({ title, hint, findings, onJump, onApply }: {
  title: string;
  hint?: string;
  findings: AnchoredFinding[];
  onJump?: (f: AnchoredFinding) => void;
  onApply?: (f: AnchoredFinding) => void;
}) {
  if (!findings.length) return null;
  return (
    <>
      <p className="author-findings-head">
        {title} <span className="author-findings-count">({findings.length})</span>
        {hint && <span className="author-findings-hint"> — {hint}</span>}
      </p>
      <ul className="author-findings-list">
        {findings.map((f) => <FindingRow key={f.id} f={f} onJump={onJump} onApply={onApply} />)}
      </ul>
    </>
  );
}

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

  // Where the Exam Bank is, asked once at startup. It is a separate
  // app on its own release cycle, so "nowhere" is the common answer and
  // the button explains itself rather than disappearing.
  const [peb, setPeb] = useState<PebStatus | null>(null);
  useEffect(() => { api.peb().then(setPeb).catch(() => setPeb(null)); }, []);

  const { health, refreshHealth } = useProviderHealth();
  const { setup } = useSetup(setStatus);
  const { repo, checking: checkingRepo, recheck: recheckRepo } = useRepoStatus();

  // What the pill says. Short enough for a header that already carries a
  // course picker, six buttons and a provider pill - the detail lives in
  // the tooltip, and the one number worth a glance is how far behind.
  const repoLabel = useMemo(() => {
    if (!repo) return "";
    // The repository NAME is the long part and it is already in the
    // tooltip. This header has pushed the Save button off-screen once
    // before (see CLAUDE.md); it did it again the first time this pill
    // carried the full name. "Courses" says what the number is about.
    switch (repo.state) {
      case "behind": return `Courses · ${repo.behind} behind`;
      case "ahead": return `Courses · ${repo.ahead} ahead`;
      case "diverged": return `Courses · ${repo.behind}↓ ${repo.ahead}↑`;
      case "current": return "Courses · up to date";
      case "no-remote": return "Courses · local only";
      case "detached": return "Courses · detached";
      case "no-git": return "Courses · no git";
      default: return "Courses · no checkout";
    }
  }, [repo]);
  const { apiUp, courses, setCourses, course, setCourse, lab, setLab, glossary, courseVersion, onCourseCreated } =
    useCourses(setStatus);
  const {
    detail, setDetail, body, setBody, setDirty, dirty, saving, save,
    onBodyChange, undoEdit, lastEditAt, insertAtCaret, textareaRef, baseUrl,
    structureKey, bumpStructure, lastRewrite, setLastRewrite,
  } = useLab(course, lab, setStatus);
  // The course's pages, for the toolbar's Link to page menu and for
  // following those links in the preview. Fetched here as well as
  // reported by the structure panel, because the panel is unmounted
  // while the sidebar is collapsed and a course switch must not leave
  // the menu offering the previous course's pages.
  const [structureTopics, setStructureTopics] = useState<StructureTopic[]>([]);
  useEffect(() => {
    if (!course) { setStructureTopics([]); return; }
    let live = true;
    api.getStructure(course)
      .then((s) => { if (live) setStructureTopics(s.topics); })
      .catch(() => { if (live) setStructureTopics([]); });
    return () => { live = false; };
  }, [course, structureKey]);
  const pages = useMemo(() => coursePages(structureTopics), [structureTopics]);
  const onStructure = useCallback((s: { topics: StructureTopic[] }) => setStructureTopics(s.topics), []);
  const {
    working, sources, setSources, reviewOut, setReviewOut, verifyOut, setVerifyOut,
    rewriteSelection, rewriteRange, undoRewrite, uploadAndInsertImage, onEditorPaste, onEditorDrop,
    runReview, runVerify,
  } = useAi({
    course, body, setBody, setDirty, setStatus,
    textareaRef, insertAtCaret, bumpStructure, lastRewrite, setLastRewrite,
  });

  // One-click "commit + publish everything" from the toolbar: commits
  // this course's folder in the authoring repo (and pushes), then
  // publishes it to the distribution repo VMs sync from.
  const [publishing, setPublishing] = useState(false);
  // Hand this course to the Exam Bank. A launch and nothing more:
  // the bank opens its own window, reads the course from the repo root
  // it is given, and the editor stops being involved. Deliberately not
  // an API call between the two apps - see api/peb.py for why.
  async function openQuestions() {
    if (!course) return;
    setStatus("Opening the Exam Bank…");
    try {
      const r = await api.launchPeb(course);
      setStatus(`✓ Exam Bank opening on ${course} (${r.kind})`);
    } catch (err) {
      setStatus(`✗ ${(err as Error).message}`);
    }
  }

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
  /**
   * Add or remove the step checkbox on the heading the cursor is on.
   *
   * The lab-level sibling below writes the manifest; this one writes the
   * guide, because that is where the fact lives - a marker on the
   * heading travels with it when it is renamed, moved or copied, and a
   * list of slugs in the manifest would not.
   */
  function toggleHeadingTracking() {
    const ta = textareaRef.current;
    const out = toggleHeadingAt(body, ta?.selectionStart ?? 0);
    if ("problem" in out) {
      setStatus(
        out.problem === "h1"
          ? "An H1 is never a tracked step — only ## and ### carry checkboxes."
          : out.problem === "h4-plus"
            ? "Only ## and ### are tracked steps, so there is nothing to toggle here."
            : out.problem === "tab-title"
              ? "That heading is a TAB TITLE inside a ::: tabs block, not a step — it never had a checkbox."
              : "Put the cursor on a heading line first (## or ###).",
      );
      return;
    }
    onBodyChange(out.ok.text, undefined, true);
    setStatus(
      out.ok.tracked
        ? `“${out.ok.title}” is a tracked step again.`
        : `“${out.ok.title}” no longer tracks — no checkbox, and it does not count toward the steps.`,
    );
    restoreCaret(ta, out.ok.start, out.ok.end);
  }

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
  // it feeds. Tokenised once and reused: the markup needs the lines, and
  // so does the fence pair under the caret.
  const lines = useMemo(
    () => (syntaxColour ? highlightLines(body) : []),
    [body, syntaxColour],
  );
  // Verify's spans, as marks the markup builder can apply. Built before
  // `highlighted` because the underline is woven INTO the line's markup —
  // a character range crosses colour spans, so it cannot be a class on
  // the line or an overlay measured in pixels.
  // Verify's findings for the open guide. Declared BEFORE the marks and
  // the markup that consume it: a const is not hoisted, so using it
  // earlier is a runtime crash TypeScript catches only because the two
  // are in the same scope.
  const problems = useMemo(
    // verifyOut is the API's {ok, output} envelope, or "" before a run.
    () => problemsForGuide(parseVerifyOutput(typeof verifyOut === "string" ? "" : verifyOut?.output ?? ""), course, lab),
    [verifyOut, course, lab],
  );

  // The AI review's findings, anchored to the text they quote.
  //
  // Re-anchored against the LIVE body rather than the one that was
  // reviewed, which is what keeps these marks honest as you type: fix
  // the sentence a finding objects to and the quote stops matching, so
  // the mark goes rather than sliding onto whatever now occupies that
  // line. Verify cannot do this — it reads disk and reports lines, hence
  // the "lines may have moved" warning it needs and this does not.
  const reviewFindings = useMemo(
    () => anchorFindings(body, reviewOut?.findings ?? []),
    [body, reviewOut],
  );
  const reviewGroups = useMemo(() => groupFindings(reviewFindings), [reviewFindings]);

  // The review's line in the count bar. Empty when there is nothing to
  // say — a review whose findings are all about the guide as a whole has
  // marked nothing, and "0 marked" is not news.
  const reviewNote = useMemo(() => {
    const parts: string[] = [];
    const { located, unlocated, fixed } = reviewGroups;
    if (located.length) parts.push(`${located.length} marked by AI review`);
    if (unlocated.length) {
      parts.push(`${unlocated.length} AI finding${unlocated.length === 1 ? "" : "s"} couldn’t be located`);
    }
    if (fixed.length) parts.push(`${fixed.length} fixed since the review`);
    return parts.join(" · ");
  }, [reviewGroups]);

  // Both channels meet in one pure pass — the underlines woven into the
  // markup and the classes written onto the line elements come out of the
  // same call, because merging them twice here is how a line ended up
  // underlined by one and untitled by the other.
  const { marks, lines: lineNotes } = useMemo(
    () => annotateLines(body, problems, reviewFindings),
    [body, problems, reviewFindings],
  );
  const highlighted = useMemo(() => linesToHtml(lines, marks), [lines, marks]);

  // Which source line the caret is on, 0-based.
  const [caretLine, setCaretLine] = useState(0);
  function syncCaretLine() {
    const ta = textareaRef.current;
    if (!ta) return;
    // Counting newlines is exact where measuring geometry is not: a
    // wrapped line is several visual rows but one source line, and the
    // gutter numbers source lines.
    setCaretLine(ta.value.slice(0, ta.selectionStart).split("\n").length - 1);
  }

  // Jump to the text a finding is about, and select it.
  //
  // The mark shows where a finding is once you are looking at the right
  // part of the guide; this is for the panel, where the finding is a row
  // in a list and the text it quotes may be three screens away. Selecting
  // is what anchors the caret — the scroll only puts it in view, and a
  // textarea gives no per-line geometry to do better.
  function jumpToFinding(f: AnchoredFinding) {
    const ta = textareaRef.current;
    if (!ta || !f.anchor) return;
    ta.focus();
    ta.setSelectionRange(f.anchor.start, f.anchor.end);
    const lh = parseFloat(window.getComputedStyle(ta).lineHeight);
    if (Number.isFinite(lh) && lh > 0) {
      const line = body.slice(0, f.anchor.start).split("\n").length - 1;
      // The highlight layer follows through the textarea's own onScroll.
      ta.scrollTop = scrollTopForLine(line, lh);
    }
    requestAnimationFrame(syncCaretLine);
  }

  // Apply a finding: select the block its quote sits in, then run the
  // ordinary Rewrite over that block with the reviewer's own words as the
  // instruction.
  //
  // Deliberately NOT a one-click patch from the review's own output. The
  // reviewer is the least reliable thing in the editor - the first live
  // run demanded the removal of a section that existed only in its own
  // prompt - so applying goes the long way round: a second call, over a
  // passage the author can see selected, landing in the buffer under the
  // same undo as every other rewrite. Nothing is saved.
  //
  // What it cannot do is reach beyond the block. A finding whose fix is
  // "add a Get Started link at the end of the page" is not a rewording
  // problem, and no amount of instruction makes the paragraph it quoted
  // into the right place to solve it. Those stay a job for the author,
  // which is why the panel still leads with the quote and the jump.
  function applyFinding(f: AnchoredFinding) {
    const ta = textareaRef.current;
    if (!ta || !f.anchor) return;
    const scope = applyScope(body, f.anchor);
    ta.focus();
    ta.setSelectionRange(scope.start, scope.end);
    const line = body.slice(0, scope.start).split("\n").length - 1;
    const lh = parseFloat(window.getComputedStyle(ta).lineHeight);
    if (Number.isFinite(lh) && lh > 0) ta.scrollTop = scrollTopForLine(line, lh);
    requestAnimationFrame(syncCaretLine);
    rewriteRange(scope.start, scope.end, rewriteInstruction(f), `Applying: ${f.issue}`);
  }

  // The current-line band and the fence pair are written straight onto
  // the layer's nodes rather than re-rendered. The caret moves far more
  // often than the text changes, and re-rendering a hundred elements to
  // move one highlight is the difference between typing that feels
  // instant and typing that does not.
  useEffect(() => {
    const root = highlightRef.current;
    if (!root) return;
    const kids = root.children;
    for (const el of Array.from(kids)) el.classList.remove("is-current", "is-fence");
    kids[caretLine]?.classList.add("is-current");
    // Inside a fenced block, light both markers — an unclosed fence is
    // one of the two errors the verifier treats as fatal, and this shows
    // you the opener with nothing to match it.
    const fence = fenceRangeAt(lines, caretLine);
    if (fence) {
      kids[fence.start]?.classList.add("is-fence");
      kids[fence.end]?.classList.add("is-fence");
    }
  }, [caretLine, highlighted, lines]);

  // Verify's problems and the AI review's findings, on the lines they
  // belong to.
  //
  // Both used to print into a panel and leave you to find the line they
  // were talking about. They are marked by the same pass because a line
  // can carry both and has one title attribute between them — running
  // two effects over the same nodes meant whichever came second erased
  // the first one's tooltip.
  //
  // Their marks look different on purpose. Verify measured the file and
  // is right; the review is an opinion, and one that is wrong often
  // enough to be worth reading as an opinion.
  useEffect(() => {
    const root = highlightRef.current;
    if (!root) return;
    const kids = root.children;
    for (const el of Array.from(kids)) {
      el.classList.remove("has-error", "has-warn", "has-review");
      el.removeAttribute("title");
    }
    for (const [line, ann] of lineNotes) {
      // Both channels count from 1; the layer's blocks from 0.
      const el = kids[line - 1];
      if (!el) continue;
      el.classList.add(...ann.classes);
      el.setAttribute("title", ann.title);
    }
  }, [lineNotes, highlighted]);

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

  // Ctrl/Cmd+Z.
  //
  // All of it, not just the toolbar's edits. The plan was to leave
  // typing to the browser's own undo and only cover what React assigns -
  // until a real keyboard proved the browser undoes NEITHER here. Press
  // three keys in the textarea, press Ctrl+Z, and all three stay: a
  // controlled textarea has its value reassigned on every keystroke, and
  // a value the page sets is not an edit the browser has history for.
  // So there was never a native stack to protect, and the editor simply
  // had no undo at all.
  //
  // preventDefault only when the history actually stepped back, so
  // Ctrl+Z at the bottom behaves like an unhandled shortcut instead of
  // looking broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (undoEdit()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoEdit]);

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
    // While the author is typing, the preview may not drive.
    //
    // It re-renders on every keystroke, and a re-render that changes its
    // height moves its own scrollTop - which the link counted as a
    // gesture and mapped back onto the editor, about four times
    // magnified because the source is that much taller than the render.
    // The view slid off the caret as the author typed and the next
    // keystroke snapped it back: one character moved the editor 1341px.
    // The caret is the authority while editing; the preview follows.
    return linkScrollers(ta, pv, 120, (from) =>
      from === pv && Date.now() - lastEditAt.current < 400,
    );
  }, [lab, welcomeMode, detail, textareaRef]);

  // No courses to edit yet — the installed editor's first launch, or a
  // PCM_REPO pointing somewhere that has moved. Before the API could
  // report this, it died at import and the branch below claimed the API
  // was unreachable, which was true and useless.
  //
  // The reload afterwards is deliberate and cheap: at this point no lab
  // is open and no buffer exists (this screen replaced the whole
  // editor), so there is nothing to lose, and re-running boot is more
  // honest than threading a refresh through four hooks that all cached
  // "there are no courses".
  if (setup && !setup.valid) {
    return <SetupPane setup={setup} onReady={() => window.location.reload()} />;
  }

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
        <button
          type="button"
          className="author-tool"
          onClick={openQuestions}
          disabled={pebButtonState(peb, course, working).disabled}
          title={pebButtonState(peb, course, working).title}
        >
          {pebButtonState(peb, course, working).label}
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
        {/* Which checkout, and whether it has moved on without us. The
            editor writes into a repository other people publish into,
            and nothing said so: you could rewrite a guide that was
            replaced upstream this morning and find out at Publish. */}
        {repo && (
          <button
            type="button"
            className={`author-repo is-${repo.state}${checkingRepo ? " is-checking" : ""}`}
            onClick={recheckRepo}
            disabled={checkingRepo}
            title={
              `Content Manager: ${repo.path}` +
              (repo.branch ? `\nBranch: ${repo.branch}${repo.upstream ? ` → ${repo.upstream}` : ""}` : "") +
              (repo.dirty ? "\nUncommitted changes in the checkout." : "") +
              (repo.detail ? `\n${repo.detail}` : "") +
              "\n\nClick to fetch and check again."
            }
          >
            <span className="author-repo-dot" />
            {/* The words go first when the header runs out of room; the
                dot and the tooltip carry the meaning on a laptop. */}
            <span className="author-repo-label">{repoLabel}</span>
          </button>
        )}
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
            <span>
              🔍 AI review
              {reviewOut.findings.length > 0 &&
                ` — ${reviewGroups.located.length} of ${reviewOut.findings.length} marked in the source`}
            </span>
            <button type="button" className="author-mini-btn" onClick={() => setReviewOut(null)}>Dismiss</button>
          </div>
          {reviewOut.findings.length === 0 ? (
            // Nothing parseable came back: a provider ignored the JSON
            // instruction, or answered in prose around it. Its answer is
            // still a review, so it is shown as one rather than dropped
            // for failing to fit the new shape.
            <pre className="author-verify-body">{reviewOut.text}</pre>
          ) : (
            <div className="author-findings">
              <FindingGroup
                title="Marked in the source"
                hint="click a quote to jump to it, or let the AI attempt the fix"
                findings={reviewGroups.located}
                onJump={jumpToFinding}
                onApply={health?.ok === false ? undefined : applyFinding}
              />
              <FindingGroup
                title="About the guide as a whole"
                hint="the finding is that something is absent, so there is nothing to underline"
                findings={reviewGroups.general}
              />
              <FindingGroup
                title="Fixed since the review ran"
                hint="the text these quoted is no longer in the guide"
                findings={reviewGroups.fixed}
              />
              {/* The group that earns the anchoring. A quote the guide has
                  never contained is a finding about a lab that does not
                  exist — the failure mode of asking a model where a
                  problem is, made visible instead of underlined. */}
              <FindingGroup
                title="Couldn’t be found in the guide"
                hint="the quoted text is not in this lab — check these by hand before acting on them"
                findings={reviewGroups.unlocated}
              />
            </div>
          )}
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
                onStructure={onStructure}
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
                {/* Find & replace was keyboard-only — Ctrl/Cmd+F and
                    nothing else — so an author who did not already know
                    it existed had no way to discover it, and asked for
                    a feature the editor had shipped for weeks. A binding
                    is not a feature until something on screen says so.
                    The shortcut still works and the title names it. */}
                <button
                  type="button"
                  className={`author-toolbar-btn${showFind ? " is-active" : ""}`}
                  onClick={() => setShowFind((v) => !v)}
                  disabled={working}
                  title="Find & replace in this lab (Ctrl/Cmd+F). Plain text, never regex — guides are full of ** and [ and |"
                >
                  🔍 Find
                </button>
                {/* The 🖼 Image button is gone from this bar: the Media
                    menu carries the image blocks, and two doors to
                    "image" a few centimetres apart is one too many.
                    The file input it opened is KEPT below and still
                    fed by paste and drag-drop, which is how an image
                    actually arrives from a screenshot tool. */}
                <button type="button" className="author-toolbar-btn" onClick={() => setShowLabFiles(true)} disabled={working} title="Manage this lab's downloadable files (.ktr / .kjb / data)">
                  📎 Files
                </button>
                {/* Tracking is TWO questions at two scopes — does this
                    lab track at all, and does this heading — so it is
                    one menu rather than a button here and an entry
                    buried in the Heading insert menu, where a toggle
                    never belonged: that menu inserts, this one changes
                    what is already written. */}
                <Menu
                  label={detail?.manifest?.noProgress ? "◻ No tracking" : "☑ Tracking"}
                  tone="tracking"
                  title={
                    detail?.manifest?.kind === "page"
                      ? "Pages never track steps"
                      : "Step tracking — for this lab, or for the heading the cursor is on"
                  }
                  disabled={working || !detail || detail.manifest?.kind === "page"}
                  items={[
                    {
                      label: detail?.manifest?.noProgress
                        ? "This lab: turn tracking ON"
                        : "This lab: turn tracking OFF",
                      title: detail?.manifest?.noProgress
                        ? "Tracking is OFF for this lab — no checkboxes, no step numbers, no progress bar"
                        : "Turn off checkboxes, progress and step numbers for the whole lab",
                      onSelect: toggleTracking,
                    },
                    {
                      label: "This heading: tracking on/off",
                      title: "Put the cursor on a ## or ### heading, then choose this to add or remove its step checkbox",
                      onSelect: toggleHeadingTracking,
                    },
                  ]}
                />
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
              <Toolbar
                textarea={textareaRef.current}
                value={body}
                pages={pages}
                currentSlug={lab}
                /* programmatic: the browser never saw these, so they
                   need recording for Ctrl+Z to reach them. */
                onChange={(next, caret) => onBodyChange(next, caret, true)}
              />
              {(problems.length > 0 || reviewNote) && (
                <div className={`author-problems${problems.length === 0 ? " is-review-only" : ""}`}>
                  {problems.length > 0 && (
                    <>
                      <span className="author-problems-count">
                        {byLine(problems).size > 0
                          ? `${byLine(problems).size} line${byLine(problems).size === 1 ? "" : "s"} flagged by Verify`
                          : "Verify flagged this lab"}
                      </span>
                      {/* Without this, a guide whose problems all lack a line
                          looks clean in the gutter while Verify reports
                          failures, and you would reasonably conclude the
                          marking was broken. */}
                      {unplaced(problems).length > 0 && (
                        <span className="author-problems-rest">
                          · {unplaced(problems).length} not tied to a line (see the Verify panel)
                        </span>
                      )}
                      {/* Verify reads DISK; this pane shows the buffer. With
                          unsaved edits the two disagree about what is on
                          which line, and a marker can sit a few lines off.
                          Saying so beats quietly pointing at the wrong line. */}
                      {dirty && (
                        <span className="author-problems-stale">
                          · unsaved edits — lines may have moved since Verify ran
                        </span>
                      )}
                    </>
                  )}
                  {/* The review's own tally. It needs no staleness warning:
                      its marks are re-anchored to the buffer on every
                      keystroke, so they cannot be pointing at a line that
                      has moved. */}
                  {reviewNote && (
                    <span className="author-problems-review">
                      {problems.length > 0 && "· "}{reviewNote}
                    </span>
                  )}
                  <span className="author-problems-hint">hover a flagged line number for the message</span>
                </div>
              )}
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
                onSelect={syncCaretLine}
                onClick={syncCaretLine}
                onKeyUp={syncCaretLine}
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
                pages={pages}
                onOpenPage={(slug) => { setWelcomeMode(false); setLab(slug); }}
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
          title={
            "Course content version (course.json), this editor's build, and the " +
            "Content Manager Engine that draws the preview.\n\n" +
            "Running from a checkout the Engine is whatever the sibling repo " +
            "has right now. Installed, it is bundled at build time \u2014 so if this " +
            "number trails the Content Manager you are editing, the preview is " +
            "showing you the older app."
          }
        >
          {courseVersion ? `Course v${courseVersion} \u00b7 ` : ""}Editor v{__APP_VERSION__}
          {` \u00b7 Engine v${__PCM_VERSION__}`}
        </span>
      </footer>
    </div>
  );
}
