"""Course editor API — FastAPI backend for the visual course editor.

A thin, local read/write service over the repo's ``courses/`` folder so
the React editor (which reuses the app's own MarkdownBody renderer for a
true-WYSIWYG preview) can list, open, and save courses and labs without
the author touching JSON or the folder layout by hand.

Runs on the author's machine only — it is NOT shipped to the learner VMs
(those run the Tauri renderer). Start it with::

    cd editor/api
    pip install -r requirements.txt
    uvicorn app:app --reload --port 8000

Design notes
------------
* The metric helpers (``count_steps`` / ``detect_has_video`` /
  ``estimate_minutes``) mirror ``scripts/stamp-manifests.mjs`` and
  ``scripts/lib/course-authoring.mjs`` so a save keeps a lab's derived
  manifest fields in step with the CLI scaffolder.
* The ``/tree`` asset endpoint serves files relative to a course root so
  guide-relative refs (``../_assets/images/x.png``, ``files/y.png``)
  resolve in the preview exactly as they do in the packaged app.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

# ── Repo layout ─────────────────────────────────────────────────────
# app.py lives at <repo>/editor/api/app.py → repo root is three up.
REPO_ROOT = Path(__file__).resolve().parents[2]
COURSES_DIR = REPO_ROOT / "courses"

app = FastAPI(title="Pentaho Content Manager — Course Editor API")

# The Vite dev server (author frontend) runs on a different port, so
# allow cross-origin from localhost during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def _is_lab_dir(course_path: Path, name: str) -> bool:
    if name.startswith(".") or name.startswith("_"):
        return False
    d = course_path / name
    return d.is_dir() and (d / "manifest.json").exists()


def _lab_number(dir_name: str) -> int:
    m = re.match(r"^(\d+)", dir_name)
    return int(m.group(1)) if m else 0


# ── Response models ─────────────────────────────────────────────────


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


# ── Routes ──────────────────────────────────────────────────────────


@app.get("/api/courses")
def list_courses() -> list[dict[str, str]]:
    if not COURSES_DIR.exists():
        return []
    out: list[dict[str, str]] = []
    for child in sorted(COURSES_DIR.iterdir()):
        cj = child / "course.json"
        if child.is_dir() and cj.exists():
            try:
                meta = _read_json(cj)
            except ValueError:
                meta = {}
            out.append({"id": child.name, "title": meta.get("title", child.name)})
    return out


@app.get("/api/courses/{course}")
def get_course(course: str) -> dict[str, Any]:
    return _read_json(_course_dir(course) / "course.json")


@app.get("/api/courses/{course}/labs", response_model=list[LabSummary])
def list_labs(course: str) -> list[LabSummary]:
    course_path = _course_dir(course)
    labs: list[LabSummary] = []
    for name in course_path.iterdir():
        if not _is_lab_dir(course_path, name.name):
            continue
        manifest = _read_json(name / "manifest.json")
        labs.append(
            LabSummary(
                slug=name.name,
                title=manifest.get("title", name.name),
                order=manifest.get("order", _lab_number(name.name)),
                kind="page" if manifest.get("kind") == "page" else "workshop",
            )
        )
    labs.sort(key=lambda x: x.order)
    return labs


@app.get("/api/courses/{course}/labs/{lab}", response_model=LabDetail)
def get_lab(course: str, lab: str) -> LabDetail:
    lab_dir = _course_dir(course) / lab
    guide = lab_dir / "guide.md"
    manifest = lab_dir / "manifest.json"
    if not guide.exists() or not manifest.exists():
        raise HTTPException(404, f"Lab not found: {lab}")
    return LabDetail(
        slug=lab,
        body=guide.read_text(encoding="utf-8"),
        manifest=_read_json(manifest),
    )


@app.put("/api/courses/{course}/labs/{lab}", response_model=LabDetail)
def save_lab(course: str, lab: str, req: SaveLabRequest) -> LabDetail:
    lab_dir = _course_dir(course) / lab
    guide = lab_dir / "guide.md"
    manifest_path = lab_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, f"Lab not found: {lab}")

    # Write the body.
    guide.write_text(req.body, encoding="utf-8")

    # Merge author-editable manifest fields, then always recompute the
    # derived metrics from the new body.
    manifest = _read_json(manifest_path)
    if req.manifest:
        for key in ("title", "description", "kind"):
            if key in req.manifest:
                manifest[key] = req.manifest[key]

    step_count = count_steps(req.body)
    manifest["stepCount"] = step_count
    manifest["hasVideo"] = detect_has_video(req.body)
    manifest["estimatedMinutes"] = estimate_minutes(step_count)
    _write_json(manifest_path, manifest)

    return LabDetail(slug=lab, body=req.body, manifest=manifest)


@app.get("/api/courses/{course}/tree/{path:path}")
def get_asset(course: str, path: str) -> FileResponse:
    """Serve any file under a course root (images, lab files) so the
    preview can resolve guide-relative asset refs."""
    course_path = _course_dir(course)
    target = (course_path / path).resolve()
    # Confine to the course directory.
    if course_path.resolve() not in target.parents and target != course_path.resolve():
        raise HTTPException(403, "Path escapes course directory")
    if not target.is_file():
        raise HTTPException(404, f"Asset not found: {path}")
    return FileResponse(target)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "coursesDir": str(COURSES_DIR), "exists": COURSES_DIR.exists()}
