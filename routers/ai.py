"""AI over the configured LLM: rewrite a passage, review a lab, and the
multi-turn assistant chat. All three optionally ground in the Pentaho docs
and return the sources they drew on."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import providers
from core import _ground, _clean_generated, Source

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
    prompt = (
        f"Rewrite the passage below. {instr} Preserve all Markdown structure "
        "(headings, `> **Note:**`-style callouts, fenced code blocks, lists, "
        "links, and `::: tabs` blocks). Output ONLY the rewritten passage — no "
        f"preamble, no code fence around the whole thing.\n\n---\n{text}"
    )
    ground, sources = _ground(text)
    prompt += ground
    try:
        out = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return RewriteResponse(text=_clean_generated(out).rstrip("\n"), sources=sources)


class ReviewRequest(BaseModel):
    body: str


class ReviewResponse(BaseModel):
    review: str
    sources: list[Source] = []


@router.post("/api/review", response_model=ReviewResponse)
def review_lab(req: ReviewRequest) -> ReviewResponse:
    """AI critique of a lab guide — quality, accuracy, completeness — as
    grouped bullet points. Complements the structural Verify."""
    body = req.body.strip()
    if not body:
        raise HTTPException(400, "Nothing to review.")
    system = "You are a senior instructional designer reviewing hands-on Pentaho workshop labs."
    prompt = (
        "Review this lab guide and list concrete, actionable issues with brief "
        "suggested fixes. Group them under **Critical**, **Should fix**, and "
        "**Nice to have** headings (omit a group if empty). Check: clarity, "
        "technical accuracy, completeness of steps, and whether it reads as a "
        "hands-on step-by-step workshop. Be specific and concise — do NOT "
        f"rewrite the lab.\n\n---\n{body}"
    )
    ground, sources = _ground(body[:200])
    prompt += ground
    try:
        out = providers.generate(prompt, system)
    except providers.ProviderError as e:
        raise HTTPException(502, str(e))
    return ReviewResponse(review=out.strip(), sources=sources)


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
