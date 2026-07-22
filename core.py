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

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel

import providers
import mcp

# ── Repo layout ─────────────────────────────────────────────────────
# core.py lives at <repo>/editor/api/core.py → repo root is three up.
REPO_ROOT = Path(__file__).resolve().parents[2]
COURSES_DIR = REPO_ROOT / "courses"


# ── Metric helpers (mirror stamp-manifests.mjs) ─────────────────────

_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)


def _strip_fences(body: str) -> str:
    return _FENCE_RE.sub("", body)


def count_steps(body: str) -> int:
    without_fences = _strip_fences(body)
    heading_count = len(re.findall(r"^#{2,3}\s+\S", without_fences, re.MULTILINE))
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
        r"!\[[^\]]*\]\([^)]+\.(?:mp4|webm|mov|m4v)(?:[#?][^)]*)?\)",
        r"<video[\s>]",
    ]
    return any(re.search(p, no_fences, re.IGNORECASE) for p in patterns)


def estimate_minutes(step_count: int) -> int:
    raw = 10 + step_count * 2
    clamped = min(60, max(5, raw))
    return round(clamped / 5) * 5


def stamp_metrics(manifest: dict[str, Any], body: str) -> dict[str, Any]:
    """Recompute the derived manifest fields from a guide body (never
    trusted from the client). Mutates and returns the manifest."""
    steps = count_steps(body)
    manifest["stepCount"] = steps
    manifest["hasVideo"] = detect_has_video(body)
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
    try:
        proc = subprocess.run(
            ["node", *args], cwd=str(REPO_ROOT),
            check=True, capture_output=True, text=True, encoding="utf-8", timeout=45,
        )
        return proc.stdout
    except FileNotFoundError:
        raise HTTPException(500, "`node` not found on PATH — needed to scaffold")
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


class SaveLabRequest(BaseModel):
    body: str
    # Optional metadata edits (title / description / kind). Derived
    # metrics are always recomputed server-side, never trusted from the
    # client.
    manifest: dict[str, Any] | None = None


class StructureLab(BaseModel):
    slug: str
    title: str
    kind: str = "workshop"


class StructureTopic(BaseModel):
    title: str
    labs: list[StructureLab]


class Structure(BaseModel):
    topics: list[StructureTopic]


# ── Structure (SUMMARY.md) parse / write ────────────────────────────

_SUMMARY_LINK = re.compile(r"^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*$")
_SUMMARY_H2 = re.compile(r"^##\s+(.+)$")


def _parse_structure(course_path: Path) -> list[StructureTopic]:
    """Parse SUMMARY.md into ordered topics, each with its labs (in
    SUMMARY order). Lab titles come from the manifest so a rename in one
    place stays authoritative."""
    summary = course_path / "SUMMARY.md"
    topics: list[StructureTopic] = []
    if not summary.exists():
        return topics
    current: StructureTopic | None = None
    for raw in summary.read_text(encoding="utf-8").splitlines():
        h2 = _SUMMARY_H2.match(raw)
        if h2:
            current = StructureTopic(title=h2.group(1).strip(), labs=[])
            topics.append(current)
            continue
        link = _SUMMARY_LINK.match(raw)
        if link and current is not None:
            slug = link.group(2).replace("\\", "/").lstrip("./").split("/")[0]
            man_path = course_path / slug / "manifest.json"
            if not man_path.exists():
                continue
            man = _read_json(man_path)
            current.labs.append(
                StructureLab(
                    slug=slug,
                    title=man.get("title", link.group(1).strip()),
                    kind="page" if man.get("kind") == "page" else "workshop",
                )
            )
    return topics


def _write_structure(course_path: Path, topics: list[StructureTopic]) -> None:
    """Rewrite SUMMARY.md from the given topic/lab order, and sync each
    lab's manifest `order` (flattened 1-based sequence) and `title`."""
    lines = ["# Table of contents", ""]
    seq = 0
    for topic in topics:
        lines.append(f"## {topic.title}")
        lines.append("")
        for lab in topic.labs:
            lines.append(f"* [{lab.title}]({lab.slug}/guide.md)")
            seq += 1
            man_path = course_path / lab.slug / "manifest.json"
            if man_path.exists():
                man = _read_json(man_path)
                man["order"] = seq
                man["title"] = lab.title
                _write_json(man_path, man)
        lines.append("")
    (course_path / "SUMMARY.md").write_text(
        "\n".join(lines).rstrip("\n") + "\n", encoding="utf-8"
    )


# ── AI-prompt helpers (shared by labs / imports / ai routers) ───────


def _ground(query: str) -> tuple[str, list[Source]]:
    """When GitBook-MCP grounding is enabled in Settings, search the
    Pentaho docs and return (prompt-suffix, sources). Best-effort — a docs
    failure never blocks generation. `sources` lets the UI cite the docs
    the model was grounded in."""
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
