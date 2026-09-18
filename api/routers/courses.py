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
    # `contact` is editable: without it the Contact Us block could only be
    # hand-edited, and a dialog that showed the fields would silently drop
    # them on save.
    for key in ("title", "description", "version", "theme", "launchers",
                "assistant", "mode", "welcome", "contact"):
        if key in body:
            cj[key] = body[key]
    # An emptied welcome/contact block (or null) removes the key rather
    # than leaving "welcome": {} behind in course.json.
    for key in ("welcome", "contact"):
        if key in body and not body[key]:
            cj.pop(key, None)
    if isinstance(cj.get("title"), str):
        cj["title"] = cj["title"].strip()
    if not cj.get("title"):
        raise HTTPException(400, "Course title can't be empty")
    _write_json(cj_path, cj)
    return cj


# Settings the exam dialog owns. `questions` is deliberately absent:
# the dialog never sends it, and a PUT that carried a partial body
# would otherwise wipe the question pool.
_EXAM_SETTINGS = (
    "title", "description", "passMark", "questionsPerAttempt", "shuffle",
    "webhookUrl", "webhookSecret", "intake",
)


@router.get("/api/courses/{course}/exam")
def get_exam(course: str) -> dict[str, Any]:
    """Exam settings plus the question count. The questions themselves
    stay out of the payload — the dialog edits delivery and grading,
    and a 50-question pool is a lot of JSON to ship for nothing."""
    path = _course_dir(course) / "exam.json"
    if not path.exists():
        return {"exists": False, "questionCount": 0}
    exam = _read_json(path)
    out: dict[str, Any] = {k: exam[k] for k in _EXAM_SETTINGS if k in exam}
    out["exists"] = True
    questions = exam.get("questions")
    out["questionCount"] = len(questions) if isinstance(questions, list) else 0
    return out


@router.put("/api/courses/{course}/exam")
def put_exam(course: str, body: dict[str, Any]) -> dict[str, Any]:
    """Update exam settings in place, preserving `questions` and any key
    this editor doesn't know about."""
    course_path = _course_dir(course)
    path = course_path / "exam.json"
    if not path.exists():
        raise HTTPException(404, f"{course} has no exam.json")
    exam = _read_json(path)

    pass_mark = body.get("passMark", exam.get("passMark"))
    if pass_mark is not None and not (isinstance(pass_mark, int) and 0 <= pass_mark <= 100):
        raise HTTPException(400, "passMark must be a whole number between 0 and 100")
    per_attempt = body.get("questionsPerAttempt", exam.get("questionsPerAttempt"))
    pool = exam.get("questions")
    if (
        isinstance(per_attempt, int)
        and isinstance(pool, list)
        and per_attempt > len(pool)
    ):
        # The learner app draws `questionsPerAttempt` from the pool; asking
        # for more than exist is an exam that cannot be sat.
        raise HTTPException(
            400,
            f"questionsPerAttempt ({per_attempt}) is more than the "
            f"{len(pool)} questions in the pool",
        )
    url = body.get("webhookUrl")
    if isinstance(url, str) and url.strip() and not url.strip().startswith("https://"):
        # Results carry candidate details, and the outbox retries — an
        # http:// endpoint would resend them in clear on every attempt.
        raise HTTPException(400, "webhookUrl must be an https:// URL")

    for key in _EXAM_SETTINGS:
        if key in body:
            exam[key] = body[key]
    for key in ("intake",):
        if key in body and not body[key]:
            exam.pop(key, None)
    _write_json(path, exam)
    return get_exam(course)


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
