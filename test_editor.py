"""Smoke tests for the course-editor backend.

Run from editor/api/:  python -m pytest -q

Isolation: fixtures monkeypatch COURSES_DIR to a temp dir and
SETTINGS_PATH to a temp file, so tests never touch real courses or the
author's settings. The LLM and Ollama network calls are stubbed — these
cover the pure-Python surface (settings, structure, assets, course.json,
export) plus the request/response shape of the AI endpoints.
"""

import json
import zipfile
import io

import pytest
from fastapi.testclient import TestClient

import providers
import mcp
import extract
import core
import app as appmod


@pytest.fixture
def env(tmp_path, monkeypatch):
    courses = tmp_path / "courses"
    (courses / "sample" / "01-intro").mkdir(parents=True)
    monkeypatch.setattr(core, "COURSES_DIR", courses)
    monkeypatch.setattr(providers, "SETTINGS_PATH", tmp_path / "settings.json")
    # Avoid real network to Ollama in settings/suggest paths.
    monkeypatch.setattr(providers, "ollama_models", lambda url: ["qwen2.5:7b", "llama3.2:3b"])
    c = courses / "sample"
    (c / "course.json").write_text(json.dumps({"id": "sample", "title": "Sample", "kind": "workshop"}))
    (c / "SUMMARY.md").write_text("# Table of contents\n\n## Basics\n\n* [Intro](01-intro/guide.md)\n")
    (c / "01-intro" / "manifest.json").write_text(json.dumps({"title": "Intro", "order": 1, "kind": "workshop"}))
    (c / "01-intro" / "guide.md").write_text("# Intro\n\n> **Note:**\n>\n> Hi.\n\n## Step\n\nDo it.\n")
    (c / "_assets" / "images").mkdir(parents=True)
    return courses


@pytest.fixture
def client():
    return TestClient(appmod.app)


@pytest.fixture
def no_llm(monkeypatch):
    monkeypatch.setattr(providers, "generate", lambda prompt, system, timeout=240: "GENERATED")
    monkeypatch.setattr(providers, "chat", lambda messages, system, timeout=240: "CHAT REPLY")


# ── providers / settings ────────────────────────────────────────────

def test_settings_persists_docs(env, client):
    # Regression: the docs-grounding toggle used to be dropped on save.
    r = client.put("/api/settings", json={"docs": {"enabled": True, "url": "http://x/mcp"}})
    assert r.status_code == 200
    assert r.json()["docs"]["enabled"] is True
    assert providers.load_settings()["docs"]["enabled"] is True


def test_settings_view_has_keys_and_gpu(env, client):
    body = client.get("/api/settings").json()
    assert set(("provider", "ollama", "docs", "keys", "ollamaModels", "gpu")) <= set(body)


def test_save_load_roundtrip_merges(env):
    providers.save_settings({"ollama": {"model": "m1"}})
    providers.save_settings({"provider": "ollama", "docs": {"enabled": True}})
    s = providers.load_settings()
    assert s["ollama"]["model"] == "m1"          # earlier patch preserved
    assert s["docs"]["enabled"] is True


def test_suggest_model_cpu_vs_gpu(env, monkeypatch):
    monkeypatch.setattr(providers, "detect_gpu", lambda: False)
    assert providers.suggest_model("cpu", "http://x")["profile"] == "cpu"
    assert providers.suggest_model("gpu", "http://x")["model"] == "qwen2.5:7b"


def test_model_size_parsing():
    assert providers._model_size("qwen2.5:7b") == 7.0
    assert providers._model_size("x:0.5b") == 0.5
    assert providers._model_size("llama3.2:latest") == 4.0


# ── mcp / extract ───────────────────────────────────────────────────

def test_mcp_parse_and_context():
    hit = mcp._parse_title_link_content("Title: CSV Input\nLink: http://d/x\nContent: reads csv")
    assert hit == {"title": "CSV Input", "url": "http://d/x", "snippet": "reads csv"}
    ctx = mcp.as_context([{"title": "T", "url": "http://u", "snippet": "s"}])
    assert "Pentaho documentation" in ctx and "http://u" in ctx
    assert mcp.as_context([]) == ""


def test_extract_md_and_unsupported():
    assert "hello" in extract.extract_text("x.md", b"# Title\n\nhello")
    with pytest.raises(extract.ExtractError):
        extract.extract_text("x.exe", b"...")
    with pytest.raises(extract.ExtractError):
        extract.extract_text("x.md", b"")


# ── courses / structure ─────────────────────────────────────────────

def test_list_and_get_course(env, client):
    assert any(c["id"] == "sample" for c in client.get("/api/courses").json())
    assert client.get("/api/courses/sample").json()["title"] == "Sample"


def test_put_course(env, client):
    r = client.put("/api/courses/sample", json={"title": "Renamed", "theme": {"accent": "#fff"}})
    assert r.status_code == 200 and r.json()["title"] == "Renamed"
    assert json.loads((env / "sample" / "course.json").read_text())["theme"]["accent"] == "#fff"


def test_put_course_rejects_empty_title(env, client):
    assert client.put("/api/courses/sample", json={"title": "  "}).status_code == 400


def test_structure_rename_syncs_manifest(env, client):
    topics = client.get("/api/courses/sample/structure").json()["topics"]
    assert topics[0]["labs"][0]["slug"] == "01-intro"
    topics[0]["labs"][0]["title"] = "Intro 2"
    r = client.put("/api/courses/sample/structure", json={"topics": topics})
    assert r.status_code == 200
    assert json.loads((env / "sample" / "01-intro" / "manifest.json").read_text())["title"] == "Intro 2"


def test_get_lab_and_save(env, client):
    d = client.get("/api/courses/sample/labs/01-intro").json()
    assert d["slug"] == "01-intro" and "# Intro" in d["body"]
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": "# Intro\n\n## A\n\n## B\n"})
    assert r.status_code == 200 and r.json()["manifest"]["stepCount"] == 2


def test_unknown_course_404(env, client):
    assert client.get("/api/courses/nope/structure").status_code == 404


# ── assets / lab files ──────────────────────────────────────────────

def test_asset_upload_sanitises(env, client):
    r = client.post("/api/courses/sample/assets", files={"file": ("My Shot!.png", b"\x89PNG", "image/png")})
    assert r.status_code == 200
    assert r.json()["path"] == "../_assets/images/My_Shot_.png"
    assert (env / "sample" / "_assets" / "images" / "My_Shot_.png").exists()


def test_lab_files_upload_and_list(env, client):
    r = client.post("/api/courses/sample/labs/01-intro/files", files={"file": ("a.ktr", b"<x/>", "application/xml")})
    assert r.status_code == 200 and r.json()["path"] == "files/a.ktr"
    assert client.get("/api/courses/sample/labs/01-intro/files").json() == ["a.ktr"]


# ── AI endpoints (LLM stubbed) ──────────────────────────────────────

def test_rewrite(env, client, no_llm):
    r = client.post("/api/rewrite", json={"text": "fix me"})
    assert r.status_code == 200 and r.json()["text"] == "GENERATED"


def test_review(env, client, no_llm):
    r = client.post("/api/review", json={"body": "# Lab\n\n## Step"})
    assert r.status_code == 200 and r.json()["review"] == "GENERATED"


def test_chat(env, client, no_llm):
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200 and r.json()["reply"] == "CHAT REPLY"


def test_ground_off_by_default(env):
    # Grounding disabled → no sources, no network.
    ctx, sources = core._ground("anything")
    assert ctx == "" and sources == []


# ── export ──────────────────────────────────────────────────────────

def test_export_zip(env, client):
    r = client.get("/api/courses/sample/export")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert "sample/course.json" in names and "sample/01-intro/guide.md" in names
