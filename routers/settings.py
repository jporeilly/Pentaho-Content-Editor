"""LLM provider settings + runtime probes: read/patch the provider config,
active-provider health, CPU/GPU model suggestion, the GitBook-MCP docs
test, and the back-compat Ollama-only health alias."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import providers
import mcp

router = APIRouter()


class SettingsPatch(BaseModel):
    provider: str | None = None
    ollama: dict[str, Any] | None = None
    anthropic: dict[str, Any] | None = None
    openai: dict[str, Any] | None = None
    docs: dict[str, Any] | None = None


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


@router.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return _settings_view(providers.load_settings())


@router.put("/api/settings")
def put_settings(patch: SettingsPatch) -> dict[str, Any]:
    try:
        saved = providers.save_settings(patch.model_dump(exclude_none=True))
    except providers.ProviderError as e:
        raise HTTPException(400, str(e))
    return _settings_view(saved)


@router.get("/api/providers/health")
def providers_health() -> dict[str, Any]:
    """Connection status for the ACTIVE provider — drives the header
    indicator and enables/disables the AI button."""
    return providers.health()


@router.get("/api/providers/suggest")
def suggest_model(profile: str = "auto") -> dict[str, Any]:
    """Recommend an installed Ollama model for the CPU/GPU profile
    ('auto' detects from the OS environment)."""
    s = providers.load_settings()
    return providers.suggest_model(profile, s["ollama"]["url"])


@router.get("/api/docs/test")
def docs_test(url: str | None = None, query: str = "CSV file input") -> dict[str, Any]:
    """Probe the GitBook MCP docs endpoint — used by the Settings 'Test'
    button to confirm grounding is reachable."""
    docs_url = url or (providers.load_settings().get("docs") or {}).get("url")
    if not docs_url:
        return {"ok": False, "error": "No docs MCP URL configured"}
    try:
        hits = mcp.search(docs_url, query, limit=3, timeout=15)
        return {"ok": True, "count": len(hits), "sample": [h["title"] for h in hits[:3]]}
    except mcp.McpError as e:
        return {"ok": False, "error": str(e)}


@router.get("/api/ollama/health")
def ollama_health() -> dict[str, Any]:
    h = providers.health()
    return {"ok": h["ok"], "models": h.get("models", []), "error": None if h["ok"] else h.get("detail")}
