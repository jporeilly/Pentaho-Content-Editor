"""Shared kernel for the course-editor API.

Paths, filesystem/JSON helpers, manifest-metric helpers (mirroring
``scripts/stamp-manifests.mjs``), the structure (SUMMARY.md) parser, and
the small AI-prompt helpers that more than one router needs. The route
modules under ``routers/`` import from here; nothing here imports a
router, so there are no cycles.

Tests monkeypatch ``core.COURSES_DIR`` to a temp dir. Route functions
that need it must reference ``core.COURSES_DIR`` (attribute access at call
time) — never ``from core import COURSES_DIR`` — so the patch is seen.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

import providers
import mcp
import tools

# ── Where the courses live ──────────────────────────────────────────
# The editor is its own project now, but the courses it edits belong to
# the Pentaho Content Manager: that is the app that ships them to a VM,
# and the install order is Content Manager first, editor second. So the
# editor hooks into the app's repository rather than owning a copy.
#
# Resolution order:
#
#   1. PCM_REPO in the environment — one machine, one answer, no UI.
#   2. the saved `pcmRepo` setting — what the first-run screen writes.
#   3. the sibling directory — right for every checkout, which is why it
#      stayed the default through the repo split.
#
# **This does not raise when the answer is wrong**, and that is the whole
# difference between a checkout and an install. From a checkout, a bad
# PCM_REPO is a typo the author fixes in the shell they just used. From
# an installed app there IS no shell: a RuntimeError at import kills
# uvicorn before the window can open, and the author sees a splash saying
# the API is unreachable — which is true, and tells them nothing. So the
# constants stay bound to wherever we looked, `repo_problem()` says what
# is wrong with it, and the UI offers a folder picker.
EDITOR_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPO = EDITOR_ROOT.parent / "Pentaho-Content-Manager"


def installer_hint() -> Path | None:
    """A checkout the installer found, recorded machine-wide.

    The installer's "Find my Content Manager courses" component writes
    it to HKLM rather than to the settings file, and that is forced: an
    elevated installer's %APPDATA% belongs to the ELEVATING account,
    which on a managed laptop is an admin who will never run the editor.
    So it leaves a hint where any account can read it, and the app -
    running as the actual author - decides what to do with it.

    Never authoritative. It sits below the environment and the author's
    own saved choice, and a hint pointing at a folder that has since
    moved is simply ignored.
    """
    if sys.platform != "win32":
        return None
    try:
        import winreg
    except ImportError:
        return None
    # Both registry VIEWS, and that is not belt-and-braces for its own
    # sake. An NSIS installer is a 32-bit process, so the PowerShell it
    # launches writes HKLM\SOFTWARE into the WOW6432Node mirror; a
    # 64-bit reader looking only at the native view sees nothing and the
    # editor asks on first run anyway. The installer writes the 64-bit
    # view explicitly now, and this still reads both - an install from an
    # older build left its hint in the other one.
    views = (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY)
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in views:
            try:
                with winreg.OpenKey(
                    hive, r"SOFTWARE\Pentaho\ContentEditor", 0, winreg.KEY_READ | view
                ) as key:
                    value, _ = winreg.QueryValueEx(key, "PcmRepo")
            except OSError:
                continue
            if value:
                return Path(str(value)).expanduser()
    return None


def _resolve_repo_root() -> Path:
    from_env = os.environ.get("PCM_REPO")
    if from_env:
        return Path(from_env).expanduser().resolve()
    saved = providers.load_settings().get("pcmRepo")
    if saved:
        return Path(str(saved)).expanduser().resolve()
    hint = installer_hint()
    if hint and (hint / "courses").is_dir():
        return hint.resolve()
    return DEFAULT_REPO.resolve()


REPO_ROOT = _resolve_repo_root()
COURSES_DIR = REPO_ROOT / "courses"


def repo_problem(root: Path | None = None) -> str | None:
    """Why `root` is not a usable Content Manager checkout, or None.

    Only the courses are fatal. A folder with `courses/` but no
    `scripts/` is a real thing — a content-only clone — and the editor is
    genuinely useful against one: everything except scaffolding and
    Verify works, because a save re-stamps its manifest metrics in
    Python rather than by calling stamp-manifests.mjs. Refusing it
    outright would trade a working editor for a tidier check.
    `scaffolding_available()` is what the UI asks about that.
    """
    root = Path(root) if root is not None else REPO_ROOT
    if not root.is_dir():
        return f"No folder at {root}."
    if not (root / "courses").is_dir():
        return (
            f"No courses directory in {root}.\n"
            "The Pentaho Content Editor edits the Content Manager's courses, so "
            "point it at that repository's root."
        )
    return None


def scaffolding_available(root: Path | None = None) -> bool:
    """Are the Content Manager's authoring scripts where we shell out to them?"""
    root = Path(root) if root is not None else REPO_ROOT
    return (root / "scripts" / "new-course.mjs").is_file()


# Where a Content Manager checkout plausibly lives. Ordered: the sibling
# directory first, because from a checkout that is nearly always the
# answer, then the places people actually clone into.
#
# One level deep only. A recursive hunt across a home directory is how a
# first-run screen ends up waiting on OneDrive, a mapped drive or a
# node_modules tree twelve levels down; the payoff is finding the same
# folder half a second later.
def _candidate_roots() -> list[Path]:
    home = Path.home()
    return [
        EDITOR_ROOT.parent,
        Path("C:/Projects"),
        home / "Projects",
        home / "source" / "repos",
        home / "git",
        home / "Documents",
        home,
    ]


MAX_CANDIDATES = 6
_MAX_SCAN_PER_ROOT = 120


def find_repo_candidates(limit: int = MAX_CANDIDATES) -> list[dict[str, Any]]:
    """Content Manager checkouts this machine appears to have.

    For the first-run screen, which otherwise asks an author to type an
    absolute path from memory — and on an installed editor it cannot even
    offer a sensible default, because the sibling directory resolves to
    somewhere inside Program Files that has never existed.

    A candidate is any directory with a `courses/` in it, which is the
    same bar `repo_problem` sets. Ones that also have the authoring
    scripts sort first: both are usable, but only one of them can
    scaffold and verify.

    Best-effort by construction. An unreadable root, a permission error
    or a disconnected drive skips that root rather than failing the
    screen that is trying to rescue the situation.
    """
    seen: set[Path] = set()
    found: list[dict[str, Any]] = []

    def consider(path: Path) -> None:
        try:
            resolved = path.resolve()
        except OSError:
            return
        if resolved in seen or not resolved.is_dir():
            return
        seen.add(resolved)
        if repo_problem(resolved) is not None:
            return
        found.append({
            "path": str(resolved),
            "scaffolding": scaffolding_available(resolved),
        })

    for root in _candidate_roots():
        try:
            if not root.is_dir():
                continue
            # The obvious name first, then anything else one level down
            # that happens to hold courses - a clone renamed on checkout
            # is common, and the folder's contents are the real test.
            consider(root / "Pentaho-Content-Manager")
            for child in list(root.iterdir())[:_MAX_SCAN_PER_ROOT]:
                if child.name.startswith("."):
                    continue
                consider(child)
        except OSError:
            continue
        if len(found) >= limit:
            break

    found.sort(key=lambda c: (not c["scaffolding"], c["path"]))
    return found[:limit]


def set_repo_root(root: str | Path, persist: bool = True) -> Path:
    """Point the editor at a Content Manager checkout.

    Rebinds the module attributes rather than returning a new object,
    because every route reads `core.COURSES_DIR` at call time — the rule
    at the top of this file, which the tests already rely on and which
    makes re-pointing a live server a two-line operation instead of a
    restart.
    """
    global REPO_ROOT, COURSES_DIR
    candidate = Path(root).expanduser().resolve()
    problem = repo_problem(candidate)
    if problem:
        raise HTTPException(400, problem)

    REPO_ROOT = candidate
    COURSES_DIR = candidate / "courses"
    if persist:
        providers.save_settings({"pcmRepo": str(candidate)})
    return REPO_ROOT


# ── Metric helpers (mirror stamp-manifests.mjs) ─────────────────────

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)


def _strip_fences(body: str) -> str:
    return _FENCE_RE.sub("", body)


# A heading that is NOT a step: named reference material ("Lab Files",
# "Verify your work"), or one the author marked with
# `## Troubleshooting <!-- no-step -->`.
#
# This mirrors MarkdownBody's NO_STEP_RE / REFERENCE_HEADINGS and the
# Content Manager's course-authoring.mjs. The mirroring is the whole
# problem: four copies of one rule, and this one had already drifted -
# it counted reference headings the Engine never shows a checkbox for,
# so a save stamped a stepCount one higher than the learner could tick.
# The editor is the surface that stamps most manifests, so this copy
# being wrong was the one that mattered.
_NO_STEP = re.compile(r"<!--\s*no-?step\s*-->", re.IGNORECASE)
_REFERENCE_HEADING = re.compile(r"^\s*(lab files|verify your work)\s*$", re.IGNORECASE)


def is_step_heading(text: str) -> bool:
    """Does this heading's text earn a checkbox?"""
    if _NO_STEP.search(text):
        return False
    return not _REFERENCE_HEADING.match(_NO_STEP.sub("", text).strip())


def count_steps(body: str) -> int:
    without_fences = _strip_fences(body)
    heading_count = sum(
        1
        for h in re.findall(r"^#{2,3}\s+(.+)$", without_fences, re.MULTILINE)
        if is_step_heading(h)
    )
    tab_count = 0
    m = re.search(r'data-tabs="([^"]+)"', without_fences)
    if m:
        try:
            from urllib.parse import unquote

            tabs = json.loads(unquote(m.group(1)))
            if isinstance(tabs, list):
                tab_count = len(tabs)
        except (ValueError, TypeError):
            pass
    return heading_count + tab_count


def detect_has_video(body: str) -> bool:
    no_fences = _strip_fences(body)
    patterns = [
        r"loom\.com/(share|embed)/",
        r"(?:youtube\.com/(watch|embed)|youtu\.be/)",
        # Vimeo: vimeo.com/<id>, vimeo.com/<id>/<unlisted-hash>,
        # player.vimeo.com/video/<id> — the hosts VideoEmbed.tsx renders.
        r"(?:vimeo\.com/(?:video/)?|player\.vimeo\.com/video/)\d+",
        r"!\[[^\]]*\]\([^)]+\.(?:mp4|webm|mov|m4v)(?:[#?][^)]*)?\)",
        r"<video[\s>]",
    ]
    return any(re.search(p, no_fences, re.IGNORECASE) for p in patterns)


def estimate_minutes(step_count: int) -> int:
    raw = 10 + step_count * 2
    clamped = min(60, max(5, raw))
    return round(clamped / 5) * 5


def stamp_metrics(manifest: dict[str, Any], body: str) -> dict[str, Any]:
    """Recompute the derived manifest fields from a guide body (step count
    and video are never trusted from the client) and fill in a missing
    timing. Mutates and returns the manifest."""
    steps = count_steps(body)
    manifest["stepCount"] = steps
    manifest["hasVideo"] = detect_has_video(body)
    # Timing is author-owned once set (same rule as scripts/stamp-manifests.mjs):
    # only fill it in when missing, so a hand-set or editor-set value survives
    # every guide save. save_lab drops the key on estimatedMinutes: null, and
    # this refills it from the step count.
    if not isinstance(manifest.get("estimatedMinutes"), int):
        manifest["estimatedMinutes"] = estimate_minutes(steps)
    return manifest


# ── Filesystem helpers ──────────────────────────────────────────────


def _course_dir(course: str) -> Path:
    path = (COURSES_DIR / course).resolve()
    # Guard against traversal (course must be a direct child of courses/).
    if path.parent != COURSES_DIR.resolve() or not path.is_dir():
        raise HTTPException(404, f"Course not found: {course}")
    if not (path / "course.json").exists():
        raise HTTPException(404, f"Not a course (no course.json): {course}")
    return path


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: dict[str, Any]) -> None:
    # ensure_ascii=False keeps course.json / manifest.json readable UTF-8
    # (e.g. an em-dash stays "—", not "—") — matches how the Node
    # scaffolder writes them, so a save doesn't churn the diff.
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _is_lab_dir(course_path: Path, name: str) -> bool:
    if name.startswith(".") or name.startswith("_"):
        return False
    d = course_path / name
    return d.is_dir() and (d / "manifest.json").exists()


def _lab_number(dir_name: str) -> int:
    m = re.match(r"^(\d+)", dir_name)
    return int(m.group(1)) if m else 0


def _slugify(text: str) -> str:
    """URL-safe slug — mirrors slugify() in the Node scaffolder so the
    course dir the scaffolder creates is predictable."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]
    return s or "course"


def _run_node(args: list[str], what: str) -> str:
    # REPO_ROOT and the node binary are both read at call time: the first
    # so a re-point takes effect without a restart, the second so a
    # bundled copy is used when there is one. See tools.py.
    node = tools.node()
    if not node:
        raise HTTPException(
            500,
            "Node.js was not found. It runs the Content Manager's authoring "
            "scripts, so New Course, New Lab, Import and Verify need it — "
            "install Node and restart the editor. Editing and saving do not.",
        )
    try:
        proc = subprocess.run(
            [node, *args], cwd=str(REPO_ROOT),
            check=True, capture_output=True, text=True, encoding="utf-8", timeout=45,
        )
        return proc.stdout
    except FileNotFoundError:
        raise HTTPException(500, f"`{node}` could not be run — the Node install looks broken")
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"{what} failed: {e.stderr or e.stdout}")


_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
_MAX_UPLOAD = 20 * 1024 * 1024


def _safe_name(name: str, default: str) -> str:
    base = Path(name or default).name
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or default
    return base


def _unique(directory: Path, name: str) -> Path:
    target = directory / name
    if not target.exists():
        return target
    stem, ext = target.stem, target.suffix
    i = 1
    while (directory / f"{stem}-{i}{ext}").exists():
        i += 1
    return directory / f"{stem}-{i}{ext}"


# ── Shared models ───────────────────────────────────────────────────


class Source(BaseModel):
    title: str
    url: str


class LabSummary(BaseModel):
    slug: str
    title: str
    order: int = 0
    kind: str = "workshop"


class LabDetail(BaseModel):
    slug: str
    body: str
    manifest: dict[str, Any]
    # sha1 of ``body`` as stored on disk. The client sends it back as
    # ``baseHash`` on save so a stale tab cannot overwrite newer text.
    bodyHash: str | None = None


class SaveLabRequest(BaseModel):
    # None = manifest-only save: the guide on disk is left untouched.
    # The timing / tracking controls use this so a tab holding an older
    # copy of the text can never write it back by accident.
    body: str | None = None
    # Optional metadata edits (title / description / kind / timing).
    # Derived metrics are always recomputed server-side, never trusted
    # from the client.
    manifest: dict[str, Any] | None = None
    # Conflict guard: hash of the body this client loaded. If the disk
    # copy has changed since (another tab, an external edit) and the new
    # body differs from it, the save is refused with 409 unless ``force``.
    baseHash: str | None = None
    force: bool = False


def body_hash(text: str) -> str:
    """Fingerprint of a guide body — what ``LabDetail.bodyHash`` carries."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


class StructureLab(BaseModel):
    slug: str
    title: str
    kind: str = "workshop"


class StructureTopic(BaseModel):
    """One ``##``/``###``/``####`` section of SUMMARY.md.

    Topics nest via ``children`` to mirror the Engine's ``TopicNode``
    (localFolderSource.ts): ``##`` is top level, ``###`` nests under the
    preceding ``##``, ``####`` under the preceding ``###``. ``page`` is
    the topic's own guide, written back as the ``<!-- topic-page: … -->``
    comment the Engine reads — a topic that is both a page and a group.
    """

    title: str
    labs: list[StructureLab]
    children: list["StructureTopic"] = []
    page: StructureLab | None = None


class Structure(BaseModel):
    topics: list[StructureTopic]


# ── Structure (SUMMARY.md) parse / write ────────────────────────────

_SUMMARY_LINK = re.compile(r"^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$")
# Any heading from ## down. Capturing the hashes gives the nesting depth
# (## -> 0, ### -> 1), exactly as the Engine's parser computes it. The
# old ``^##\s+`` form did not match ``###`` at all, so sub-topics parsed
# as nothing and _write_structure then erased them on the next save.
_SUMMARY_HEAD = re.compile(r"^(#{2,})\s+(.+)$")
_SUMMARY_TOPIC_PAGE = re.compile(r"^<!--\s*topic-page:\s*([^\s>]+)\s*-->$")


def _lab_entry(course_path: Path, slug: str, fallback_title: str) -> StructureLab | None:
    """Build a StructureLab from a slug, or None if it has no manifest."""
    man_path = course_path / slug / "manifest.json"
    if not man_path.exists():
        return None
    man = _read_json(man_path)
    return StructureLab(
        slug=slug,
        title=man.get("title", fallback_title),
        kind="page" if man.get("kind") == "page" else "workshop",
    )


def walk_topics(topics: list[StructureTopic]):
    """Yield every topic in the tree, parents before children.

    Anything that used to loop ``for t in structure.topics`` needs this
    now that topics nest — a flat loop silently skips every sub-topic,
    which is how a lab under ``### Flat Files`` escapes validation.
    """
    for topic in topics:
        yield topic
        yield from walk_topics(topic.children)


def walk_labs(topics: list[StructureTopic]):
    """Yield every lab in the tree, including each topic's own page."""
    for topic in walk_topics(topics):
        if topic.page is not None:
            yield topic.page
        yield from topic.labs


def prune_lab(topics: list[StructureTopic], slug: str) -> list[StructureTopic]:
    """Copy of the tree with ``slug`` removed wherever it appears —
    as a lab or as a topic's own page — keeping nesting intact."""
    return [
        StructureTopic(
            title=t.title,
            labs=[l for l in t.labs if l.slug != slug],
            children=prune_lab(t.children, slug),
            page=None if (t.page is not None and t.page.slug == slug) else t.page,
        )
        for t in topics
    ]


def _parse_structure(course_path: Path) -> list[StructureTopic]:
    """Parse SUMMARY.md into an ordered topic tree, each topic with its
    labs (in SUMMARY order) and nested sub-topics. Lab titles come from
    the manifest so a rename in one place stays authoritative."""
    summary = course_path / "SUMMARY.md"
    topics: list[StructureTopic] = []
    if not summary.exists():
        return topics
    # (depth, topic) stack — a heading pops every entry at or below its
    # own depth, so a new ## resets to the root.
    stack: list[tuple[int, StructureTopic]] = []
    for raw in summary.read_text(encoding="utf-8").splitlines():
        page = _SUMMARY_TOPIC_PAGE.match(raw.strip())
        if page and stack:
            entry = _lab_entry(course_path, page.group(1).strip(), "")
            if entry is not None:
                stack[-1][1].page = entry
            continue

        head = _SUMMARY_HEAD.match(raw)
        if head:
            depth = len(head.group(1)) - 2
            topic = StructureTopic(title=head.group(2).strip(), labs=[], children=[])
            while stack and stack[-1][0] >= depth:
                stack.pop()
            if stack:
                stack[-1][1].children.append(topic)
            else:
                topics.append(topic)
            stack.append((depth, topic))
            continue

        link = _SUMMARY_LINK.match(raw)
        if link and stack:
            slug = link.group(2).replace("\\", "/").lstrip("./").split("/")[0]
            entry = _lab_entry(course_path, slug, link.group(1).strip())
            if entry is not None:
                stack[-1][1].labs.append(entry)
    return topics


def _write_structure(course_path: Path, topics: list[StructureTopic]) -> None:
    """Rewrite SUMMARY.md from the given topic/lab order, and sync each
    lab's manifest `order` (flattened 1-based sequence) and `title`."""
    # Keep whatever H1 the file already has. This rewrites SUMMARY.md
    # wholesale on every reorder, rename and delete, and hardcoding the
    # heading silently replaced author titles like
    # "# Pentaho Developer - ML Specialty" with "# Table of contents".
    # The default is only for a course that has no heading yet.
    summary_path = course_path / "SUMMARY.md"
    heading = "# Table of contents"
    if summary_path.exists():
        for line in summary_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                heading = line.rstrip()
                break

    lines = [heading, ""]
    seq = 0

    def sync_manifest(lab: StructureLab) -> None:
        nonlocal seq
        seq += 1
        man_path = course_path / lab.slug / "manifest.json"
        if man_path.exists():
            man = _read_json(man_path)
            man["order"] = seq
            man["title"] = lab.title
            _write_json(man_path, man)

    def emit(topic: StructureTopic, depth: int) -> None:
        # Depth caps at #### — the Engine's own parser stops nesting
        # deeper, so a runaway indent flattens rather than writing a
        # heading nothing can read back.
        lines.append(f"{'#' * min(depth + 2, 4)} {topic.title}")
        lines.append("")
        if topic.page is not None:
            # The Engine attaches this to the topic on the stack, so it
            # has to sit directly under the heading.
            lines.append(f"<!-- topic-page: {topic.page.slug} -->")
            lines.append("")
            sync_manifest(topic.page)
        for lab in topic.labs:
            lines.append(f"* [{lab.title}]({lab.slug}/guide.md)")
            sync_manifest(lab)
        lines.append("")
        # Labs before children — the sidebar renders a topic's own labs
        # above its subtopics, so the flattened `order` has to match or
        # next/prev navigation disagrees with the tree.
        for child in topic.children:
            emit(child, depth + 1)

    for topic in topics:
        emit(topic, 0)
    summary_path.write_text(
        "\n".join(lines).rstrip("\n") + "\n", encoding="utf-8"
    )


# ── AI-prompt helpers (shared by labs / imports / ai routers) ───────


def _ground(query: str) -> tuple[str, list[Source]]:
    """When GitBook-MCP grounding is enabled in Settings, search the
    Pentaho docs and return (reference block, sources). Best-effort — a
    docs failure never blocks generation. `sources` lets the UI cite the
    docs the model was grounded in.

    Hand the block to `grounded_prompt` rather than appending it: it used
    to be documented as a prompt SUFFIX, and that framing is what put a
    page of documentation at the end of every prompt, where a model
    reasonably read it as part of the material to work on.
    """
    s = providers.load_settings()
    docs = s.get("docs") or {}
    if not docs.get("enabled") or not docs.get("url") or not query.strip():
        return "", []
    try:
        hits = mcp.search(docs["url"], query.strip()[:200], limit=5, timeout=15)
    except mcp.McpError:
        return "", []
    ctx = mcp.as_context(hits)
    sources = [Source(title=h["title"], url=h["url"]) for h in hits if h.get("url")]
    return (("\n\n" + ctx) if ctx else ""), sources


# The documentation is reference, not raw material. Saying so is half the
# fix; the other half is where it sits in the prompt.
GROUND_NOTE = (
    "The documentation above is REFERENCE ONLY. Use it to be accurate. Never "
    "copy it, its headings, its links or its wording into your answer."
)


def grounded_prompt(
    instructions: str,
    ground: str,
    content: str | None = None,
    label: str = "PASSAGE",
) -> str:
    """Assemble a prompt so reference material cannot be mistaken for the
    thing being worked on.

    Always: instructions, then the grounding, then the content fenced
    between markers - so the last thing the model reads is the text it was
    asked about, and the documentation is somewhere it cannot be confused
    for it.

    This exists because the naive order shipped twice. The AI review
    reported a Critical problem with the "Relevant Pentaho documentation"
    section of a lab that had no such section - it was reviewing the
    grounding block. That was fixed in review_lab by hand, and the same
    bug then wrote 4,000 characters of documentation links into a guide
    through Rewrite, because rewrite still appended. Two call sites, one
    mistake, so the assembly is one function and every site uses it.
    """
    parts = [instructions.rstrip()]
    if ground.strip():
        parts.append(ground.strip())
        parts.append(GROUND_NOTE)
    if content is not None:
        parts.append(f"---BEGIN {label}---\n{content}\n---END {label}---")
    return "\n\n".join(parts)


def _clean_generated(text: str) -> str:
    """Strip a whole-document ```markdown fence some models wrap output in."""
    t = text.strip()
    t = re.sub(r"^```(?:markdown|md)?\s*\n", "", t)
    t = re.sub(r"\n```\s*$", "", t)
    return t.strip() + "\n"


def _lab_prompt(title: str, outline: str | None, kind: str) -> str:
    outline_block = (
        f"\nCover these points, in order:\n{outline.strip()}\n" if outline and outline.strip() else ""
    )
    page_note = (
        "This is a reference PAGE, so headings organise content but are not hands-on steps."
        if kind == "page"
        else "Each `## ` heading is a hands-on step the learner ticks off."
    )
    return f"""Write a complete lab guide in GitHub-flavored Markdown for a lab titled "{title}".
{outline_block}
Follow these conventions exactly:
- The VERY FIRST line must be `# {title}` (a single H1) — nothing before it.
- Then a `> **Note:**` callout stating what the learner will accomplish.
- {page_note}
- Put any commands or code in fenced code blocks with a language tag.
- Use `> **Note:**` and `> **Warning:**` callouts where helpful.
- If steps differ by OS or tool, use a tab block: a line `::: tabs`, then
  `### Tab Title` sub-headings for each variant, closed by a line `:::`.
- Do NOT include image references or `![...]` markdown — the author adds
  screenshots afterward. Never invent image filenames.
- End with a `## Lab Files` section only if the lab uses downloadable files.

Output ONLY the Markdown body — no preamble, no commentary, and do NOT wrap
the whole thing in a code fence."""
