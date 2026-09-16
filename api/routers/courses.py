"""Course-level CRUD: list / create / read / update / delete course.json,
and the course verifier. Lab and structure endpoints live in ``labs``."""

from __future__ import annotations

import shutil
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import core
import tools
from core import _course_dir, _read_json, _write_json, _run_node, _slugify

router = APIRouter()


@router.get("/api/courses")
def list_courses() -> list[dict[str, str]]:
    if not core.COURSES_DIR.exists():
        return []
    out: list[dict[str, str]] = []
    for child in sorted(core.COURSES_DIR.iterdir()):
        cj = child / "course.json"
        if child.is_dir() and cj.exists():
            try:
                meta = _read_json(cj)
            except ValueError:
                meta = {}
            out.append({"id": child.name, "title": meta.get("title", child.name)})
    return out


class NewCourseRequest(BaseModel):
    title: str
    kind: str = "workshop"
    accent: str | None = None


@router.post("/api/courses")
def create_course(req: NewCourseRequest) -> dict[str, str]:
    """Scaffold a new course (course.json + SUMMARY.md + a starter lab
    from the blank template) by delegating to the Node scaffolder."""
    title = req.title.strip()
    if not title:
        raise HTTPException(400, "Course title is required")
    slug = _slugify(title)
    if (core.COURSES_DIR / slug).exists():
        raise HTTPException(409, f"A course '{slug}' already exists")
    args = [
        "scripts/new-course.mjs",
        "--title", title,
        "--kind", "academy" if req.kind == "academy" else "workshop",
        "--lab-title", "Before You Start",
        "--topic", "Before You Start",
    ]
    if req.accent:
        args += ["--accent", req.accent]
    _run_node(args, "Course scaffold")
    if not (core.COURSES_DIR / slug / "course.json").exists():
        raise HTTPException(500, "Course scaffold produced no course.json")
    meta = _read_json(core.COURSES_DIR / slug / "course.json")
    return {"id": slug, "title": meta.get("title", title)}


@router.get("/api/courses/{course}")
def get_course(course: str) -> dict[str, Any]:
    return _read_json(_course_dir(course) / "course.json")


class DeleteCourseRequest(BaseModel):
    confirm: str = ""


@router.delete("/api/courses/{course}")
def delete_course(course: str, body: DeleteCourseRequest) -> dict[str, Any]:
    """Permanently delete a course's authoring folder (courses/<slug>/).

    Destructive and unrecoverable for anything not in git, so the
    client must send the literal confirmation phrase ``delete`` — the
    UI makes the author type it. Only touches the authoring tree: an
    installed copy in the app's content dir / store, and anything
    already published to the distribution repo, are left alone.
    """
    course_path = _course_dir(course)  # 404 if unknown (and traversal-safe)
    if body.confirm.strip().lower() != "delete":
        raise HTTPException(428, 'Type "delete" to confirm — this permanently removes the course folder.')
    try:
        shutil.rmtree(course_path)
    except OSError as e:
        raise HTTPException(500, f"Couldn't delete the course folder: {e}")
    return {"ok": True, "id": course}


@router.put("/api/courses/{course}")
def put_course(course: str, body: dict[str, Any]) -> dict[str, Any]:
    """Update the course.json — the editable metadata fields only; id and
    structural fields are preserved."""
    course_path = _course_dir(course)
    cj_path = course_path / "course.json"
    cj = _read_json(cj_path)
    if "mode" in body and body["mode"] not in ("free", "sequential"):
        raise HTTPException(400, "mode must be 'free' or 'sequential'")
    for key in ("title", "description", "version", "theme", "launchers", "assistant", "mode", "welcome"):
        if key in body:
            cj[key] = body[key]
    # An emptied welcome block (or null) removes the key rather than
    # leaving "welcome": {} behind in course.json.
    if "welcome" in body and not body["welcome"]:
        cj.pop("welcome", None)
    if isinstance(cj.get("title"), str):
        cj["title"] = cj["title"].strip()
    if not cj.get("title"):
        raise HTTPException(400, "Course title can't be empty")
    _write_json(cj_path, cj)
    return cj


@router.post("/api/courses/{course}/verify")
def verify_course(course: str) -> dict[str, Any]:
    """Run the course verifier and return its report."""
    _course_dir(course)  # 404 if unknown
    # Through the resolver, not a bare "node": a bundled copy must win,
    # and a machine without Node needs the message naming which features
    # that costs rather than a FileNotFoundError.
    node = tools.node()
    if not node:
        raise HTTPException(
            500,
            "Node.js was not found. Verify runs the Content Manager's "
            "verify-course.mjs, so it needs Node - install it and restart "
            "the editor. Editing and saving do not.",
        )
    proc = subprocess.run(
        [node, "scripts/verify-course.mjs", course],
        cwd=str(core.REPO_ROOT), capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    return {"ok": proc.returncode == 0, "output": (proc.stdout + proc.stderr).strip()}
