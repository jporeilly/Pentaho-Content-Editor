"""AI over the configured LLM: rewrite a passage, review a lab, and the
multi-turn assistant chat. All three optionally ground in the Pentaho docs
and return the sources they drew on."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import providers
from core import _ground, _clean_generated, grounded_prompt, Source

router = APIRouter()


class RewriteRequest(BaseModel):
    text: str
    instruction: str | None = None


class RewriteResponse(BaseModel):
    text: str
    sources: list[Source] = []


@router.post("/api/rewrite", response_model=RewriteResponse)
def rewrite(req: RewriteRequest) -> RewriteResponse:
    """Rewrite a selected passage of a lab guide with the active LLM,
    preserving Markdown structure."""
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Nothing to rewrite — select some text first.")
    system = "You are an expert technical editor for hands-on Pentaho workshop guides."
    instr = req.instruction or (
        "Improve clarity and flow and fix any grammar, keeping the same meaning."
    )
    ground, sources = _ground(text)
    prompt = grounded_prompt(
        f"Rewrite the passage below. {instr} Preserve all Markdown structure "
        "(headings, `> **Note:**`-style callouts, fenced code blocks, lists, "
        "links, and `::: tabs` blocks). Output ONLY the rewritten passage — no "
        "preamble, no code fence around the whole thing.",
        ground,
        text,
        "PASSAGE",
    )
    try:
        out = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return RewriteResponse(text=_clean_generated(out).rstrip("\n"), sources=sources)


class ReviewRequest(BaseModel):
    body: str


class Finding(BaseModel):
    """One reviewer's remark, tied to the text it is about.

    `quote` is the anchor: text copied VERBATIM out of the guide, which
    the editor finds in the buffer and underlines. It is deliberately not
    a line number — the verifier can report a line because it measured
    the file, while a model asked for one guesses, and a confident
    squiggle under an innocent line is worse than no squiggle at all. A
    quote either matches the guide or it does not, and the editor says
    which.

    Empty where the finding is the ABSENCE of something (no
    prerequisites, no closing summary): there is nothing to quote, and
    inventing an anchor for it would be the same guess by another route.
    """

    severity: str = "should"
    quote: str = ""
    issue: str
    fix: str = ""


class ReviewResponse(BaseModel):
    """`findings` is what the editor marks with; `review` is the model's
    raw answer, kept so a reply that could not be parsed still reaches
    the author as prose rather than vanishing into an empty list."""

    review: str
    findings: list[Finding] = []
    sources: list[Source] = []


# "critical" / "should" / "nice", whatever the model called them. Models
# reach for their own vocabulary — "major", "high", "minor", "Should fix"
# — and an unrecognised word must not become a fourth severity the editor
# has no colour for.
_SEVERITIES = {
    "critical": ("critical", "error", "major", "high", "blocker", "fatal", "severe"),
    "nice": ("nice", "minor", "low", "optional", "polish", "suggestion", "trivial"),
    "should": ("should", "medium", "moderate", "warn", "warning", "important"),
}


def _severity(raw: object) -> str:
    text = str(raw or "").strip().lower()
    for level, words in _SEVERITIES.items():
        if any(w in text for w in words):
            return level
    return "should"


def _json_array(text: str) -> str | None:
    """The JSON array inside a model's answer.

    Models wrap JSON in a ```json fence, or introduce it ("Here are the
    findings:"), or add a closing remark — none of which json.loads
    survives. Taking the fence first and otherwise the outermost
    brackets recovers all three shapes; anything else falls through to
    the prose path rather than raising.
    """
    fenced = re.search(r"```(?:json)?\s*\n(.*?)\n\s*```", text, re.S)
    if fenced:
        return fenced.group(1)
    start, end = text.find("["), text.rfind("]")
    return text[start : end + 1] if start != -1 and end > start else None


# A guide has a few dozen real problems at the very most. The caps are
# not tuning, they are a guard: a model that loops on one sentence should
# not hand the editor ten thousand marks to lay out.
MAX_FINDINGS = 50
MAX_QUOTE = 400


# A lone backslash that JSON does not recognise as an escape. Models
# quote Windows paths constantly, and one unescaped \ in the
# twelfth finding used to cost the other eleven.
_LONE_BACKSLASH = re.compile(r'\\(?!["\\/bfnrtu])')
# A comma before a closing bracket: the other thing models do.
_TRAILING_COMMA = re.compile(r",(\s*[\]}])")
# One top-level {...} object, non-greedy, no nesting expected in a
# finding: four string fields and nothing else.
_OBJECT = re.compile(r"\{[^{}]*\}", re.S)


def _repair(block: str) -> str:
    """Make a model's near-JSON parseable without changing its meaning."""
    return _TRAILING_COMMA.sub(r'\1', _LONE_BACKSLASH.sub(r'\\\\', block))


def _loads_findings(block: str) -> list[Any] | None:
    """The array, tolerating the two mistakes models actually make."""
    for candidate in (block, _repair(block)):
        try:
            data = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(data, list):
            return data
    return None


def _salvage_objects(block: str) -> list[Any]:
    """Whatever individual findings can still be read.

    The last resort, and the one that matters most in practice: a single
    unescaped backslash in the twelfth finding used to cost the other
    eleven, because json.loads either takes a document or rejects it.
    Parsing object by object means one malformed finding is one finding
    lost - which is also why the object pattern does not nest, so a
    broken brace cannot swallow its neighbours.
    """
    out: list[Any] = []
    for match in _OBJECT.finditer(block):
        for candidate in (match.group(0), _repair(match.group(0))):
            try:
                item = json.loads(candidate)
            except (ValueError, TypeError):
                continue
            if isinstance(item, dict):
                out.append(item)
            break
    return out


def parse_findings(text: str) -> list[Finding]:
    """Findings from a model's answer, or [] if it did not answer in JSON.

    Forgiving on purpose. The alternative is what the panel used to do
    with a single stray backslash: fall back to printing the raw JSON at
    the author, which is both unreadable and a silent loss of every
    anchor, mark and Apply button the review had earned.
    """
    block = _json_array(text or "")
    if not block:
        return []
    data = _loads_findings(block)
    if data is None:
        data = _salvage_objects(block)
    if not data:
        return []

    out: list[Finding] = []
    for item in data[:MAX_FINDINGS]:
        if not isinstance(item, dict):
            continue
        issue = str(item.get("issue") or item.get("problem") or "").strip()
        if not issue:
            continue
        out.append(
            Finding(
                severity=_severity(item.get("severity")),
                quote=str(item.get("quote") or "").strip()[:MAX_QUOTE],
                issue=issue,
                fix=str(item.get("fix") or "").strip(),
            )
        )
    return out


@router.post("/api/review", response_model=ReviewResponse)
def review_lab(req: ReviewRequest) -> ReviewResponse:
    """AI critique of a lab guide — quality, accuracy, completeness — as
    findings anchored to the text they are about. Complements the
    structural Verify, which measures the file rather than reading it."""
    body = req.body.strip()
    if not body:
        raise HTTPException(400, "Nothing to review.")
    system = "You are a senior instructional designer reviewing hands-on Pentaho workshop labs."
    prompt = (
        "Review this lab guide and report concrete, actionable problems: "
        "clarity, technical accuracy, missing or out-of-order steps, and "
        "whether it reads as a hands-on step-by-step workshop.\n\n"
        "Answer with a JSON array and NOTHING else — no preamble, no prose "
        "around it, no commentary after it. Each element:\n"
        '  {"severity": "critical" | "should" | "nice", "quote": "...", '
        '"issue": "...", "fix": "..."}\n\n'
        "`quote` is the part of the guide the problem is about, copied "
        "VERBATIM from it — the same words, the same case, the same "
        "punctuation, no ellipsis and nothing added. The editor searches the "
        "guide for it and underlines what it finds, so a quote you reworded "
        "marks nothing. Keep it short (under fifteen words) and pick a run of "
        "text that appears only once. Quote the guide, never your own "
        'description of the problem. Use "" only where the problem is that '
        "something is ABSENT — no prerequisites, no closing summary — and "
        "there is therefore nothing to quote.\n"
        "`issue` states what is wrong in one sentence. `fix` says what to do "
        "about it. Do NOT rewrite the lab. Mind the JSON: a Windows path in a "
        "quote needs its backslashes escaped, and a trailing comma is not "
        "valid.\n\n"
        "Quote only from between the GUIDE markers below — nothing above them "
        "is part of the lab."
    )
    # Assembled by the shared helper: instructions, then the grounding,
    # then the guide fenced off and last. This endpoint is where that
    # order was first needed — the opening live run reported a Critical
    # problem with the "Relevant Pentaho documentation" section of a lab
    # that has no such section, because the grounding sat at the end and
    # read as part of the material. It was fixed here by hand, and the
    # same bug promptly wrote 4,000 characters of documentation links
    # into a guide through Rewrite. One assembler now, for every prompt.
    ground, sources = _ground(body[:200])
    prompt = grounded_prompt(prompt, ground, body, "GUIDE")
    try:
        out = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return ReviewResponse(review=out.strip(), findings=parse_findings(out), sources=sources)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    # Optional editor context (e.g. the current lab body) woven into the
    # system prompt so the assistant can answer about what's on screen.
    context: str | None = None


class ChatResponse(BaseModel):
    reply: str
    sources: list[Source] = []


@router.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    """Multi-turn assistant for the editor — answers questions and helps
    write lab content / code, using the configured provider (and the docs
    when grounding is on)."""
    if not req.messages:
        raise HTTPException(400, "No messages.")
    system = (
        "You are a helpful assistant embedded in a Pentaho course-authoring tool. "
        "Help the author write and improve lab content and answer Pentaho / PDI "
        "questions. Use Markdown; put code in fenced blocks. Be concise."
    )
    if req.context and req.context.strip():
        system += f"\n\nThe author is currently editing this lab (for reference):\n{req.context[:4000]}"
    last_user = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
    ground, sources = _ground(last_user)
    system += ground
    try:
        reply = providers.chat([m.model_dump() for m in req.messages], system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return ChatResponse(reply=reply.strip(), sources=sources)
