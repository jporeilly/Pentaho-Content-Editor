"""Publish a course to the central Pentaho-Courses distribution repo.

Authoring stays in this repo's ``courses/`` directory; workshop VMs pull
from the distribution repo (see docs/GIT-SOURCE.md). This router closes
the loop from the editor UI:

  • GET  /api/courses/{course}/publish/diff  — what would change upstream
  • POST /api/courses/{course}/publish       — copy the course in, commit, push
  • POST /api/publish/tag                    — tag the repo (pin workshop images)

A persistent shallow clone is kept beside the editor's own settings
(``api/.publish-cache/`` in a checkout, ``%APPDATA%`` installed — see
paths.py) and
freshened (fetch + hard reset) before every operation, so diffs are
always against the repo's current HEAD and pushes are fast-forward.
Auth is whatever git already has on the author's machine (credential
manager / gh). Git runs with prompts disabled — a missing credential
fails fast instead of hanging uvicorn.

Tests monkeypatch ``publish.REPO_URL`` (and CACHE_DIR) to a local bare
repo — same attribute-access-at-call-time rule as ``core.COURSES_DIR``.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from collections.abc import Container
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import core
import paths
import tools
from core import _course_dir

router = APIRouter()

REPO_URL = "https://github.com/jporeilly/Pentaho-Courses.git"
REPO_REF = "main"
CACHE_DIR = paths.state_dir() / ".publish-cache"
GIT_TIMEOUT_SECS = 180

# Files/dirs never copied or diffed (VCS internals, local junk).
_SKIP_PARTS = {".git", "__pycache__", ".venv", ".DS_Store", "Thumbs.db"}

_TAG_RE = re.compile(r"^v[0-9A-Za-z][0-9A-Za-z._-]{0,63}$")


def _git(args: list[str], cwd: Path | None = None) -> str:
    """Run git non-interactively; raise HTTPException(502) on failure."""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    # Read at call time, and a bundled copy wins over PATH — the shape the
    # Content Manager uses for the MinGit it ships. See tools.py.
    git = tools.git()
    if not git:
        raise HTTPException(500, "git was not found — Publish needs it. Install git and restart the editor.")
    try:
        proc = subprocess.run(
            [git, "-c", "credential.interactive=false", "-c", "core.longpaths=true", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True, text=True, encoding="utf-8",
            timeout=GIT_TIMEOUT_SECS, env=env,
        )
    except FileNotFoundError:
        raise HTTPException(500, f"`{git}` could not be run — the git install looks broken.")
    except subprocess.TimeoutExpired:
        raise HTTPException(502, f"git {' '.join(args[:2])} timed out after {GIT_TIMEOUT_SECS}s")
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()[-800:]
        raise HTTPException(502, f"git {' '.join(args[:2])} failed: {detail}")
    return proc.stdout.strip()


def _fresh_clone() -> Path:
    """Return the cache clone, freshly synced to origin/REPO_REF.

    Any failure updating an existing cache wipes it and retries with one
    fresh clone (heals stale locks / interrupted fetches), mirroring the
    learner app's git-cache behaviour.
    """
    cache = CACHE_DIR
    if (cache / ".git").is_dir():
        try:
            origin = _git(["remote", "get-url", "origin"], cache)
            if origin.strip() == REPO_URL:
                _git(["fetch", "--quiet", "origin", REPO_REF], cache)
                _git(["checkout", "--quiet", REPO_REF], cache)
                _git(["reset", "--quiet", "--hard", f"origin/{REPO_REF}"], cache)
                # -x too: an ignored leftover from an earlier copy-in
                # would otherwise pass for a published file (_publishable).
                _git(["clean", "--quiet", "-fdx"], cache)
                return cache
        except HTTPException:
            pass  # fall through to re-clone
        shutil.rmtree(cache, ignore_errors=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(cache, ignore_errors=True)
    _git(["clone", "--quiet", "--branch", REPO_REF, REPO_URL, str(cache)])
    return cache


def _file_digest(path: Path) -> str:
    """Content hash, insensitive to CRLF/LF for text files.

    git normalises line endings between the working tree and the object
    store (core.autocrlf), so the same committed file can legitimately
    read back with different endings in ``courses/`` vs the publish
    clone. Hash text with endings normalised — otherwise every text
    file looks "modified" forever on Windows. Binary files (anything
    with a NUL in the first 8 KiB, like git's own heuristic) hash raw.
    """
    with path.open("rb") as f:
        head = f.read(8192)
        if b"\0" in head:  # binary — hash raw, streamed
            h = hashlib.sha256(head)
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        else:  # text — small enough to normalise in one read
            h = hashlib.sha256((head + f.read()).replace(b"\r\n", b"\n"))
    return h.hexdigest()


def _walk_files(root: Path) -> dict[str, Path]:
    """Relative-posix-path → absolute path for every publishable file."""
    out: dict[str, Path] = {}
    if not root.is_dir():
        return out
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part in _SKIP_PARTS for part in rel.parts):
            continue
        # A course-root README.md is the internal ops runbook (e.g. the
        # try-it lab's marketing checklist) - authoring-repo only, never
        # published to the distribution repo learners sync from. Nested
        # README.md files (inside files/ etc.) still publish.
        if rel.as_posix().lower() == "readme.md":
            continue
        out[rel.as_posix()] = path
    return out


def _ignored_files(local: Path) -> set[str]:
    """Course-relative paths of the untracked files .gitignore keeps out.

    Asked of git rather than re-implemented, so every rule counts: the
    Content Manager's root .gitignore, a workshop's nested one,
    .git/info/exclude. Tracked files are never listed - a file force-added
    with ``git add -f`` is published like any other.
    """
    try:
        out = _git(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", "."], local)
    except HTTPException as e:
        # Fail closed: without the ignore rules, a .env or a secrets file
        # in a workshop's files/ would go to a PUBLIC repo.
        raise HTTPException(e.status_code, (
            f"Publish could not read the .gitignore rules for {local}, so it cannot "
            "tell which files must stay private. The courses must be in a git checkout "
            f"of the Content Manager. ({e.detail})"
        ))
    return {p for p in out.split("\0") if p}


def _publishable(local: Path, published: Container[str]) -> tuple[dict[str, Path], list[str]]:
    """The files a publish copies, and the ignored ones it skips.

    The distribution repo is PUBLIC, and what the authoring repo ignores
    it ignores for a reason - a workshop's .env, a kettle.properties.
    Ignored files are skipped unless already ``published`` (in the
    distribution repo): those were put there on purpose - a .env.template,
    the sample databases a workshop ships - and skipping them would delete
    them from every VM. The skipped list goes back to the author.
    """
    files = _walk_files(local)
    ignored = _ignored_files(local)
    skipped = sorted(rel for rel in files if rel in ignored and rel not in published)
    for rel in skipped:
        del files[rel]
    return files, skipped


def _plan(local: Path, remote: Path) -> tuple[dict[str, Path], dict[str, list[str]]]:
    """What a publish copies, and the diff against the repo copy.

    The diff carries ``skippedIgnored`` beside added / modified / removed;
    only those three are changes.
    """
    remote_files = _walk_files(remote)
    local_files, skipped = _publishable(local, remote_files)
    return local_files, {**_diff_course(local_files, remote_files), "skippedIgnored": skipped}


def _diff_course(local_files: dict[str, Path], remote_files: dict[str, Path]) -> dict[str, list[str]]:
    """Added / modified / removed file lists, local vs the repo copy."""
    added = sorted(k for k in local_files if k not in remote_files)
    removed = sorted(k for k in remote_files if k not in local_files)
    # No size shortcut: CRLF/LF differences change the size of files
    # that are content-identical (see _file_digest).
    modified = sorted(
        k for k in local_files
        if k in remote_files
        and _file_digest(local_files[k]) != _file_digest(remote_files[k])
    )
    return {"added": added, "modified": modified, "removed": removed}


@router.get("/api/publish/config")
def publish_config() -> dict[str, Any]:
    return {"url": REPO_URL, "ref": REPO_REF}


@router.get("/api/courses/{course}/publish/diff")
def publish_diff(course: str) -> dict[str, Any]:
    """What publishing this course would change in the distribution repo."""
    local = _course_dir(course)  # 404 if unknown
    clone = _fresh_clone()
    remote_commit = _git(["rev-parse", "HEAD"], clone)
    _, diff = _plan(local, clone / course)
    up_to_date = not (diff["added"] or diff["modified"] or diff["removed"])
    return {
        "course": course,
        "remoteCommit": remote_commit,
        "newCourse": not (clone / course).is_dir(),
        "upToDate": up_to_date,
        **diff,
    }


class PublishBody(BaseModel):
    message: str | None = None
    #: Also commit + push the course folder in the AUTHORING repo
    #: (Pentaho-Content-Manager) before publishing — the editor's
    #: "Commit & Publish" one-button flow.
    commit: bool = False


def _commit_authoring(course: str, message: str) -> dict[str, Any]:
    """Commit this course's folder in the authoring repo and push.

    Stages and commits ONLY ``courses/<course>`` (pathspec commit), so
    anything else the author has staged or modified in the repo is
    left untouched. No-op when the folder has no changes.
    """
    root = core.REPO_ROOT
    spec = f"courses/{course}"
    _git(["add", "--", spec], root)
    if not _git(["status", "--porcelain", "--", spec], root).strip():
        return {"committed": False, "upToDate": True}
    _git([
        "-c", "user.name=Pentaho Content Editor",
        "-c", "user.email=jporeilly@users.noreply.github.com",
        "commit", "-m", message, "--", spec,
    ], root)
    commit = _git(["rev-parse", "HEAD"], root)
    _git(["push", "--quiet"], root)
    return {"committed": True, "commit": commit}


@router.post("/api/courses/{course}/publish")
def publish_course(course: str, body: PublishBody | None = None) -> dict[str, Any]:
    """Copy the course into the distribution repo, commit, push.
    With ``commit: true``, first commit + push the authoring repo."""
    local = _course_dir(course)
    message = (body.message.strip() if body and body.message and body.message.strip()
               else f"Update {course} from the Content Editor")
    # Authoring-repo commit first: if the distribution push then fails,
    # the edits are at least safely in history.
    authoring = _commit_authoring(course, message) if body and body.commit else None

    clone = _fresh_clone()
    target = clone / course

    files, diff = _plan(local, target)
    if not (diff["added"] or diff["modified"] or diff["removed"]):
        return {
            "ok": True, "upToDate": True,
            "commit": _git(["rev-parse", "HEAD"], clone),
            "authoring": authoring,
            "skippedIgnored": diff["skippedIgnored"],
        }

    # Replace the course dir wholesale — removals propagate too.
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    for rel, src in files.items():
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    _git(["add", "-A", "--", course], clone)
    _git([
        "-c", "user.name=Pentaho Content Editor",
        "-c", "user.email=jporeilly@users.noreply.github.com",
        "commit", "-m", message,
    ], clone)
    commit = _git(["rev-parse", "HEAD"], clone)
    _git(["push", "--quiet", "origin", REPO_REF], clone)
    return {
        "ok": True,
        "upToDate": False,
        "commit": commit,
        "changed": {k: len(diff[k]) for k in ("added", "modified", "removed")},
        "authoring": authoring,
        "skippedIgnored": diff["skippedIgnored"],
    }


class TagBody(BaseModel):
    tag: str
    message: str | None = None


@router.post("/api/publish/tag")
def publish_tag(body: TagBody) -> dict[str, Any]:
    """Tag the distribution repo's current HEAD (e.g. ``v2026.07``) so
    workshop images can pin to it via ``set-git-source -Ref <tag>``."""
    tag = body.tag.strip()
    if not _TAG_RE.match(tag):
        raise HTTPException(422, "Tag must look like v2026.07 (start with 'v', then letters/digits/._-).")
    clone = _fresh_clone()
    existing = _git(["tag", "--list", tag], clone)
    if existing.strip():
        raise HTTPException(409, f"Tag '{tag}' already exists.")
    message = (body.message or f"Workshop release {tag}").strip()
    _git(["-c", "user.name=Pentaho Content Editor",
          "-c", "user.email=jporeilly@users.noreply.github.com",
          "tag", "-a", tag, "-m", message], clone)
    _git(["push", "--quiet", "origin", tag], clone)
    return {"ok": True, "tag": tag, "commit": _git(["rev-parse", "HEAD"], clone)}
