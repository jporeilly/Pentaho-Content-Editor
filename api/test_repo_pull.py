"""POST /api/repo/pull against a real (temporary) remote and clone.

Each test builds a bare "origin", a clone standing in for the Content
Manager checkout (core.REPO_ROOT) and a second clone standing in for
someone else who pushes. Nothing touches a real repository.
"""

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import core
import tools
import app as appmod

pytestmark = pytest.mark.skipif(not tools.git(), reason="git is not on this machine")


def git(cwd: Path, *args: str) -> str:
    proc = subprocess.run(
        [tools.git(), "-c", "user.name=Test", "-c", "user.email=test@example.com",
         "-c", "core.autocrlf=false", *args],
        cwd=str(cwd), capture_output=True, text=True, check=True,
    )
    return proc.stdout.strip()


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def commit(repo: Path, rel: str, text: str, msg: str) -> None:
    write(repo / rel, text)
    git(repo, "add", rel)
    git(repo, "commit", "-q", "-m", msg)


@pytest.fixture
def repos(tmp_path, monkeypatch):
    origin = tmp_path / "origin.git"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    seed = tmp_path / "seed"
    git(tmp_path, "clone", "-q", str(origin), str(seed))
    git(seed, "checkout", "-q", "-b", "main")
    commit(seed, "courses/a/guide.md", "# A\n", "a")
    commit(seed, "courses/b/guide.md", "# B\n", "b")
    git(seed, "push", "-q", "-u", "origin", "main")

    mine = tmp_path / "mine"
    git(tmp_path, "clone", "-q", str(origin), str(mine))
    git(mine, "config", "user.name", "Test")
    git(mine, "config", "user.email", "test@example.com")
    monkeypatch.setattr(core, "REPO_ROOT", mine)
    return {"seed": seed, "mine": mine}


@pytest.fixture
def client():
    return TestClient(appmod.app)


def pull(client):
    r = client.post("/api/repo/pull")
    assert r.status_code == 200
    return r.json()


def test_fast_forward(repos, client):
    commit(repos["seed"], "courses/a/guide.md", "# A v2\n", "a2")
    git(repos["seed"], "push", "-q")

    out = pull(client)
    assert out["ok"] and out["pulled"] == 1
    assert out["status"]["state"] == "current"
    assert (repos["mine"] / "courses/a/guide.md").read_text() == "# A v2\n"


def test_up_to_date_is_ok_and_pulls_nothing(repos, client):
    out = pull(client)
    assert out["ok"] and out["pulled"] == 0


def test_dirty_without_overlap_keeps_the_edit(repos, client):
    commit(repos["seed"], "courses/a/guide.md", "# A v2\n", "a2")
    git(repos["seed"], "push", "-q")
    write(repos["mine"] / "courses/b/guide.md", "# B edited here\n")
    write(repos["mine"] / "courses/b/new.md", "untracked\n")

    out = pull(client)
    assert out["ok"] and out["pulled"] == 1
    assert (repos["mine"] / "courses/a/guide.md").read_text() == "# A v2\n"
    assert (repos["mine"] / "courses/b/guide.md").read_text() == "# B edited here\n"
    assert (repos["mine"] / "courses/b/new.md").read_text() == "untracked\n"
    assert out["status"]["dirty"]


def test_dirty_with_overlap_is_refused_and_untouched(repos, client):
    commit(repos["seed"], "courses/a/guide.md", "# A v2\n", "a2")
    git(repos["seed"], "push", "-q")
    head = git(repos["mine"], "rev-parse", "HEAD")
    write(repos["mine"] / "courses/a/guide.md", "# A edited here\n")

    out = pull(client)
    assert not out["ok"]
    assert out["conflicts"] == ["courses/a/guide.md"]
    assert git(repos["mine"], "rev-parse", "HEAD") == head
    assert (repos["mine"] / "courses/a/guide.md").read_text() == "# A edited here\n"


def test_untracked_file_the_remote_adds_is_an_overlap(repos, client):
    commit(repos["seed"], "courses/c/guide.md", "# C\n", "c")
    git(repos["seed"], "push", "-q")
    write(repos["mine"] / "courses/c/guide.md", "# my C\n")

    out = pull(client)
    assert not out["ok"] and out["conflicts"] == ["courses/c/guide.md"]


def test_diverged_rebases_local_commits_on_top(repos, client):
    commit(repos["seed"], "courses/a/guide.md", "# A v2\n", "a2")
    git(repos["seed"], "push", "-q")
    commit(repos["mine"], "courses/b/guide.md", "# B mine\n", "b mine")

    out = pull(client)
    assert out["ok"] and out["pulled"] == 1
    assert out["status"]["state"] == "ahead" and out["status"]["ahead"] == 1
    log = git(repos["mine"], "log", "--format=%s")
    assert log.splitlines()[:2] == ["b mine", "a2"]


def test_conflicting_local_commit_is_undone(repos, client):
    commit(repos["seed"], "courses/a/guide.md", "# A theirs\n", "theirs")
    git(repos["seed"], "push", "-q")
    commit(repos["mine"], "courses/a/guide.md", "# A mine\n", "mine")
    head = git(repos["mine"], "rev-parse", "HEAD")

    out = pull(client)
    assert not out["ok"]
    assert "undone" in out["detail"]
    assert git(repos["mine"], "rev-parse", "HEAD") == head
    assert (repos["mine"] / "courses/a/guide.md").read_text() == "# A mine\n"
    assert git(repos["mine"], "status", "--porcelain") == ""
