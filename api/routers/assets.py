"""Asset serving + uploads: the course asset tree (so the preview can
resolve guide-relative refs), image uploads into ``_assets/images/``, and
per-lab ``files/`` uploads for launch/graph buttons."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from core import _course_dir, _safe_name, _unique, _IMAGE_EXTS, _MAX_UPLOAD

router = APIRouter()


@router.get("/api/courses/{course}/tree/{path:path}")
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


@router.post("/api/courses/{course}/assets")
async def upload_asset(course: str, file: UploadFile = File(...)) -> dict[str, str]:
    """Save an uploaded image into the course's shared _assets/images/ and
    return the guide-relative path to reference it."""
    course_path = _course_dir(course)
    data = await file.read()
    if len(data) > _MAX_UPLOAD:
        raise HTTPException(413, "Image too large (max 20 MB).")
    name = _safe_name(file.filename or "image.png", "image.png")
    if Path(name).suffix.lower() not in _IMAGE_EXTS:
        name += ".png"
    images = course_path / "_assets" / "images"
    images.mkdir(parents=True, exist_ok=True)
    target = _unique(images, name)
    target.write_bytes(data)
    return {"name": target.name, "path": f"../_assets/images/{target.name}"}


@router.get("/api/courses/{course}/labs/{lab}/files")
def list_lab_files(course: str, lab: str) -> list[str]:
    files_dir = _course_dir(course) / lab / "files"
    if not files_dir.is_dir():
        return []
    return sorted(f.name for f in files_dir.iterdir() if f.is_file())


@router.post("/api/courses/{course}/labs/{lab}/files")
async def upload_lab_file(course: str, lab: str, file: UploadFile = File(...)) -> dict[str, str]:
    """Save an uploaded file into a lab's files/ folder (for launch/graph
    buttons) and return its lab-relative path."""
    lab_dir = _course_dir(course) / lab
    if not (lab_dir / "manifest.json").exists():
        raise HTTPException(404, f"Lab not found: {lab}")
    data = await file.read()
    if len(data) > _MAX_UPLOAD:
        raise HTTPException(413, "File too large (max 20 MB).")
    name = _safe_name(file.filename or "file", "file")
    files_dir = lab_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    target = _unique(files_dir, name)
    target.write_bytes(data)
    return {"name": target.name, "path": f"files/{target.name}"}
