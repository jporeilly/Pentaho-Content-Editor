"""Build a course from an uploaded document (outline-first).

POST /api/import/outline extracts the text and asks the LLM for a proposed
course structure; the author reviews it; POST /api/import/build scaffolds
the course and generates each lab from the outline + the source excerpt.
"""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

import core
import providers
import extract
from core import (
    _read_json, _write_json, _run_node,
    _ground, _clean_generated, _lab_prompt, stamp_metrics, Source,
)

router = APIRouter()

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


@router.post("/api/import/outline", response_model=ImportOutlineResponse)
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
    sources: list[Source] = []


@router.post("/api/import/build", response_model=ImportBuildResponse)
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
    course_path = core.COURSES_DIR / course

    # 2. For each lab: scaffold it, then generate its body from the outline
    #    + source excerpt.
    system = "You are a technical curriculum author for hands-on Pentaho workshops."
    context = source[:_MAX_CONTEXT_CHARS]
    count = 0
    all_sources: dict[str, Source] = {}  # unique by url
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
            ground, srcs = _ground(f"{title}. {outline_note}")
            body_prompt += ground
            for s in srcs:
                all_sources[s.url] = s
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
            stamp_metrics(man, body)
            _write_json(lab_dir / "manifest.json", man)
            count += 1

    _IMPORTS.pop(req.importId, None)
    return ImportBuildResponse(courseId=course, labCount=count, sources=list(all_sources.values()))
