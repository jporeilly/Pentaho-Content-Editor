"""LLM provider abstraction for the course editor's authoring assist.

Author-side only (never shipped to learner VMs). Three providers:

  • ollama    — local, free, offline (stdlib urllib; no key)
  • anthropic — Claude via the official `anthropic` SDK; key from env
  • openai    — GPT via the official `openai` SDK; key from env

Non-secret preferences (active provider, per-provider model, Ollama URL)
persist to editor/api/settings.json (gitignored). **API keys are never
stored** — they're read from ANTHROPIC_API_KEY / OPENAI_API_KEY at call
time, so this app never persists a credential.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SETTINGS_PATH = Path(__file__).resolve().parent / "settings.json"

DEFAULTS: dict[str, Any] = {
    "provider": "ollama",
    "ollama": {"url": "http://localhost:11434", "model": "llama3.2:3b"},
    # claude-opus-4-8 is the current default per Anthropic guidance; the
    # author can pick another in Settings.
    "anthropic": {"model": "claude-opus-4-8"},
    "openai": {"model": "gpt-4o"},
}

PROVIDERS = ("ollama", "anthropic", "openai")


class ProviderError(Exception):
    """Raised for any provider misconfiguration or call failure. app.py
    maps this to an HTTP 502 with the message."""


# ── Settings persistence ────────────────────────────────────────────


def load_settings() -> dict[str, Any]:
    data = dict(DEFAULTS)
    if SETTINGS_PATH.exists():
        try:
            stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            stored = {}
        for key in ("provider", "ollama", "anthropic", "openai"):
            if key in stored:
                if isinstance(DEFAULTS[key], dict) and isinstance(stored[key], dict):
                    data[key] = {**DEFAULTS[key], **stored[key]}
                else:
                    data[key] = stored[key]
    if data["provider"] not in PROVIDERS:
        data["provider"] = "ollama"
    return data


def save_settings(patch: dict[str, Any]) -> dict[str, Any]:
    current = load_settings()
    for key in ("provider", "ollama", "anthropic", "openai"):
        if key in patch and patch[key] is not None:
            if isinstance(current[key], dict) and isinstance(patch[key], dict):
                current[key] = {**current[key], **patch[key]}
            else:
                current[key] = patch[key]
    if current["provider"] not in PROVIDERS:
        raise ProviderError(f"Unknown provider '{current['provider']}'")
    SETTINGS_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def key_status() -> dict[str, bool]:
    """Which provider API keys are present in the environment (bool only —
    the values are never returned to the client)."""
    return {
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
    }


# ── Ollama (stdlib) ─────────────────────────────────────────────────


def detect_gpu() -> bool:
    """Best-effort GPU detection from the OS environment — an NVIDIA
    driver on PATH or a CUDA/GPU env var. Not exhaustive (won't spot every
    Apple-silicon / ROCm setup), just a useful hint for model suggestion."""
    if shutil.which("nvidia-smi") or shutil.which("nvidia-smi.exe"):
        return True
    for var in ("CUDA_VISIBLE_DEVICES", "CUDA_PATH", "HIP_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL"):
        v = os.environ.get(var)
        if v and v not in ("", "-1"):
            return True
    return False


def _model_size(name: str) -> float:
    """Parameter count in billions parsed from a model tag ('qwen2.5:7b'
    → 7.0, ':0.5b' → 0.5). Unknown → a neutral 4.0 so it isn't ranked at
    an extreme."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", name.lower())
    return float(m.group(1)) if m else 4.0


def suggest_model(profile: str, url: str) -> dict[str, Any]:
    """Recommend an installed Ollama model for the hardware profile.
    profile: 'auto' (detect), 'cpu', or 'gpu'. GPU → a larger, sharper
    model (≤14B to stay safe on typical cards); CPU → a small model that
    fits comfortably in RAM (~3B target)."""
    gpu = detect_gpu() if profile == "auto" else (profile == "gpu")
    installed = ollama_models(url)
    if not installed:
        return {"profile": "gpu" if gpu else "cpu", "gpu": gpu, "model": None,
                "reason": "No Ollama models installed — pull one with `ollama pull`."}

    # Prefer instruction-tuned general chat models; de-prioritise coder /
    # embedding / vision variants for prose authoring.
    def usable(n: str) -> bool:
        low = n.lower()
        return not any(t in low for t in ("coder", "embed", "vision", "-vl", "code"))

    pool = [m for m in installed if usable(m)] or installed
    ranked = sorted(pool, key=lambda m: (_model_size(m), "instruct" in m.lower()))

    if gpu:
        # Largest model at or under 14B; else the largest available.
        candidates = [m for m in ranked if _model_size(m) <= 14] or ranked
        model = candidates[-1]
        reason = "GPU detected — picked a larger, higher-quality model."
    else:
        # Prefer the largest at or under 3B (good on CPU); else the smallest.
        candidates = [m for m in ranked if _model_size(m) <= 3]
        model = candidates[-1] if candidates else ranked[0]
        reason = "No GPU detected — picked a small model that fits in RAM."

    return {"profile": "gpu" if gpu else "cpu", "gpu": gpu, "model": model, "reason": reason}


def ollama_models(url: str) -> list[str]:
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/api/tags", timeout=3) as resp:
            tags = json.loads(resp.read())
        return [m.get("name") for m in tags.get("models", []) if m.get("name")]
    except Exception:  # noqa: BLE001 — probe; any failure = unavailable
        return []


def _ollama_generate(model: str, prompt: str, system: str, url: str, timeout: int) -> str:
    payload = json.dumps(
        {"model": model, "prompt": prompt, "system": system, "stream": False}
    ).encode()
    req = urllib.request.Request(
        f"{url.rstrip('/')}/api/generate",
        data=payload, headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read()).get("response", "")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise ProviderError(
                f"Model '{model}' not found in Ollama. Pull it: `ollama pull {model}`"
            )
        raise ProviderError(f"Ollama error {e.code}: {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        raise ProviderError(f"Can't reach Ollama at {url} — is it running? ({e.reason})")


# ── Anthropic (official SDK) ────────────────────────────────────────


def _anthropic_generate(model: str, prompt: str, system: str, timeout: int) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise ProviderError("ANTHROPIC_API_KEY is not set in the environment.")
    try:
        from anthropic import Anthropic
    except ImportError:
        raise ProviderError("The `anthropic` package isn't installed: pip install anthropic")
    try:
        client = Anthropic(api_key=key, timeout=timeout)
        # No temperature — removed on Opus 4.7/4.8 and Sonnet 5 (returns 400).
        resp = client.messages.create(
            model=model,
            max_tokens=8000,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text"
        )
    except Exception as e:  # noqa: BLE001 — surface any SDK/API error to the UI
        raise ProviderError(f"Anthropic request failed: {e}")


# ── OpenAI (official SDK) ───────────────────────────────────────────


def _openai_generate(model: str, prompt: str, system: str, timeout: int) -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ProviderError("OPENAI_API_KEY is not set in the environment.")
    try:
        from openai import OpenAI
    except ImportError:
        raise ProviderError("The `openai` package isn't installed: pip install openai")
    try:
        client = OpenAI(api_key=key, timeout=timeout)
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        try:
            resp = client.chat.completions.create(
                model=model, messages=messages, max_tokens=4000
            )
        except Exception:
            # Newer models reject `max_tokens` in favour of
            # `max_completion_tokens`; retry once with the default cap.
            resp = client.chat.completions.create(model=model, messages=messages)
        return resp.choices[0].message.content or ""
    except Exception as e:  # noqa: BLE001
        raise ProviderError(f"OpenAI request failed: {e}")


# ── Dispatch ────────────────────────────────────────────────────────


def generate(prompt: str, system: str, timeout: int = 240) -> str:
    s = load_settings()
    provider = s["provider"]
    if provider == "ollama":
        o = s["ollama"]
        return _ollama_generate(o["model"], prompt, system, o["url"], timeout)
    if provider == "anthropic":
        return _anthropic_generate(s["anthropic"]["model"], prompt, system, timeout)
    if provider == "openai":
        return _openai_generate(s["openai"]["model"], prompt, system, timeout)
    raise ProviderError(f"Unknown provider '{provider}'")


def health() -> dict[str, Any]:
    """Best-effort connection status for the ACTIVE provider — no paid
    API call is made for the cloud providers (key presence + SDK import
    only)."""
    s = load_settings()
    provider = s["provider"]
    if provider == "ollama":
        models = ollama_models(s["ollama"]["url"])
        ok = bool(models)
        return {
            "provider": "ollama",
            "ok": ok,
            "model": s["ollama"]["model"],
            "detail": "connected" if ok else f"not reachable at {s['ollama']['url']}",
            "models": models,
        }
    keys = key_status()
    if not keys.get(provider):
        env = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
        return {"provider": provider, "ok": False, "model": s[provider]["model"], "detail": f"{env} not set"}
    pkg = "anthropic" if provider == "anthropic" else "openai"
    try:
        __import__(pkg)
    except ImportError:
        return {"provider": provider, "ok": False, "model": s[provider]["model"], "detail": f"`{pkg}` package not installed"}
    return {"provider": provider, "ok": True, "model": s[provider]["model"], "detail": "key detected"}
