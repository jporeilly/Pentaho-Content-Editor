"""Labs and the SUMMARY.md structure tree: list/read/save a lab, reorder
(structure GET/PUT), create a lab via the scaffolder, and AI-draft a lab."""

from __future__ import annotations

import re
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import core
import tools
import providers
from core import (
    _course_dir, _read_json, _write_json, _run_node,
    _is_lab_dir, _lab_number, _parse_structure, _write_structure,
    _ground, _clean_generated, _lab_prompt, stamp_metrics, body_hash,
    LabSummary, LabDetail, SaveLabRequest, Source,
    Structure, walk_labs, prune_lab,
)

router = APIRouter()


@router.get("/api/courses/{course}/labs", response_model=list[LabSummary])
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


@router.get("/api/courses/{course}/labs/{lab}", response_model=LabDetail)
def get_lab(course: str, lab: str) -> LabDetail:
    lab_dir = _course_dir(course) / lab
    guide = lab_dir / "guide.md"
    manifest = lab_dir / "manifest.json"
    if not guide.exists() or not manifest.exists():
        raise HTTPException(404, f"Lab not found: {lab}")
    body = guide.read_text(encoding="utf-8")
    return LabDetail(
        slug=lab,
        body=body,
        manifest=_read_json(manifest),
        bodyHash=body_hash(body),
    )


@router.put("/api/courses/{course}/labs/{lab}", response_model=LabDetail)
def save_lab(course: str, lab: str, req: SaveLabRequest) -> LabDetail:
    lab_dir = _course_dir(course) / lab
    guide = lab_dir / "guide.md"
    manifest_path = lab_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(404, f"Lab not found: {lab}")
    if req.manifest and "estimatedMinutes" in req.manifest:
        minutes = req.manifest["estimatedMinutes"]
        if minutes is not None and not (isinstance(minutes, int) and not isinstance(minutes, bool) and 1 <= minutes <= 600):
            raise HTTPException(400, "estimatedMinutes must be a whole number of minutes (1-600), or null for automatic")

    # Write the body — unless this is a manifest-only save (body None),
    # which leaves the guide on disk exactly as it is.
    current = guide.read_text(encoding="utf-8") if guide.exists() else ""
    if req.body is None:
        body = current
    else:
        if (req.baseHash and not req.force
                and body_hash(current) != req.baseHash and req.body != current):
            raise HTTPException(409, (
                "This lab changed on disk since it was opened - another editor "
                "tab or an external edit saved it. Reload to see the newer text, "
                "or save again to overwrite it."
            ))
        guide.write_text(req.body, encoding="utf-8")
        body = req.body

    # Merge author-editable manifest fields, then always recompute the
    # derived metrics from the new body.
    manifest = _read_json(manifest_path)
    if req.manifest:
        for key in ("title", "description", "kind", "noProgress"):
            if key in req.manifest:
                manifest[key] = req.manifest[key]
        # Dropping the flag entirely (noProgress: null) removes it.
        if req.manifest.get("noProgress", True) is None:
            manifest.pop("noProgress", None)
        # Timing: an integer is the author's estimate and stamp_metrics
        # leaves it alone from then on; null drops it so the estimate is
        # recomputed from the step count.
        if "estimatedMinutes" in req.manifest:
            if req.manifest["estimatedMinutes"] is None:
                manifest.pop("estimatedMinutes", None)
            else:
                manifest["estimatedMinutes"] = req.manifest["estimatedMinutes"]
    stamp_metrics(manifest, body)
    _write_json(manifest_path, manifest)

    return LabDetail(slug=lab, body=body, manifest=manifest, bodyHash=body_hash(body))


# ── Structure (sidebar tree) ────────────────────────────────────────


class NewLabRequest(BaseModel):
    title: str
    topic: str
    kind: str = "workshop"


@router.get("/api/courses/{course}/structure", response_model=Structure)
def get_structure(course: str) -> Structure:
    return Structure(topics=_parse_structure(_course_dir(course)))


@router.put("/api/courses/{course}/structure", response_model=Structure)
def put_structure(course: str, body: Structure) -> Structure:
    course_path = _course_dir(course)
    # Guard: every referenced lab must exist on disk — walked over the
    # whole tree, so a lab nested under a sub-topic is checked too.
    for lab in walk_labs(body.topics):
        if not (course_path / lab.slug / "manifest.json").exists():
            raise HTTPException(400, f"Unknown lab: {lab.slug}")
    _write_structure(course_path, body.topics)
    return Structure(topics=_parse_structure(course_path))


@router.post("/api/courses/{course}/labs", response_model=Structure)
def create_lab(course: str, req: NewLabRequest) -> Structure:
    """Create a lab by delegating to the Node scaffolder (single source
    of truth for lab creation + SUMMARY wiring), then return the updated
    structure."""
    course_path = _course_dir(course)
    if not req.title.strip():
        raise HTTPException(400, "Lab title is required")
    try:
        node = tools.node()
        if not node:
            raise HTTPException(
                500,
                "Node.js was not found. New Lab runs the Content Manager's "
                "new-lab.mjs, so it needs Node - install it and restart the "
                "editor. Editing and saving do not.",
            )
        subprocess.run(
            [
                node, "scripts/new-lab.mjs",
                "--course", course,
                "--title", req.title,
                "--topic", req.topic or "Workshops",
                "--kind", "page" if req.kind == "page" else "workshop",
            ],
            cwd=str(core.REPO_ROOT),
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
    except FileNotFoundError:
        raise HTTPException(500, "`node` not found on PATH — needed to scaffold a lab")
    except subprocess.CalledProcessError as e:
        raise HTTPException(500, f"Scaffold failed: {e.stderr or e.stdout}")
    return Structure(topics=_parse_structure(course_path))


@router.delete("/api/courses/{course}/labs/{lab}", response_model=Structure)
def delete_lab(course: str, lab: str) -> Structure:
    """Permanently delete a lab or page: its folder AND its SUMMARY.md
    bullet. Doing only half is the failure mode this exists to prevent —
    authors previously had to do both by hand.

    Order matters. The learner app lists labs with ``readDir`` over the
    content root, so a folder left behind after the bullet is removed is
    still shown to learners: a silent failure. A bullet left behind
    after the folder is gone is caught by ``verify-course`` and by
    ``put_structure``'s own existence guard: loud and recoverable. So
    the folder goes first.
    """
    course_path = _course_dir(course)
    if not _is_lab_dir(course_path, lab):
        raise HTTPException(404, f"No such lab or page: {lab}")

    lab_path = course_path / lab
    try:
        shutil.rmtree(lab_path)
    except OSError as e:
        raise HTTPException(500, f"Couldn't delete {lab}: {e}")

    # Drop it from every topic. Rebuilt from SUMMARY.md, so a lab that
    # was never listed there simply leaves the file untouched.
    topics = _parse_structure(course_path)
    pruned = prune_lab(topics, lab)
    try:
        _write_structure(course_path, pruned)
    except OSError as e:
        raise HTTPException(
            500,
            f"Deleted {lab}, but couldn't rewrite SUMMARY.md ({e}). "
            f"Remove the '{lab}' bullet by hand or verify-course will flag it.",
        )
    return Structure(topics=_parse_structure(course_path))


# ── AI lab drafting ─────────────────────────────────────────────────


class GenerateLabRequest(BaseModel):
    title: str
    outline: str | None = None
    topic: str = "Workshops"
    kind: str = "workshop"


class GeneratedLab(BaseModel):
    slug: str
    structure: Structure
    sources: list[Source] = []


@router.post("/api/courses/{course}/generate-lab", response_model=GeneratedLab)
def generate_lab(course: str, req: GenerateLabRequest) -> GeneratedLab:
    """Draft a lab body with the local Ollama model, then create the lab
    (via the scaffolder) and write the draft into it. Generation runs
    FIRST so a failure never leaves an empty lab behind."""
    course_path = _course_dir(course)
    title = req.title.strip()
    if not title:
        raise HTTPException(400, "Lab title is required")
    kind = "page" if req.kind == "page" else "workshop"

    system = "You are a technical curriculum author for hands-on Pentaho workshops."
    ground, sources = _ground(f"{title}. {req.outline or ''}")
    prompt = core.grounded_prompt(_lab_prompt(title, req.outline, kind), ground)
    try:
        raw = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    body = _clean_generated(raw)
    if not body.strip():
        raise HTTPException(502, "The model returned an empty draft — try again.")

    out = _run_node(
        [
            "scripts/new-lab.mjs",
            "--course", course, "--title", title,
            "--topic", req.topic or "Workshops", "--kind", kind,
        ],
        "Lab scaffold",
    )
    m = re.search(r"Created lab: courses/[^/]+/([^/\s]+)/", out)
    if not m:
        raise HTTPException(500, "Couldn't determine the new lab's folder")
    slug = m.group(1)

    lab_dir = course_path / slug
    (lab_dir / "guide.md").write_text(body, encoding="utf-8")
    man = _read_json(lab_dir / "manifest.json")
    stamp_metrics(man, body)
    _write_json(lab_dir / "manifest.json", man)

    return GeneratedLab(
        slug=slug,
        structure=Structure(topics=_parse_structure(course_path)),
        sources=sources,
    )
