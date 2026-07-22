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
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import providers
import extract

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


def _slugify(text: str) -> str:
    """URL-safe slug — mirrors slugify() in the Node scaffolder so the
    course dir the scaffolder creates is predictable."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]
    return s or "course"


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


class NewCourseRequest(BaseModel):
    title: str
    kind: str = "workshop"
    accent: str | None = None


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


@app.post("/api/courses")
def create_course(req: NewCourseRequest) -> dict[str, str]:
    """Scaffold a new course (course.json + SUMMARY.md + a starter lab
    from the blank template) by delegating to the Node scaffolder."""
    title = req.title.strip()
    if not title:
        raise HTTPException(400, "Course title is required")
    slug = _slugify(title)
    if (COURSES_DIR / slug).exists():
        raise HTTPException(409, f"A course '{slug}' already exists")
    args = [
        "scripts/new-course.mjs",
        "--title", title,
        "--kind", "academy" if req.kind == "academy" else "workshop",
        "--lab-title", "Getting Started",
        "--topic", "Getting Started",
    ]
    if req.accent:
        args += ["--accent", req.accent]
    _run_node(args, "Course scaffold")
    if not (COURSES_DIR / slug / "course.json").exists():
        raise HTTPException(500, "Course scaffold produced no course.json")
    meta = _read_json(COURSES_DIR / slug / "course.json")
    return {"id": slug, "title": meta.get("title", title)}


@app.get("/api/courses/{course}")
def get_course(course: str) -> dict[str, Any]:
    return _read_json(_course_dir(course) / "course.json")


@app.post("/api/courses/{course}/verify")
def verify_course(course: str) -> dict[str, Any]:
    """Run the course verifier and return its report."""
    _course_dir(course)  # 404 if unknown
    proc = subprocess.run(
        ["node", "scripts/verify-course.mjs", course],
        cwd=str(REPO_ROOT), capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    return {"ok": proc.returncode == 0, "output": (proc.stdout + proc.stderr).strip()}


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


# ── Structure (sidebar tree) ────────────────────────────────────────


class StructureLab(BaseModel):
    slug: str
    title: str
    kind: str = "workshop"


class StructureTopic(BaseModel):
    title: str
    labs: list[StructureLab]


class Structure(BaseModel):
    topics: list[StructureTopic]


class NewLabRequest(BaseModel):
    title: str
    topic: str
    kind: str = "workshop"


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


@app.get("/api/courses/{course}/structure", response_model=Structure)
def get_structure(course: str) -> Structure:
    return Structure(topics=_parse_structure(_course_dir(course)))


@app.put("/api/courses/{course}/structure", response_model=Structure)
def put_structure(course: str, body: Structure) -> Structure:
    course_path = _course_dir(course)
    # Guard: every referenced lab must exist on disk.
    for topic in body.topics:
        for lab in topic.labs:
            if not (course_path / lab.slug / "manifest.json").exists():
                raise HTTPException(400, f"Unknown lab: {lab.slug}")
    _write_structure(course_path, body.topics)
    return Structure(topics=_parse_structure(course_path))


@app.post("/api/courses/{course}/labs", response_model=Structure)
def create_lab(course: str, req: NewLabRequest) -> Structure:
    """Create a lab by delegating to the Node scaffolder (single source
    of truth for lab creation + SUMMARY wiring), then return the updated
    structure."""
    course_path = _course_dir(course)
    if not req.title.strip():
        raise HTTPException(400, "Lab title is required")
    try:
        subprocess.run(
            [
                "node", "scripts/new-lab.mjs",
                "--course", course,
                "--title", req.title,
                "--topic", req.topic or "Workshops",
                "--kind", "page" if req.kind == "page" else "workshop",
            ],
            cwd=str(REPO_ROOT),
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


# ── LLM authoring assist (Ollama / Anthropic / OpenAI) ──────────────


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


class GenerateLabRequest(BaseModel):
    title: str
    outline: str | None = None
    topic: str = "Workshops"
    kind: str = "workshop"


class GeneratedLab(BaseModel):
    slug: str
    structure: Structure


@app.post("/api/courses/{course}/generate-lab", response_model=GeneratedLab)
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
    try:
        raw = providers.generate(_lab_prompt(title, req.outline, kind), system)
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
    steps = count_steps(body)
    man["stepCount"] = steps
    man["hasVideo"] = detect_has_video(body)
    man["estimatedMinutes"] = estimate_minutes(steps)
    _write_json(lab_dir / "manifest.json", man)

    return GeneratedLab(slug=slug, structure=Structure(topics=_parse_structure(course_path)))


# ── Settings (LLM provider config) ──────────────────────────────────


class SettingsPatch(BaseModel):
    provider: str | None = None
    ollama: dict[str, Any] | None = None
    anthropic: dict[str, Any] | None = None
    openai: dict[str, Any] | None = None


def _settings_view(settings: dict[str, Any]) -> dict[str, Any]:
    """Settings plus non-secret runtime facts the UI needs: which keys are
    detected (bool only), the Ollama model list, and whether a GPU was
    detected in the OS environment."""
    return {
        **settings,
        "keys": providers.key_status(),
        "ollamaModels": providers.ollama_models(settings["ollama"]["url"]),
        "gpu": providers.detect_gpu(),
    }


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return _settings_view(providers.load_settings())


@app.put("/api/settings")
def put_settings(patch: SettingsPatch) -> dict[str, Any]:
    try:
        saved = providers.save_settings(patch.model_dump(exclude_none=True))
    except providers.ProviderError as e:
        raise HTTPException(400, str(e))
    return _settings_view(saved)


@app.get("/api/providers/health")
def providers_health() -> dict[str, Any]:
    """Connection status for the ACTIVE provider — drives the header
    indicator and enables/disables the AI button."""
    return providers.health()


@app.get("/api/providers/suggest")
def suggest_model(profile: str = "auto") -> dict[str, Any]:
    """Recommend an installed Ollama model for the CPU/GPU profile
    ('auto' detects from the OS environment)."""
    s = providers.load_settings()
    return providers.suggest_model(profile, s["ollama"]["url"])


# Back-compat alias for the earlier Ollama-only endpoint.
class RewriteRequest(BaseModel):
    text: str
    instruction: str | None = None


@app.post("/api/rewrite")
def rewrite(req: RewriteRequest) -> dict[str, str]:
    """Rewrite a selected passage of a lab guide with the active LLM,
    preserving Markdown structure."""
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Nothing to rewrite — select some text first.")
    system = "You are an expert technical editor for hands-on Pentaho workshop guides."
    instr = req.instruction or (
        "Improve clarity and flow and fix any grammar, keeping the same meaning."
    )
    prompt = (
        f"Rewrite the passage below. {instr} Preserve all Markdown structure "
        "(headings, `> **Note:**`-style callouts, fenced code blocks, lists, "
        "links, and `::: tabs` blocks). Output ONLY the rewritten passage — no "
        f"preamble, no code fence around the whole thing.\n\n---\n{text}"
    )
    try:
        out = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return {"text": _clean_generated(out).rstrip("\n")}


@app.get("/api/ollama/health")
def ollama_health() -> dict[str, Any]:
    h = providers.health()
    return {"ok": h["ok"], "models": h.get("models", []), "error": None if h["ok"] else h.get("detail")}


# ── Import: build a course from a document ──────────────────────────
#
# Two steps (outline-first): POST /api/import/outline extracts the text
# and asks the LLM for a proposed course structure; the author reviews it;
# POST /api/import/build scaffolds the course and generates each lab from
# the outline + the source excerpt.

# Extracted source text kept per import id so the browser doesn't
# round-trip the full document between the two calls. In-memory is fine
# for a single-process author-side dev server.
_IMPORTS: dict[str, str] = {}
# Cap the source context handed to the model so a huge doc doesn't blow
# past a local model's context window.
_MAX_CONTEXT_CHARS = 12000


def _extract_json(text: str) -> Any:
    """Pull the first JSON object out of an LLM response (tolerates
    ```json fences and surrounding prose)."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    start = t.find("{")
    if start == -1:
        raise HTTPException(502, "The model didn't return a course outline.")
    depth = 0
    for i in range(start, len(t)):
        if t[i] == "{":
            depth += 1
        elif t[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(t[start:i + 1])
                except ValueError:
                    break
    raise HTTPException(502, "Couldn't parse the course outline the model returned.")


class OutlineLab(BaseModel):
    title: str
    summary: str = ""


class OutlineTopic(BaseModel):
    title: str
    labs: list[OutlineLab]


class Outline(BaseModel):
    courseTitle: str
    topics: list[OutlineTopic]


class ImportOutlineResponse(BaseModel):
    importId: str
    chars: int
    outline: Outline


@app.post("/api/import/outline", response_model=ImportOutlineResponse)
async def import_outline(file: UploadFile = File(...)) -> ImportOutlineResponse:
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 25 MB).")
    try:
        text = extract.extract_text(file.filename or "", data)
    except extract.ExtractError as e:
        raise HTTPException(400, str(e))

    prompt = f"""From the source document below, design a hands-on Pentaho
workshop course. Propose a clear course title, 1-4 topics, and 3-8 labs
total distributed across the topics. Each lab needs a short imperative
title and a one-sentence summary of what the learner will do.

Return ONLY minified JSON of this exact shape, no prose, no code fence:
{{"courseTitle": "...", "topics": [{{"title": "...", "labs": [{{"title": "...", "summary": "..."}}]}}]}}

SOURCE DOCUMENT (may be truncated):
{text[:_MAX_CONTEXT_CHARS]}"""
    system = "You are a curriculum architect. You output only valid JSON when asked."
    try:
        raw = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    outline = Outline(**_extract_json(raw))

    # Stamp an id from the content length + title so it's deterministic
    # (Date/random are unavailable in the Node side; here we just need
    # uniqueness within a session).
    import_id = f"imp{abs(hash((file.filename, len(text)))) % 10_000_000:07d}"
    _IMPORTS[import_id] = text
    return ImportOutlineResponse(importId=import_id, chars=len(text), outline=outline)


class ImportBuildRequest(BaseModel):
    importId: str
    kind: str = "workshop"
    outline: Outline


class ImportBuildResponse(BaseModel):
    courseId: str
    labCount: int


@app.post("/api/import/build", response_model=ImportBuildResponse)
def import_build(req: ImportBuildRequest) -> ImportBuildResponse:
    source = _IMPORTS.get(req.importId, "")
    kind = "academy" if req.kind == "academy" else "workshop"
    lab_kind = "page" if kind == "academy" else "workshop"

    # 1. Scaffold the course shell (no starter lab — the outline drives labs).
    out = _run_node(
        [
            "scripts/new-course.mjs",
            "--title", req.outline.courseTitle,
            "--kind", kind, "--no-lab",
        ],
        "Course scaffold",
    )
    m = re.search(r"Created course: courses/([^/\s]+)/", out)
    if not m:
        raise HTTPException(500, "Couldn't determine the new course's folder")
    course = m.group(1)
    course_path = COURSES_DIR / course

    # 2. For each lab: scaffold it, then generate its body from the outline
    #    + source excerpt.
    system = "You are a technical curriculum author for hands-on Pentaho workshops."
    context = source[:_MAX_CONTEXT_CHARS]
    count = 0
    for topic in req.outline.topics:
        for lab in topic.labs:
            title = lab.title.strip()
            if not title:
                continue
            outline_note = lab.summary.strip()
            body_prompt = _lab_prompt(
                title,
                (f"Focus: {outline_note}\n" if outline_note else None),
                lab_kind,
            )
            if context:
                body_prompt += (
                    "\n\nGround the lab in this source material where relevant "
                    f"(do not invent facts that contradict it):\n{context}"
                )
            try:
                body = _clean_generated(providers.generate(body_prompt, system))
            except providers.ProviderError as e:
                raise HTTPException(502, f"Lab '{title}': {e}")

            scaffold = _run_node(
                [
                    "scripts/new-lab.mjs",
                    "--course", course, "--title", title,
                    "--topic", topic.title or "Workshops", "--kind", lab_kind,
                ],
                "Lab scaffold",
            )
            lm = re.search(r"Created lab: courses/[^/]+/([^/\s]+)/", scaffold)
            if not lm:
                continue
            lab_dir = course_path / lm.group(1)
            (lab_dir / "guide.md").write_text(body, encoding="utf-8")
            man = _read_json(lab_dir / "manifest.json")
            steps = count_steps(body)
            man["stepCount"] = steps
            man["hasVideo"] = detect_has_video(body)
            man["estimatedMinutes"] = estimate_minutes(steps)
            _write_json(lab_dir / "manifest.json", man)
            count += 1

    _IMPORTS.pop(req.importId, None)
    return ImportBuildResponse(courseId=course, labCount=count)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "coursesDir": str(COURSES_DIR), "exists": COURSES_DIR.exists()}
