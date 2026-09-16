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
    root = core.COURSES_DIR.parent
    origin2 = tmp_path / "authoring-origin.git"
    origin2.mkdir()
    _run(["git", "init", "--bare", "-b", "main", "-q"], origin2)
    _run(["git", "init", "-b", "main", "-q"], root)
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


def test_detect_has_video_matches_every_host_the_renderer_embeds():
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
    monkeypatch.setattr(tools.shutil, "which", lambda name: rf"C:\path\{name}.exe")
    # Nothing bundled: PATH answers.
    assert tools.node() == r"C:\path\node.exe"
    # A bundled copy takes precedence - the seam vendoring lands on.
    bundled = tmp_path / "node"
    bundled.mkdir()
    (bundled / "node.exe").write_text("")
    assert tools.node() == str(bundled / "node.exe")
    assert tools.status()["node"]["bundled"] is True


def test_missing_node_explains_what_still_works(env, client, monkeypatch):
    monkeypatch.setattr(tools, "find", lambda tool: None)
    r = client.post("/api/courses", json={"title": "New One", "kind": "workshop"})
    assert r.status_code == 500
    detail = r.json()["detail"]
    assert "Node.js was not found" in detail and "Editing and saving do not" in detail


def test_the_built_ui_is_served_only_once_it_is_built(tmp_path):
    from fastapi import FastAPI
    import app as appmod

    # No dist/ - a checkout mid-development, where Vite serves the UI.
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
