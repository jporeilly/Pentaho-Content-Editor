"""Smoke tests for the course-editor backend.

Run from api/:  python -m pytest -q

Isolation: fixtures monkeypatch COURSES_DIR to a temp dir and
SETTINGS_PATH to a temp file, so tests never touch real courses or the
author's settings. The LLM and Ollama network calls are stubbed — these
cover the pure-Python surface (settings, structure, assets, course.json,
export) plus the request/response shape of the AI endpoints.
"""

import json
import zipfile
import io
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import providers
import mcp
import extract
import core
import tools
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


def test_detect_gpu_finds_nvidia_smi_under_wow64_redirection(monkeypatch, tmp_path):
    """A 32-bit Python sees System32 redirected to SysWOW64, where
    nvidia-smi.exe isn't — so a PATH lookup alone reported "no GPU" on a
    machine with two RTX 3060s. Sysnative is the way back to the real
    System32; detection must consult it."""
    monkeypatch.setattr(providers.shutil, "which", lambda _n: None)
    for var in ("CUDA_VISIBLE_DEVICES", "CUDA_PATH", "HIP_VISIBLE_DEVICES", "GPU_DEVICE_ORDINAL"):
        monkeypatch.delenv(var, raising=False)

    # Nothing anywhere → no GPU.
    monkeypatch.setattr(providers, "_nvidia_smi_paths", lambda: [str(tmp_path / "nope.exe")])
    assert providers.detect_gpu() is False

    # Present only via the Sysnative alias → still detected.
    smi = tmp_path / "nvidia-smi.exe"
    smi.write_text("")
    monkeypatch.setattr(providers, "_nvidia_smi_paths", lambda: [str(smi)])
    assert providers.detect_gpu() is True


def test_nvidia_smi_paths_include_sysnative():
    assert any("Sysnative" in p for p in providers._nvidia_smi_paths())


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


def test_put_course_saves_contact_block(env, client):
    # `contact` was missing from the allowed-key list, so a Contact Us
    # dialog would have posted these and had them silently dropped.
    contact = {
        "to": "academy@pentaho.com",
        "heading": "Contact Us",
        "blurb": "Ask us anything.",
        "webhookUrl": "https://script.google.com/macros/s/AAA/exec",
    }
    r = client.put("/api/courses/sample", json={"contact": contact})
    assert r.status_code == 200
    saved = json.loads((env / "sample" / "course.json").read_text())["contact"]
    assert saved["webhookUrl"].endswith("/exec")
    assert saved["to"] == "academy@pentaho.com"


def test_put_course_refuses_a_secret(env, client):
    # Course files are published; since Content Manager 0.7.2 secrets
    # reach machines from the private secrets file instead.
    before = (env / "sample" / "course.json").read_text()
    for contact in (
        {"to": "a@b.com", "webhookSecret": "pcm_secret"},
        {"to": "a@b.com", "webhookUrl": "https://prod-1.westeurope.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sv=1.0&sig=AbC"},
    ):
        r = client.put("/api/courses/sample", json={"contact": contact})
        assert r.status_code == 400 and "secrets file" in r.json()["detail"]
        assert "pcm_secret" not in r.json()["detail"] and "AbC" not in r.json()["detail"]
    assert (env / "sample" / "course.json").read_text() == before


def test_put_course_empty_contact_removes_the_key(env, client):
    client.put("/api/courses/sample", json={"contact": {"to": "a@b.com"}})
    client.put("/api/courses/sample", json={"contact": {}})
    assert "contact" not in json.loads((env / "sample" / "course.json").read_text())


def test_put_course_saves_the_certificate_block(env, client):
    cert = {
        "title": "Pentaho Data Integration Developer - Practitioner Level",
        "topics": ["Components and key concepts", "Flat files and databases"],
        "capstone": "Completed a capstone project.",
        "watermark": "PENTAHO",
        "validYears": 2,
        "signatory": {"name": "Jason Allaway", "title": "President Pentaho"},
    }
    r = client.put("/api/courses/sample", json={"completionCertificate": cert})
    assert r.status_code == 200
    saved = json.loads((env / "sample" / "course.json").read_text())["completionCertificate"]
    assert saved["title"].endswith("Practitioner Level")
    assert saved["topics"] == ["Components and key concepts", "Flat files and databases"]
    assert saved["signatory"]["name"] == "Jason Allaway"


def test_put_course_empty_certificate_removes_it(env, client):
    """The dialog's off switch. A course with no block offers no
    certificate, which is the right answer for a try-it lab whose check
    is anonymous — there is nobody to name on it."""
    client.put("/api/courses/sample", json={"completionCertificate": {"title": "T"}})
    client.put("/api/courses/sample", json={"completionCertificate": {}})
    assert "completionCertificate" not in json.loads(
        (env / "sample" / "course.json").read_text())


def test_put_course_keeps_validYears_zero(env, client):
    # 0 means "never expires" and must survive a truthiness check.
    client.put("/api/courses/sample", json={
        "completionCertificate": {"title": "T", "validYears": 0}})
    saved = json.loads((env / "sample" / "course.json").read_text())
    assert saved["completionCertificate"]["validYears"] == 0


def test_put_course_rejects_empty_title(env, client):
    assert client.put("/api/courses/sample", json={"title": "  "}).status_code == 400


def test_put_course_writes_utf8_not_escaped(env, client):
    # Regression: course.json must stay readable UTF-8 (an em-dash is "—",
    # not "—") so a save doesn't churn the diff.
    r = client.put("/api/courses/sample", json={"description": "Tour the PUC — the home."})
    assert r.status_code == 200
    raw = (env / "sample" / "course.json").read_text(encoding="utf-8")
    assert "—" in raw and "\\u2014" not in raw


def test_structure_rename_syncs_manifest(env, client):
    topics = client.get("/api/courses/sample/structure").json()["topics"]
    assert topics[0]["labs"][0]["slug"] == "01-intro"
    topics[0]["labs"][0]["title"] = "Intro 2"
    r = client.put("/api/courses/sample/structure", json={"topics": topics})
    assert r.status_code == 200
    assert json.loads((env / "sample" / "01-intro" / "manifest.json").read_text())["title"] == "Intro 2"


def _nest(env, client):
    """Give the sample course a `### Advanced` sub-topic holding a second
    lab, and return the parsed topic tree."""
    c = env / "sample"
    (c / "02-deep").mkdir()
    (c / "02-deep" / "manifest.json").write_text(json.dumps({"title": "Deep", "order": 2, "kind": "workshop"}))
    (c / "02-deep" / "guide.md").write_text("# Deep\n")
    (c / "SUMMARY.md").write_text(
        "# Table of contents\n\n## Basics\n\n* [Intro](01-intro/guide.md)\n"
        "\n### Advanced\n\n* [Deep](02-deep/guide.md)\n"
    )
    return client.get("/api/courses/sample/structure").json()["topics"]


def test_structure_parses_subtopics(env, client):
    topics = _nest(env, client)
    assert [t["title"] for t in topics] == ["Basics"]
    assert [l["slug"] for l in topics[0]["labs"]] == ["01-intro"]
    assert [c["title"] for c in topics[0]["children"]] == ["Advanced"]
    assert [l["slug"] for l in topics[0]["children"][0]["labs"]] == ["02-deep"]


def test_structure_roundtrip_keeps_subtopics(env, client):
    """A no-op save must not flatten the tree. It used to: the parser
    only matched `##`, so `###` vanished on the next reorder."""
    topics = _nest(env, client)
    r = client.put("/api/courses/sample/structure", json={"topics": topics})
    assert r.status_code == 200
    summary = (env / "sample" / "SUMMARY.md").read_text()
    assert "### Advanced" in summary
    assert "* [Deep](02-deep/guide.md)" in summary
    assert r.json()["topics"][0]["children"][0]["title"] == "Advanced"


def test_structure_order_walks_labs_before_children(env, client):
    """Flattened `order` must match sidebar order — a topic's own labs
    come above its subtopics."""
    topics = _nest(env, client)
    client.put("/api/courses/sample/structure", json={"topics": topics})
    read = lambda s: json.loads((env / "sample" / s / "manifest.json").read_text())["order"]
    assert read("01-intro") == 1 and read("02-deep") == 2


def test_structure_preserves_topic_page(env, client):
    topics = _nest(env, client)
    topics[0]["children"][0]["page"] = {"slug": "01-intro", "title": "Intro", "kind": "page"}
    client.put("/api/courses/sample/structure", json={"topics": topics})
    summary = (env / "sample" / "SUMMARY.md").read_text()
    assert "<!-- topic-page: 01-intro -->" in summary
    back = client.get("/api/courses/sample/structure").json()["topics"]
    assert back[0]["children"][0]["page"]["slug"] == "01-intro"


def test_delete_lab_keeps_subtopics(env, client):
    """Deleting a lab rebuilds SUMMARY.md wholesale — it must not take
    the sub-topics with it."""
    _nest(env, client)
    r = client.request("DELETE", "/api/courses/sample/labs/01-intro", json={"confirm": "delete"})
    assert r.status_code == 200
    summary = (env / "sample" / "SUMMARY.md").read_text()
    assert "### Advanced" in summary and "02-deep" in summary
    assert "01-intro" not in summary


def test_structure_save_is_byte_stable(env, client):
    """Saving twice must not keep changing the file. A group-only topic
    used to gain a blank line on every write, so an author's diff churned
    on saves that changed nothing."""
    topics = _nest(env, client)
    client.put("/api/courses/sample/structure", json={"topics": topics})
    once = (env / "sample" / "SUMMARY.md").read_text()
    again = client.get("/api/courses/sample/structure").json()["topics"]
    client.put("/api/courses/sample/structure", json={"topics": again})
    assert (env / "sample" / "SUMMARY.md").read_text() == once
    assert "\n\n\n" not in once


def test_put_structure_validates_nested_labs(env, client):
    topics = _nest(env, client)
    topics[0]["children"][0]["labs"][0]["slug"] = "ghost"
    r = client.put("/api/courses/sample/structure", json={"topics": topics})
    assert r.status_code == 400 and "ghost" in r.json()["detail"]


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
    # A provider that ignores the JSON instruction still reaches the
    # author: the raw answer rides along in `review`, and the editor
    # falls back to showing it as prose.
    r = client.post("/api/review", json={"body": "# Lab\n\n## Step"})
    assert r.status_code == 200
    assert r.json()["review"] == "GENERATED" and r.json()["findings"] == []


def test_review_returns_findings(env, client, monkeypatch):
    answer = (
        "Here is what I found:\n\n```json\n"
        '[{"severity": "Major", "quote": "Start Spoon", "issue": "no version", "fix": "say which"},\n'
        ' {"severity": "nice", "issue": "no prerequisites"}]\n'
        "```\n\nHope that helps."
    )
    monkeypatch.setattr(providers, "generate", lambda prompt, system, timeout=240: answer)
    r = client.post("/api/review", json={"body": "# Lab\n\nStart Spoon.\n"})
    findings = r.json()["findings"]
    # "Major" is the model's word for critical; "nice" is taken as given.
    assert [f["severity"] for f in findings] == ["critical", "nice"]
    assert findings[0]["quote"] == "Start Spoon"
    # No quote is a valid finding — it is about something that is absent.
    assert findings[1]["quote"] == ""


def test_parse_findings_survives_what_models_actually_send():
    from routers.ai import parse_findings

    # Prose around a bare array, no fence.
    assert len(parse_findings('Findings: [{"issue": "x"}] — that is all.')) == 1
    # Junk in the list is dropped, not fatal.
    out = parse_findings('[null, "x", {"quote": "q"}, {"issue": "  keep me  "}]')
    assert [f.issue for f in out] == ["keep me"]
    # Not JSON at all, or not a list: prose, handled by the caller.
    assert parse_findings("**Critical** — the lab has no prerequisites") == []
    assert parse_findings('{"issue": "an object, not a list"}') == []
    assert parse_findings("") == []


def test_parse_findings_caps_a_runaway_answer():
    from routers.ai import parse_findings, MAX_FINDINGS, MAX_QUOTE

    many = json.dumps([{"issue": "x", "quote": "q" * 900}] * (MAX_FINDINGS + 40))
    out = parse_findings(many)
    assert len(out) == MAX_FINDINGS
    assert len(out[0].quote) == MAX_QUOTE


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


# ── delete course ───────────────────────────────────────────────────

def test_delete_requires_confirmation_phrase(env, client):
    r = client.request("DELETE", "/api/courses/sample", json={"confirm": ""})
    assert r.status_code == 428
    r = client.request("DELETE", "/api/courses/sample", json={"confirm": "yes"})
    assert r.status_code == 428
    assert (env / "sample").is_dir()  # still there


def test_delete_removes_course_dir(env, client):
    r = client.request("DELETE", "/api/courses/sample", json={"confirm": "delete"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert not (env / "sample").exists()
    # Gone → subsequent operations 404.
    assert client.get("/api/courses/sample").status_code == 404


def test_delete_unknown_course_404(env, client):
    r = client.request("DELETE", "/api/courses/nope", json={"confirm": "delete"})
    assert r.status_code == 404


# ── publish ─────────────────────────────────────────────────────────
# A local bare repo stands in for Pentaho-Courses; a seeded working
# clone pushes the initial state so diffs have something to compare to.

import shutil
import subprocess

from routers import publish as publishmod


def _run(args, cwd):
    subprocess.run(args, cwd=str(cwd), check=True, capture_output=True)


@pytest.fixture
def publish_env(env, tmp_path, monkeypatch):
    origin = tmp_path / "origin.git"
    origin.mkdir()
    _run(["git", "init", "--bare", "-b", "main", "-q"], origin)

    seed = tmp_path / "seed"
    _run(["git", "clone", "-q", str(origin), str(seed)], tmp_path)
    remote_course = seed / "sample"
    remote_course.mkdir()
    (remote_course / "course.json").write_text(json.dumps({"id": "sample", "title": "Sample"}))
    (remote_course / "old.md").write_text("stale file that local no longer has\n")
    _run(["git", "add", "-A"], seed)
    _run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], seed)
    _run(["git", "push", "-q", "origin", "main"], seed)

    monkeypatch.setattr(publishmod, "REPO_URL", str(origin))
    monkeypatch.setattr(publishmod, "CACHE_DIR", tmp_path / "publish-cache")
    # The authoring side is a git checkout, as the Content Manager is:
    # Publish reads its .gitignore rules through git.
    _run(["git", "init", "-b", "main", "-q"], env.parent)
    return origin


def _origin_files(origin, tmp_path):
    check = tmp_path / "check"
    _run(["git", "clone", "-q", str(origin), str(check)], tmp_path)
    return {p.relative_to(check).as_posix()
            for p in check.rglob("*") if p.is_file() and ".git" not in p.parts}


def test_publish_diff_reports_changes(publish_env, client):
    body = client.get("/api/courses/sample/publish/diff").json()
    assert body["upToDate"] is False and body["newCourse"] is False
    # Local has files the seed lacks, and lacks the seed's old.md.
    assert "SUMMARY.md" in body["added"]
    assert body["removed"] == ["old.md"]
    # course.json content differs between local and seed.
    assert "course.json" in body["modified"]


def test_publish_pushes_and_prunes(publish_env, client, tmp_path):
    r = client.post("/api/courses/sample/publish", json={"message": "test publish"})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True and body["upToDate"] is False
    files = _origin_files(publish_env, tmp_path)
    assert "sample/SUMMARY.md" in files          # added
    assert "sample/old.md" not in files          # removal propagated
    # Second publish with no edits is a no-op.
    again = client.post("/api/courses/sample/publish", json={}).json()
    assert again["upToDate"] is True


def test_publish_diff_up_to_date_after_publish(publish_env, client):
    client.post("/api/courses/sample/publish", json={})
    body = client.get("/api/courses/sample/publish/diff").json()
    assert body["upToDate"] is True
    assert body["added"] == [] and body["modified"] == [] and body["removed"] == []


def test_publish_tag_validates_and_pushes(publish_env, client, tmp_path):
    assert client.post("/api/publish/tag", json={"tag": "not a tag!"}).status_code == 422
    r = client.post("/api/publish/tag", json={"tag": "v2026.07"})
    assert r.status_code == 200 and r.json()["tag"] == "v2026.07"
    # Tag exists on the origin now; retagging collides.
    out = subprocess.run(["git", "tag", "--list"], cwd=str(publish_env),
                         capture_output=True, text=True, check=True)
    assert "v2026.07" in out.stdout
    assert client.post("/api/publish/tag", json={"tag": "v2026.07"}).status_code == 409


def test_publish_unknown_course_404(publish_env, client):
    assert client.get("/api/courses/nope/publish/diff").status_code == 404


def test_publish_with_commit_pushes_authoring_repo(publish_env, client, tmp_path, monkeypatch):
    # Authoring repo = a git repo whose courses/ IS core.COURSES_DIR,
    # with its own bare origin. commit:true must commit ONLY the course
    # folder there and push, then publish to the distribution repo.
    root = core.COURSES_DIR.parent  # publish_env made it a repo
    origin2 = tmp_path / "authoring-origin.git"
    origin2.mkdir()
    _run(["git", "init", "--bare", "-b", "main", "-q"], origin2)
    _run(["git", "remote", "add", "origin", str(origin2)], root)
    (root / "unrelated.txt").write_text("must stay uncommitted\n")
    _run(["git", "add", "courses"], root)
    _run(["git", "-c", "user.email=t@t", "-c", "user.name=t",
          "commit", "-q", "-m", "seed authoring"], root)
    _run(["git", "push", "-q", "-u", "origin", "main"], root)
    monkeypatch.setattr(core, "REPO_ROOT", root)

    # Change the course, then Commit & Publish.
    (core.COURSES_DIR / "sample" / "01-intro" / "guide.md").write_text("# Intro\n\nEdited.\n")
    r = client.post("/api/courses/sample/publish", json={"commit": True, "message": "editor edits"})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True
    assert body["authoring"]["committed"] is True

    # Authoring origin received the commit; unrelated file untouched.
    log = subprocess.run(["git", "log", "--oneline", "main"], cwd=str(origin2),
                         capture_output=True, text=True, check=True).stdout
    assert "editor edits" in log
    status = subprocess.run(["git", "status", "--porcelain"], cwd=str(root),
                            capture_output=True, text=True, check=True).stdout
    assert "unrelated.txt" in status  # still uncommitted

    # Second run with no edits: authoring is a clean no-op.
    r2 = client.post("/api/courses/sample/publish", json={"commit": True}).json()
    assert r2["authoring"]["committed"] is False


def test_publish_diff_ignores_line_endings(publish_env, client):
    # Regression: git's autocrlf means the same committed file can read
    # back CRLF in one checkout and LF in another — that must not count
    # as "modified" (it made every text file look dirty on Windows).
    client.post("/api/courses/sample/publish", json={})
    guide = core.COURSES_DIR / "sample" / "01-intro" / "guide.md"
    raw = guide.read_bytes()
    normalized = raw.replace(b"\r\n", b"\n")
    flipped = normalized if b"\r\n" in raw else normalized.replace(b"\n", b"\r\n")
    guide.write_bytes(flipped)  # same content, opposite endings
    body = client.get("/api/courses/sample/publish/diff").json()
    assert body["upToDate"] is True, body


# Pentaho-Courses is PUBLIC; what the Content Manager's .gitignore keeps
# out of git must not reach it through Publish. The rules below are the
# Content Manager's own (root `.env` / `*.db`, a workshop's nested
# `config/.kettle/**`).

def _ignore_like_the_content_manager():
    root = core.COURSES_DIR.parent
    (root / ".gitignore").write_text(".env\n*.db\n")
    files = core.COURSES_DIR / "sample" / "01-intro" / "files"
    (files / "config" / ".kettle").mkdir(parents=True)
    (files / ".gitignore").write_text("config/.kettle/**\n")
    (files / ".env").write_text("DB_PASSWORD=not-for-github\n")
    (files / "config" / ".kettle" / "kettle.properties").write_text("PASSWORD=x\n")
    (files / "run.sh").write_text("echo hi\n")


_SKIPPED = ["01-intro/files/.env", "01-intro/files/config/.kettle/kettle.properties"]


def test_publish_diff_reports_skipped_ignored_files(publish_env, client):
    _ignore_like_the_content_manager()
    body = client.get("/api/courses/sample/publish/diff").json()
    assert body["skippedIgnored"] == _SKIPPED
    # Skipped, not added; the nested .gitignore and its neighbours still go.
    assert not set(_SKIPPED) & set(body["added"])
    assert {"01-intro/files/run.sh", "01-intro/files/.gitignore"} <= set(body["added"])


def test_publish_never_pushes_an_ignored_file(publish_env, client, tmp_path):
    _ignore_like_the_content_manager()
    body = client.post("/api/courses/sample/publish", json={}).json()
    assert body["ok"] is True and body["skippedIgnored"] == _SKIPPED
    files = _origin_files(publish_env, tmp_path)
    assert "sample/01-intro/files/run.sh" in files
    assert not {f"sample/{p}" for p in _SKIPPED} & files
    # Nothing else changed: up to date, and still says what it skipped.
    again = client.post("/api/courses/sample/publish", json={}).json()
    assert again["upToDate"] is True and again["skippedIgnored"] == _SKIPPED


def test_an_ignored_file_already_published_keeps_publishing(publish_env, client, tmp_path):
    # The real case: a workshop's sample databases, ignored by the root
    # `*.db`, published long ago on purpose. Skipping them now would
    # delete them from every VM.
    seed = tmp_path / "seed"
    (seed / "sample" / "data").mkdir()
    (seed / "sample" / "data" / "history.db").write_bytes(b"\0old")
    _run(["git", "add", "-A"], seed)
    _run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "db"], seed)
    _run(["git", "push", "-q", "origin", "main"], seed)
    _ignore_like_the_content_manager()
    local_db = core.COURSES_DIR / "sample" / "data" / "history.db"
    local_db.parent.mkdir()
    local_db.write_bytes(b"\0new")

    diff = client.get("/api/courses/sample/publish/diff").json()
    assert "data/history.db" in diff["modified"]
    assert "data/history.db" not in diff["skippedIgnored"]
    client.post("/api/courses/sample/publish", json={})
    check = tmp_path / "check"
    _run(["git", "clone", "-q", str(publish_env), str(check)], tmp_path)
    assert (check / "sample" / "data" / "history.db").read_bytes() == b"\0new"


def test_an_ignored_leftover_in_the_cache_is_not_already_published(publish_env, client, tmp_path):
    # "Already published" means in the distribution repo, not merely on
    # disk in the cache clone. Plant an untracked, clone-ignored copy of
    # the .env there; the freshen must clear it, or the .env would pass
    # for published and stop being reported.
    _ignore_like_the_content_manager()
    client.get("/api/courses/sample/publish/diff")  # creates the cache
    cache = tmp_path / "publish-cache"
    (cache / ".git" / "info" / "exclude").write_text(".env\n")
    (cache / "sample" / "01-intro" / "files").mkdir(parents=True)
    (cache / "sample" / "01-intro" / "files" / ".env").write_text("DB_PASSWORD=not-for-github\n")
    body = client.get("/api/courses/sample/publish/diff").json()
    assert "01-intro/files/.env" in body["skippedIgnored"]


def test_publish_refuses_when_it_cannot_read_the_ignore_rules(publish_env, client, tmp_path):
    # Not a git checkout: no way to tell what must stay private, so fail
    # closed rather than publish everything.
    shutil.rmtree(tmp_path / ".git")
    r = client.get("/api/courses/sample/publish/diff")
    assert r.status_code == 502 and ".gitignore" in r.json()["detail"]
    r = client.post("/api/courses/sample/publish", json={})
    assert r.status_code == 502
    assert "sample/old.md" in _origin_files(publish_env, tmp_path)  # untouched


# ── course settings + lab timing (the editor owns these course.json / manifest fields) ──

def test_put_course_welcome_round_trip_and_mode(env, client):
    welcome = {"eyebrow": "Try-It Lab", "analyticsNote": "Nothing personal leaves this machine.", "video": "tour.mp4"}
    r = client.put("/api/courses/sample", json={"mode": "sequential", "welcome": welcome})
    assert r.status_code == 200
    cj = json.loads((env / "sample" / "course.json").read_text(encoding="utf-8"))
    assert cj["mode"] == "sequential"
    assert cj["welcome"] == welcome
    # Emptying the block removes the key instead of leaving "welcome": {} behind.
    assert client.put("/api/courses/sample", json={"welcome": {}}).status_code == 200
    assert "welcome" not in json.loads((env / "sample" / "course.json").read_text(encoding="utf-8"))


def test_put_course_rejects_unknown_mode(env, client):
    assert client.put("/api/courses/sample", json={"mode": "random"}).status_code == 400


def test_save_lab_timing_is_author_owned(env, client):
    body = "# Intro\n\n## Step one\n\n## Step two\n"
    # An author-set timing is stored and survives later guide saves
    # (the same rule scripts/stamp-manifests.mjs applies on disk).
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": body, "manifest": {"estimatedMinutes": 45}})
    assert r.status_code == 200 and r.json()["manifest"]["estimatedMinutes"] == 45
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": body + "\n## Step three\n"})
    assert r.json()["manifest"]["stepCount"] == 3
    assert r.json()["manifest"]["estimatedMinutes"] == 45
    # null hands the estimate back to the step-count heuristic (10 + 2/step, to the nearest 5).
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": body, "manifest": {"estimatedMinutes": None}})
    assert r.json()["manifest"]["estimatedMinutes"] == 15
    # Bad values are refused before anything is written.
    before = (env / "sample" / "01-intro" / "guide.md").read_text(encoding="utf-8")
    for bad in (0, 601, 12.5, "20", True):
        r = client.put("/api/courses/sample/labs/01-intro", json={"body": "# changed", "manifest": {"estimatedMinutes": bad}})
        assert r.status_code == 400, bad
    assert (env / "sample" / "01-intro" / "guide.md").read_text(encoding="utf-8") == before


# ── save safety: manifest-only saves and the stale-tab conflict guard ──

def test_get_lab_carries_body_hash_and_manifest_only_save_leaves_guide(env, client):
    d = client.get("/api/courses/sample/labs/01-intro").json()
    assert d["bodyHash"] and len(d["bodyHash"]) == 40
    before = (env / "sample" / "01-intro" / "guide.md").read_text(encoding="utf-8")
    # body: null → the manifest changes, the guide on disk does not.
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": None, "manifest": {"estimatedMinutes": 25}})
    assert r.status_code == 200 and r.json()["manifest"]["estimatedMinutes"] == 25
    assert (env / "sample" / "01-intro" / "guide.md").read_text(encoding="utf-8") == before
    assert r.json()["body"] == before and r.json()["bodyHash"] == d["bodyHash"]


def test_save_lab_refuses_stale_tab_unless_forced(env, client):
    d = client.get("/api/courses/sample/labs/01-intro").json()
    # Tab B saves first.
    assert client.put("/api/courses/sample/labs/01-intro", json={"body": "# Newer text from tab B"}).status_code == 200
    # Tab A still holds the old hash and tries to save different text: refused, disk untouched.
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": "# Tab A text", "baseHash": d["bodyHash"]})
    assert r.status_code == 409 and "changed on disk" in r.json()["detail"]
    assert (env / "sample" / "01-intro" / "guide.md").read_text(encoding="utf-8") == "# Newer text from tab B"
    # Saving text identical to the disk copy is never a conflict.
    assert client.put("/api/courses/sample/labs/01-intro", json={"body": "# Newer text from tab B", "baseHash": d["bodyHash"]}).status_code == 200
    # force overwrites on purpose.
    r = client.put("/api/courses/sample/labs/01-intro", json={"body": "# Tab A text", "baseHash": d["bodyHash"], "force": True})
    assert r.status_code == 200 and r.json()["body"] == "# Tab A text"
    # No baseHash (older clients / scripts) keeps the old last-writer-wins behaviour.
    assert client.put("/api/courses/sample/labs/01-intro", json={"body": "# Script text"}).status_code == 200


def test_count_steps_matches_what_the_learner_can_tick():
    """The editor stamps stepCount on every save, so this copy of the
    rule is the one that reaches most manifests - and it was wrong.

    It counted reference headings the Engine never draws a checkbox
    for, so a lab with a "Lab Files" section carried a stepCount one
    higher than the learner could possibly complete, and the progress
    bar finished at 3 of 4. The same cases are pinned against the
    Content Manager's two copies in its guideBody.test.ts; neither file
    can import across the two repositories.
    """
    assert core.count_steps("## One\n\n### Two\n") == 2
    # Named reference material.
    assert core.count_steps("## One\n\n## Lab Files\n\n## Verify your work\n") == 1
    # The author's own opt-out - Troubleshooting is the case it exists for.
    assert core.count_steps("## One\n\n## Troubleshooting <!-- no-step -->\n") == 1
    # Spelling of the marker must not matter.
    assert core.count_steps("## A <!--no-step-->\n\n## B <!--  No-Step  -->\n\n## C\n") == 1
    # A heading inside a fence is shell output, not a step.
    assert core.count_steps("## Real\n\n```\n## Fake\n```\n") == 1


def test_an_untracked_heading_keeps_its_text():
    # The marker is stripped for the decision, never from the guide: the
    # heading still reads "Troubleshooting", still gets an anchor, and
    # still appears in "On this page". It loses the checkbox, nothing
    # else.
    assert core.is_step_heading("Troubleshooting") is True
    assert core.is_step_heading("Troubleshooting <!-- no-step -->") is False
    assert core.is_step_heading("Lab Files") is False


def test_detect_has_video_matches_every_host_the_engine_embeds():
    # The guide renders vimeo.com links as a player (VideoEmbed.tsx), so the
    # sidebar's play badge must agree — Vimeo joined Loom, YouTube and local
    # files here on 2026-09-07 after a Vimeo embed left the badge dark.
    assert core.detect_has_video("![Tour](https://vimeo.com/123456789)")
    assert core.detect_has_video("![Tour](https://vimeo.com/123456789/abcdef0123#t=1m30s)")
    assert core.detect_has_video("[Watch](https://player.vimeo.com/video/123456789?h=abcdef0123)")
    assert core.detect_has_video("![Tour](https://www.loom.com/share/abc123def456)")
    assert core.detect_has_video("![Tour](https://youtu.be/dQw4w9WgXcQ)")
    assert core.detect_has_video("![Clip](files/clip.mp4)")
    # A Vimeo page with no video id, plain prose, and a fenced example are not embeds.
    assert not core.detect_has_video("Background reading: https://vimeo.com/about")
    assert not core.detect_has_video("No video in this lab.")
    assert not core.detect_has_video("```markdown\n![Tour](https://vimeo.com/123456789)\n```")


# -- Installability: state dir, re-pointing, preflight, the built UI ---
#
# Everything below is what separates "runs from the checkout that built
# it" from "installs on a machine that has never seen it". A checkout
# exercises none of it by accident, which is exactly why it is tested.

def test_state_dir_precedence(tmp_path, monkeypatch):
    import paths

    # 1. An explicit answer wins outright.
    explicit = tmp_path / "chosen"
    monkeypatch.setenv("EDITOR_STATE_DIR", str(explicit))
    paths.reset()
    assert paths.state_dir() == explicit.resolve()
    assert explicit.is_dir()          # created, not merely named

    # 2. Otherwise api/ itself, WHEN WRITABLE - which is what keeps a
    #    checkout reading and writing the settings.json it always has.
    monkeypatch.delenv("EDITOR_STATE_DIR", raising=False)
    paths.reset()
    assert paths.state_dir() == paths.API_DIR.resolve()

    # 3. And the per-user directory when it is not, which is the install.
    monkeypatch.setattr(paths, "_writable", lambda d: False)
    monkeypatch.setattr(paths, "_per_user", lambda: tmp_path / "appdata")
    paths.reset()
    assert paths.state_dir() == (tmp_path / "appdata").resolve()
    paths.reset()


def test_state_dir_is_where_settings_and_the_publish_cache_live(tmp_path, monkeypatch):
    # The point of paths.py: nothing is written under the install. Both
    # files are module constants bound at import, so this asserts the
    # wiring rather than re-deriving it.
    import paths
    from routers import publish

    assert providers.SETTINGS_PATH.parent == paths.state_dir()
    assert publish.CACHE_DIR.parent == paths.state_dir()


def test_missing_courses_dir_is_reported_not_fatal(env, client, monkeypatch, tmp_path):
    # It used to raise at import, which killed uvicorn before the window
    # could open and left the author with "can't reach the API".
    monkeypatch.setattr(core, "REPO_ROOT", tmp_path / "nowhere")
    monkeypatch.setattr(core, "COURSES_DIR", tmp_path / "nowhere" / "courses")

    health = client.get("/api/health").json()
    assert health["ok"] is True and health["needsSetup"] is True

    setup = client.get("/api/setup").json()
    assert setup["valid"] is False
    assert "No folder at" in setup["reason"]
    # Installed, the sibling-directory default resolves inside Program
    # Files and has never existed. Offering it as the suggestion sends
    # the author hunting for a folder nobody has.
    monkeypatch.setattr(core, "DEFAULT_REPO", tmp_path / "also-nowhere")
    assert client.get("/api/setup").json()["defaultRepo"] == ""


def test_set_repo_root_accepts_a_checkout_and_refuses_a_stranger(env, tmp_path, monkeypatch):
    monkeypatch.setattr(providers, "SETTINGS_PATH", tmp_path / "settings.json")

    good = env.parent                      # the fixture's repo root: has courses/
    core.set_repo_root(good)
    assert core.REPO_ROOT == good.resolve()
    assert core.COURSES_DIR == (good / "courses").resolve()
    # Persisted, so the next start comes back to the same place.
    assert providers.load_settings()["pcmRepo"] == str(good.resolve())

    with pytest.raises(HTTPException) as raised:
        core.set_repo_root(tmp_path / "not-a-repo")
    assert raised.value.status_code == 400
    # The old folder is still in force - a refused change changes nothing.
    assert core.REPO_ROOT == good.resolve()


def test_setup_names_what_each_missing_piece_costs(env, client, monkeypatch):
    # A content-only clone on a machine with neither tool: still a usable
    # editor, and it says so once instead of failing four times later.
    monkeypatch.setattr(core, "scaffolding_available", lambda root=None: False)
    monkeypatch.setattr(tools, "find", lambda tool: None)

    out = client.get("/api/setup").json()
    assert out["valid"] is True             # courses are there; that is what matters
    assert out["scaffolding"] is False
    assert out["tools"]["node"]["found"] is False
    assert any("New Course" in u for u in out["unavailable"])
    assert any("Publish" in u for u in out["unavailable"])

    # With both tools and the scripts present there is nothing to warn about.
    monkeypatch.setattr(core, "scaffolding_available", lambda root=None: True)
    monkeypatch.setattr(tools, "find", lambda tool: rf"C:\fake\{tool}.exe")
    assert client.get("/api/setup").json()["unavailable"] == []


def test_node_is_resolved_at_call_time_with_a_bundle_winning(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "BUNDLE_DIR", tmp_path)
    # No Content Manager install in this test's world, or the real one on
    # the developer's machine answers and the assertions below are about
    # somebody else's disk.
    monkeypatch.setattr(tools, "pcm_install", lambda: None)
    monkeypatch.setattr(tools.shutil, "which", lambda name: rf"C:\path\{name}.exe")
    # Nothing bundled: PATH answers.
    assert tools.node() == r"C:\path\node.exe"
    # A bundled copy takes precedence - the seam vendoring lands on.
    bundled = tmp_path / "node"
    bundled.mkdir()
    (bundled / "node.exe").write_text("")
    assert tools.node() == str(bundled / "node.exe")
    assert tools.status()["node"]["bundled"] is True


def test_the_content_manager_install_answers_before_path(tmp_path, monkeypatch):
    """Where both runtimes come from now.

    The editor stopped vendoring Node and git: the learner app installs
    both, it is the one-time install of the pair, and two apps side by
    side were carrying two copies of the same 177 MB. So its install is
    searched between the (empty) bundle seam and PATH.
    """
    pcm = tmp_path / "Pentaho Content Manager"
    (pcm / "mingit" / "cmd").mkdir(parents=True)
    (pcm / "mingit" / "cmd" / "git.exe").write_text("")
    (pcm / "node").mkdir()
    (pcm / "node" / "node.exe").write_text("")
    monkeypatch.setattr(tools, "BUNDLE_DIR", tmp_path / "nothing-bundled")
    monkeypatch.setattr(tools, "pcm_install", lambda: pcm)
    monkeypatch.setattr(tools.shutil, "which", lambda name: rf"C:\path\{name}.exe")

    assert tools.git() == str(pcm / "mingit" / "cmd" / "git.exe")
    assert tools.node() == str(pcm / "node" / "node.exe")
    assert tools.status()["git"]["source"] == "content-manager"
    assert tools.status()["node"]["source"] == "content-manager"

    # A Content Manager from before it vendored Node has no node\, and
    # that must degrade to PATH rather than to nothing - every install
    # of the learner app predating this change is in that state.
    (pcm / "node" / "node.exe").unlink()
    assert tools.node() == r"C:\path\node.exe"
    assert tools.status()["node"]["source"] == "path"
    assert tools.status()["git"]["source"] == "content-manager"


def test_the_content_manager_can_be_pointed_at_without_the_registry(tmp_path, monkeypatch):
    # For a portable copy, and so this suite never depends on what is
    # installed on the machine running it.
    monkeypatch.setenv("PCM_INSTALL_DIR", str(tmp_path))
    assert tools.pcm_install() == tmp_path
    monkeypatch.setenv("PCM_INSTALL_DIR", str(tmp_path / "not-there"))
    assert tools.pcm_install() is None


def test_missing_node_explains_what_still_works(env, client, monkeypatch):
    monkeypatch.setattr(tools, "find", lambda tool: None)
    r = client.post("/api/courses", json={"title": "New One", "kind": "workshop"})
    assert r.status_code == 500
    detail = r.json()["detail"]
    assert "Node.js was not found" in detail and "Editing and saving do not" in detail


def test_the_built_ui_is_served_only_once_it_is_built(tmp_path):
    from fastapi import FastAPI
    import app as appmod

    # Nothing built - a checkout mid-development, where Vite serves it.
    assert appmod.mount_ui(FastAPI(), tmp_path) is False

    (tmp_path / "index.html").write_text("<!doctype html><title>editor</title>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")

    built = FastAPI()
    assert appmod.mount_ui(built, tmp_path) is True
    c = TestClient(built)
    # An unknown API path is a 404, never the SPA: a mistyped endpoint
    # answering HTML with a 200 surfaces as a JSON parse error three
    # layers from the cause. Found by curling a GET at a POST endpoint.
    assert c.get("/api/nope").status_code == 404
    # The hashed asset is served as itself, not swallowed by the catch-all.
    assert c.get("/assets/index-abc123.js").text == "console.log(1)"
    # Anything else is the SPA.
    assert "<title>editor</title>" in c.get("/").text
    assert "<title>editor</title>" in c.get("/some/deep/link").text
    # ...and it is never cached. index.html names content-hashed assets,
    # so a cached copy outlives the files it points at: after an upgrade
    # a webview holding the old one asks for a bundle that install
    # deleted. Caught in the flesh while verifying the first-run screen,
    # where a stale index served a JS file that no longer existed.
    assert c.get("/").headers["cache-control"] == "no-store"


# -- Grounding is reference, never material ---------------------------
#
# The documentation block used to be appended to the END of every prompt,
# which is where a model looks for the thing it was asked to work on. It
# cost two bugs: a review that reported a Critical problem with the
# "Relevant Pentaho documentation" section of a lab that had no such
# section, and a rewrite that wrote 4,000 characters of documentation
# links into a guide. One assembler now, and these hold the order.

GROUND = "\n\nRelevant Pentaho documentation (ground your answer in this):\n- A page (http://docs/x)"


def test_grounded_prompt_puts_the_content_last_and_the_docs_before_it():
    p = core.grounded_prompt("Do the thing.", GROUND, "the passage", "PASSAGE")
    assert p.rstrip().endswith("---END PASSAGE---")
    assert p.index("Relevant Pentaho") < p.index("BEGIN PASSAGE")
    # Saying so is the other half of the fix.
    assert "REFERENCE ONLY" in p


def test_grounded_prompt_without_grounding_or_content():
    # Grounding off: no reference block, no note about one.
    assert core.grounded_prompt("Instructions.", "", "text") == (
        "Instructions.\n\n---BEGIN PASSAGE---\ntext\n---END PASSAGE---"
    )
    # Generation has no passage to fence - just instructions and docs.
    out = core.grounded_prompt("Write a lab.", GROUND)
    assert "BEGIN" not in out and "REFERENCE ONLY" in out


def test_rewrite_and_review_send_the_docs_before_the_text(env, client, monkeypatch):
    """The regression, end to end, at both call sites."""
    from routers import ai as ai_router

    seen = {}

    def capture(prompt, system, timeout=240):
        seen["prompt"] = prompt
        return "OUT"

    monkeypatch.setattr(providers, "generate", capture)
    # Patched on the ROUTER, not on core: ai.py does `from core import
    # _ground`, so it holds its own binding and a patch of core._ground
    # would never be seen. (The same reason core's own docstring insists
    # COURSES_DIR is read as an attribute at call time.)
    monkeypatch.setattr(ai_router, "_ground", lambda q: (GROUND, []))

    client.post("/api/rewrite", json={"text": "the passage to fix"})
    assert seen["prompt"].index("Relevant Pentaho") < seen["prompt"].index("the passage to fix")
    assert seen["prompt"].rstrip().endswith("---END PASSAGE---")

    seen.clear()
    client.post("/api/review", json={"body": "# A guide\n\nWith a step."})
    assert seen["prompt"].index("Relevant Pentaho") < seen["prompt"].index("# A guide")
    assert seen["prompt"].rstrip().endswith("---END GUIDE---")

# -- Finding a checkout for the first-run screen ----------------------

def _make_repo(root, name, scripts=True):
    repo = root / name
    (repo / "courses").mkdir(parents=True)
    if scripts:
        (repo / "scripts").mkdir()
        (repo / "scripts" / "new-course.mjs").write_text("// scaffolder")
    return repo


def test_candidates_prefer_a_checkout_that_can_scaffold(tmp_path, monkeypatch):
    # Two usable folders: one full checkout, one content-only clone. Both
    # are offered - the editor is genuinely useful against either - but
    # the one that can scaffold and verify goes first.
    roots = tmp_path / "roots"
    roots.mkdir()
    _make_repo(roots, "content-only", scripts=False)
    _make_repo(roots, "Pentaho-Content-Manager", scripts=True)
    (roots / "not-a-repo").mkdir()

    monkeypatch.setattr(core, "_candidate_roots", lambda: [roots])
    found = core.find_repo_candidates()

    assert [Path(c["path"]).name for c in found] == ["Pentaho-Content-Manager", "content-only"]
    assert [c["scaffolding"] for c in found] == [True, False]


def test_candidates_skip_unreadable_roots_and_never_repeat_one(tmp_path, monkeypatch):
    roots = tmp_path / "roots"
    roots.mkdir()
    repo = _make_repo(roots, "Pentaho-Content-Manager")

    # The same root listed twice, plus one that does not exist at all -
    # a disconnected drive, a stale path in the list. Neither may break
    # the screen that exists to rescue the situation.
    monkeypatch.setattr(core, "_candidate_roots",
                        lambda: [roots, roots, tmp_path / "gone"])
    found = core.find_repo_candidates()
    assert [c["path"] for c in found] == [str(repo.resolve())]


def test_candidates_put_a_worktree_last_and_keep_the_order_found(tmp_path, monkeypatch):
    # The main checkout and a worktree of it on a release branch. Ties
    # used to break by path. Python compares paths ordinally, upper case
    # first, so the real "pcm-060" happened to sort AFTER
    # "Pentaho-Content-Manager" here (the installer's PowerShell sort is
    # case-insensitive and put it first). These names sort first under
    # either rule, so this fails against a path sort. A worktree has a
    # .git FILE.
    roots = tmp_path / "roots"
    roots.mkdir()
    main = _make_repo(roots, "Pentaho-Content-Manager")
    (main / ".git").mkdir()
    worktree = _make_repo(roots, "PCM-060")
    (worktree / ".git").write_text("gitdir: C:/elsewhere/.git/worktrees/PCM-060\n")
    other = _make_repo(roots, "Another-clone")
    (other / ".git").mkdir()

    monkeypatch.setattr(core, "_candidate_roots", lambda: [roots])
    found = core.find_repo_candidates()

    names = [Path(c["path"]).name for c in found]
    assert names[-1] == "PCM-060"
    # The named checkout is looked at first and wins the tie with another
    # full clone; by path, "Another-clone" would have.
    assert names[0] == "Pentaho-Content-Manager"
    assert [c["worktree"] for c in found] == [False, False, True]


def test_setup_offers_candidates_only_when_lost(env, client, monkeypatch, tmp_path):
    monkeypatch.setattr(core, "find_repo_candidates",
                        lambda limit=6: [{"path": "C:\somewhere", "scaffolding": True}])

    # Pointed at a good repo: no scan, no offers. This endpoint is polled
    # at every boot, and an editor that knows where its courses are has
    # no reason to go hunting for others.
    assert client.get("/api/setup").json()["candidates"] == []

    monkeypatch.setattr(core, "REPO_ROOT", tmp_path / "nowhere")
    monkeypatch.setattr(core, "COURSES_DIR", tmp_path / "nowhere" / "courses")
    out = client.get("/api/setup").json()
    assert out["valid"] is False
    assert out["candidates"] == [{"path": "C:\somewhere", "scaffolding": True}]


# -- The Content Manager pill: how the checkout stands ----------------

def test_repo_status_is_never_fatal(env, client, monkeypatch, tmp_path):
    """Every unusable state is a state the pill can render, not an error.

    The editor works fine on a folder git has never heard of, and a
    header that interrupts editing to complain about version control
    would be worse than one that says nothing.
    """
    from routers import repo as repo_router

    # No git on the machine at all.
    monkeypatch.setattr(tools, "git", lambda: None)
    out = client.get("/api/repo/status").json()
    assert out["state"] == "no-git" and "git was not found" in out["detail"]

    # git present, but the folder is not a checkout.
    monkeypatch.setattr(tools, "git", lambda: "C:\fake\git.exe")
    monkeypatch.setattr(repo_router, "_git", lambda *a, **k: (1, "not a repository"))
    out = client.get("/api/repo/status").json()
    assert out["state"] == "no-repo"

    # The folder is gone entirely.
    monkeypatch.setattr(core, "REPO_ROOT", tmp_path / "vanished")
    assert client.get("/api/repo/status").json()["state"] == "no-repo"


def test_repo_status_counts_behind_and_ahead(env, client, monkeypatch):
    from routers import repo as repo_router

    monkeypatch.setattr(tools, "git", lambda: "C:\fake\git.exe")

    def fake_git(args, cwd, timeout=10):
        if args[0] == "rev-parse" and args[1] == "--is-inside-work-tree":
            return 0, "true"
        if args[0] == "status":
            return 0, " M courses/x/guide.md"
        if args[:2] == ["rev-parse", "--abbrev-ref"] and args[-1] == "HEAD":
            return 0, "main"
        if args[-1] == "@{u}":
            return 0, "origin/main"
        if args[0] == "rev-list":
            # left = upstream has and we do not, right = ours.
            return 0, "3	1"
        return 0, ""

    monkeypatch.setattr(repo_router, "_git", fake_git)
    out = client.get("/api/repo/status").json()
    assert out["state"] == "diverged"
    assert out["behind"] == 3 and out["ahead"] == 1
    assert out["dirty"] is True
    assert out["branch"] == "main" and out["upstream"] == "origin/main"


def test_repo_status_only_fetches_when_asked(env, client, monkeypatch):
    """A network round trip on every header render is not acceptable."""
    from routers import repo as repo_router

    monkeypatch.setattr(tools, "git", lambda: "C:\fake\git.exe")
    calls = []

    def fake_git(args, cwd, timeout=10):
        calls.append(args[0])
        if args[0] == "rev-parse" and args[1] == "--is-inside-work-tree":
            return 0, "true"
        if args[:2] == ["rev-parse", "--abbrev-ref"] and args[-1] == "HEAD":
            return 0, "main"
        if args[-1] == "@{u}":
            return 0, "origin/main"
        if args[0] == "rev-list":
            return 0, "0	0"
        return 0, ""

    monkeypatch.setattr(repo_router, "_git", fake_git)

    assert client.get("/api/repo/status").json()["state"] == "current"
    assert "fetch" not in calls

    calls.clear()
    assert client.get("/api/repo/status?fetch=true").json()["fetched"] is True
    assert "fetch" in calls


def test_a_failed_fetch_still_reports_the_last_known_state(env, client, monkeypatch):
    # A laptop off the VPN is the normal case for this call, not an error.
    from routers import repo as repo_router

    monkeypatch.setattr(tools, "git", lambda: "C:\fake\git.exe")

    def fake_git(args, cwd, timeout=10):
        if args[0] == "fetch":
            return 1, "could not resolve host"
        if args[0] == "rev-parse" and args[1] == "--is-inside-work-tree":
            return 0, "true"
        if args[:2] == ["rev-parse", "--abbrev-ref"] and args[-1] == "HEAD":
            return 0, "main"
        if args[-1] == "@{u}":
            return 0, "origin/main"
        if args[0] == "rev-list":
            return 0, "2	0"
        return 0, ""

    monkeypatch.setattr(repo_router, "_git", fake_git)
    out = client.get("/api/repo/status?fetch=true").json()
    assert out["fetched"] is False
    assert out["state"] == "behind" and out["behind"] == 2
    assert "Couldn't reach the remote" in out["detail"]


def test_the_installer_hint_sits_below_the_author_s_own_choice(tmp_path, monkeypatch):
    """Precedence: environment, then the saved setting, then the hint.

    The installer records a checkout it found so the first launch is
    already configured. It must never outrank a choice the author made:
    a hint is what the machine guessed, and the settings file is what a
    person decided.
    """
    hint = tmp_path / "hinted"
    (hint / "courses").mkdir(parents=True)
    saved = tmp_path / "chosen"
    (saved / "courses").mkdir(parents=True)

    monkeypatch.setattr(core, "installer_hint", lambda: hint)
    monkeypatch.delenv("PCM_REPO", raising=False)

    # Nothing saved: the hint is used.
    monkeypatch.setattr(providers, "load_settings", lambda: {"pcmRepo": ""})
    assert core._resolve_repo_root() == hint.resolve()

    # The author picked one: the hint loses.
    monkeypatch.setattr(providers, "load_settings", lambda: {"pcmRepo": str(saved)})
    assert core._resolve_repo_root() == saved.resolve()

    # The environment beats both.
    monkeypatch.setenv("PCM_REPO", str(tmp_path / "from-env"))
    assert core._resolve_repo_root() == (tmp_path / "from-env").resolve()


def test_a_hint_pointing_at_nothing_is_ignored(tmp_path, monkeypatch):
    # A folder that has since moved or been deleted must not become the
    # answer - the first-run screen is a better outcome than an editor
    # pointed at a path that is not there.
    monkeypatch.delenv("PCM_REPO", raising=False)
    monkeypatch.setattr(providers, "load_settings", lambda: {"pcmRepo": ""})
    monkeypatch.setattr(core, "installer_hint", lambda: tmp_path / "gone")
    assert core._resolve_repo_root() == core.DEFAULT_REPO.resolve()


# ── exam settings ───────────────────────────────────────────────────

def _exam(env, **over):
    """Give the sample course an exam.json with a two-question pool."""
    exam = {
        "title": "Practitioner Exam",
        "passMark": 80,
        "questionsPerAttempt": 2,
        "shuffle": True,
        "webhookUrl": "https://script.google.com/macros/s/AAA/exec",
        "webhookSecret": "pcm_secret",
        "intake": {"collectCandidate": True, "consent": True},
        "questions": [{"id": "q1"}, {"id": "q2"}],
    }
    exam.update(over)
    (env / "sample" / "exam.json").write_text(json.dumps(exam), encoding="utf-8")
    return exam


def test_get_exam_omits_questions_but_counts_them(env, client):
    _exam(env)
    body = client.get("/api/courses/sample/exam").json()
    assert body["exists"] is True
    assert body["questionCount"] == 2
    assert "questions" not in body
    assert body["webhookUrl"].endswith("/exec")
    assert body["intake"]["collectCandidate"] is True


def test_get_exam_reports_a_course_without_one(env, client):
    body = client.get("/api/courses/sample/exam").json()
    assert body == {"exists": False, "questionCount": 0}


def test_put_exam_keeps_the_question_pool(env, client):
    # The dialog never sends `questions`; a partial PUT must not wipe it.
    _exam(env)
    r = client.put("/api/courses/sample/exam", json={"passMark": 70})
    assert r.status_code == 200 and r.json()["passMark"] == 70
    saved = json.loads((env / "sample" / "exam.json").read_text())
    assert len(saved["questions"]) == 2


def test_put_exam_preserves_unknown_keys(env, client):
    _exam(env, somethingNew={"keep": "me"})
    client.put("/api/courses/sample/exam", json={"title": "Renamed"})
    saved = json.loads((env / "sample" / "exam.json").read_text())
    assert saved["somethingNew"] == {"keep": "me"}


def test_put_exam_rejects_a_pass_mark_out_of_range(env, client):
    _exam(env)
    assert client.put("/api/courses/sample/exam", json={"passMark": 140}).status_code == 400
    assert client.put("/api/courses/sample/exam", json={"passMark": -1}).status_code == 400


def test_put_exam_rejects_more_questions_than_the_pool_holds(env, client):
    # An exam that draws 40 from a pool of 2 cannot be sat.
    _exam(env)
    r = client.put("/api/courses/sample/exam", json={"questionsPerAttempt": 40})
    assert r.status_code == 400 and "pool" in r.json()["detail"]


def test_put_exam_rejects_a_plaintext_webhook(env, client):
    # Results carry candidate details and the outbox retries on failure.
    _exam(env)
    r = client.put("/api/courses/sample/exam", json={"webhookUrl": "http://example.com/x"})
    assert r.status_code == 400


def test_put_exam_allows_clearing_the_webhook(env, client):
    _exam(env)
    r = client.put("/api/courses/sample/exam", json={"webhookUrl": ""})
    assert r.status_code == 200 and r.json()["webhookUrl"] == ""


def test_put_exam_refuses_a_secret(env, client):
    _exam(env)
    before = (env / "sample" / "exam.json").read_text()
    r = client.put("/api/courses/sample/exam", json={"webhookSecret": "pcm_new"})
    assert r.status_code == 400 and "secrets file" in r.json()["detail"]
    assert "pcm_new" not in r.json()["detail"]
    assert (env / "sample" / "exam.json").read_text() == before  # nothing written


def test_put_exam_drops_a_leftover_secret(env, client):
    # The fixture models a pre-0.7.2 file that still carries one.
    _exam(env)
    r = client.put("/api/courses/sample/exam", json={"title": "Renamed"})
    assert r.status_code == 200
    saved = json.loads((env / "sample" / "exam.json").read_text())
    assert "webhookSecret" not in saved and saved["title"] == "Renamed"
    assert saved["webhookUrl"].endswith("/exec")


def test_published_secrets_rule():
    from published_secrets import published_secrets
    assert published_secrets({"analytics": {"measurementId": "G-1", "apiSecret": "s"}}) == ["analytics.apiSecret"]
    assert published_secrets({"webhookSecret": "", "x": {"token": "  "}}) == []
    assert published_secrets({"webhookUrl": "https://script.google.com/macros/s/A/exec"}) == []
    assert published_secrets({"v": "https://vimeo.com/1/abc?share=copy"}) == []
    assert published_secrets({"u": "https://a.logic.azure.com/x?sp=1&sig=Z"}) == ["u"]
    assert published_secrets({"items": [{"apiKey": "k"}]}) == ["items[0].apiKey"]


def test_put_exam_404s_without_an_exam_file(env, client):
    assert client.put("/api/courses/sample/exam", json={"passMark": 50}).status_code == 404
