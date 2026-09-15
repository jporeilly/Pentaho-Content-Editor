"""Deploy a course off the author's machine: stream a portable .zip, or
run the install-course script locally to preview it in the real app."""

from __future__ import annotations

import io
import subprocess
import sys
import zipfile
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import core
from core import _course_dir

router = APIRouter()


@router.get("/api/courses/{course}/export")
def export_course(course: str):
    """Stream a .zip of the course folder — hand it to install-course or a
    VM provisioning step."""
    course_path = _course_dir(course)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in course_path.rglob("*"):
            if path.is_file() and ".venv" not in path.parts and "__pycache__" not in path.parts:
                zf.write(path, path.relative_to(course_path.parent).as_posix())
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{course}.zip"'},
    )


@router.post("/api/courses/{course}/install")
def install_course(course: str) -> dict[str, Any]:
    """Run the install-course script locally so the course lands in this
    machine's app content dir (to preview it in the real app)."""
    _course_dir(course)  # 404 if unknown
    if sys.platform.startswith("win"):
        cmd = [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", "scripts/install-course.ps1", "-CourseId", course, "-Force",
        ]
    else:
        cmd = ["bash", "scripts/install-course.sh", "--course-id", course, "--force"]
    try:
        proc = subprocess.run(
            cmd, cwd=str(core.REPO_ROOT), capture_output=True, text=True,
            encoding="utf-8", timeout=120,
        )
    except FileNotFoundError as e:
        raise HTTPException(500, f"Couldn't run the installer: {e}")
    ok = proc.returncode == 0
    return {"ok": ok, "output": (proc.stdout + proc.stderr).strip()[-4000:]}
