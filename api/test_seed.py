"""The bundled Content Manager seed (api/seed.py) and how core finds it.

The seed is what lets a seeded installer open onto real courses on a
machine with no checkout. What these pin is the part that would hurt an
author: that their edits survive an upgrade, that a real checkout is never
shadowed by the seed, and that nothing here can raise at import.
"""

import json
import os
from pathlib import Path

import pytest

import core
import providers
import seed


def make_seed(root: Path, seed_id="one", courses=("alpha",), tooling="v1") -> Path:
    """A bundled seed as stage-seed.mjs lays it out, at `root`."""
    (root / "pcm" / "scripts").mkdir(parents=True, exist_ok=True)
    (root / "pcm" / "node_modules" / "lowlight").mkdir(parents=True, exist_ok=True)
    (root / "pcm" / "src").mkdir(parents=True, exist_ok=True)
    (root / "pcm" / "scripts" / "verify-course.mjs").write_text(tooling)
    (root / "pcm" / "scripts" / "new-course.mjs").write_text(tooling)
    (root / "pcm" / "node_modules" / "lowlight" / "index.js").write_text(tooling)
    (root / "pcm" / "src" / "codeLanguages.ts").write_text(tooling)
    (root / "pcm" / "package.json").write_text('{"type":"module"}')
    (root / "pcm" / ".nvmrc").write_text("24")
    for name in courses:
        course = root / "pcm" / "courses" / name
        course.mkdir(parents=True, exist_ok=True)
        (course / "course.json").write_text(json.dumps({"id": name, "title": name}))
        (course / "SUMMARY.md").write_text("# toc\n")
    (root / "manifest.json").write_text(json.dumps({"schema": 1, "id": seed_id, "pcmVersion": "0.7.21"}))
    return root


@pytest.fixture
def home(tmp_path, monkeypatch):
    """A state dir and a bundled seed, isolated from the real ones."""
    state = tmp_path / "state"
    state.mkdir()
    monkeypatch.setenv("EDITOR_STATE_DIR", str(state))
    import paths
    paths.reset()
    monkeypatch.setenv("EDITOR_SEED_DIR", str(tmp_path / "bundle"))
    yield tmp_path
    paths.reset()


def test_no_seed_is_a_no_op(home):
    # The checkout case, and every unseeded installer: nothing bundled.
    assert seed.seed_dir() is None
    assert seed.ensure() is None


def test_the_dev_checkout_never_mistakes_a_neighbouring_seed_for_its_own(tmp_path, monkeypatch):
    # From a checkout EDITOR_ROOT.parent is the folder holding every repo.
    monkeypatch.delenv("EDITOR_SEED_DIR", raising=False)
    monkeypatch.setattr(seed, "EDITOR_ROOT", tmp_path / "Pentaho-Content-Editor")
    make_seed(tmp_path / "seed")
    assert seed.seed_dir() is None


def test_the_installed_shape_finds_the_seed_beside_app(tmp_path, monkeypatch):
    monkeypatch.delenv("EDITOR_SEED_DIR", raising=False)
    monkeypatch.setattr(seed, "EDITOR_ROOT", tmp_path / "app")
    make_seed(tmp_path / "seed")
    assert seed.seed_dir() == tmp_path / "seed"


def test_ensure_lays_out_courses_and_tooling_under_the_state_dir(home):
    make_seed(home / "bundle", courses=("alpha", "beta"))
    root = seed.ensure()
    assert root == seed.target()
    assert root.parent == Path(os.environ["EDITOR_STATE_DIR"]).resolve()
    assert (root / "courses" / "alpha" / "course.json").is_file()
    assert (root / "courses" / "beta" / "SUMMARY.md").is_file()
    for tool in ("scripts/verify-course.mjs", "node_modules/lowlight/index.js", "src/codeLanguages.ts", "package.json", ".nvmrc"):
        assert (root / tool).is_file(), tool
    # No half-copied leftovers.
    assert not [p for p in root.rglob("*.partial")]
    # The result is something the editor accepts as a Content Manager.
    assert core.repo_problem(root) is None
    assert core.scaffolding_available(root)


def test_an_authors_edits_survive_the_next_start(home):
    make_seed(home / "bundle")
    root = seed.ensure()
    guide = root / "courses" / "alpha" / "SUMMARY.md"
    guide.write_text("# my edit\n")
    seed.ensure()
    assert guide.read_text() == "# my edit\n"


def test_an_upgrade_replaces_tooling_but_never_a_course(home):
    make_seed(home / "bundle", seed_id="one", tooling="v1")
    root = seed.ensure()
    (root / "courses" / "alpha" / "SUMMARY.md").write_text("# my edit\n")

    # A newer installer: new tooling, the same course (changed upstream),
    # and one course the first did not carry.
    make_seed(home / "bundle", seed_id="two", courses=("alpha", "gamma"), tooling="v2")
    (home / "bundle" / "pcm" / "courses" / "alpha" / "SUMMARY.md").write_text("# upstream\n")
    root = seed.ensure()

    assert (root / "scripts" / "verify-course.mjs").read_text() == "v2"
    assert (root / "node_modules" / "lowlight" / "index.js").read_text() == "v2"
    assert (root / "courses" / "alpha" / "SUMMARY.md").read_text() == "# my edit\n"
    assert (root / "courses" / "gamma" / "course.json").is_file()


def test_a_removed_course_is_left_on_disk(home):
    make_seed(home / "bundle", courses=("alpha", "beta"))
    root = seed.ensure()
    make_seed(home / "bundle", seed_id="two", courses=("alpha",))
    for gone in (home / "bundle" / "pcm" / "courses" / "beta").iterdir():
        gone.unlink()
    (home / "bundle" / "pcm" / "courses" / "beta").rmdir()
    seed.ensure()
    assert (root / "courses" / "beta" / "course.json").is_file()


def test_missing_tooling_is_restored_even_when_the_id_is_unchanged(home):
    make_seed(home / "bundle")
    root = seed.ensure()
    (root / "scripts" / "verify-course.mjs").unlink()
    seed.ensure()
    assert (root / "scripts" / "verify-course.mjs").is_file()


def test_a_failed_copy_returns_none_instead_of_raising(home, monkeypatch):
    make_seed(home / "bundle")

    def boom(*a, **k):
        raise PermissionError("denied")

    monkeypatch.setattr(seed.shutil, "copytree", boom)
    assert seed.ensure() is None


def test_is_seeded_recognises_only_its_own_directory(home, tmp_path):
    make_seed(home / "bundle")
    root = seed.ensure()
    assert seed.is_seeded(root)
    assert not seed.is_seeded(tmp_path)
    assert not seed.is_seeded(None)


# ── core.py: where the seed ranks ───────────────────────────────────

@pytest.fixture
def resolver(home, monkeypatch):
    """_resolve_repo_root with every other source switched off."""
    monkeypatch.delenv("PCM_REPO", raising=False)
    monkeypatch.setattr(providers, "load_settings", lambda: {})
    monkeypatch.setattr(core, "installer_hint", lambda: None)
    make_seed(home / "bundle")
    return core._resolve_repo_root


def test_the_seed_is_used_when_nothing_else_answers(resolver):
    assert resolver() == seed.target().resolve()


def test_a_saved_choice_beats_the_seed(resolver, monkeypatch, tmp_path):
    chosen = tmp_path / "mine"
    (chosen / "courses").mkdir(parents=True)
    monkeypatch.setattr(providers, "load_settings", lambda: {"pcmRepo": str(chosen)})
    assert resolver() == chosen.resolve()


def test_the_environment_beats_the_seed(resolver, monkeypatch, tmp_path):
    monkeypatch.setenv("PCM_REPO", str(tmp_path / "env"))
    assert resolver() == (tmp_path / "env").resolve()


def test_the_installers_hint_beats_the_seed(resolver, monkeypatch, tmp_path):
    hinted = tmp_path / "hinted"
    (hinted / "courses").mkdir(parents=True)
    monkeypatch.setattr(core, "installer_hint", lambda: hinted)
    assert resolver() == hinted.resolve()


def test_a_hint_that_has_moved_does_not_shadow_the_seed(resolver, monkeypatch, tmp_path):
    monkeypatch.setattr(core, "installer_hint", lambda: tmp_path / "moved")
    assert resolver() == seed.target().resolve()


def test_without_a_seed_resolution_falls_back_to_the_sibling(home, monkeypatch):
    monkeypatch.delenv("PCM_REPO", raising=False)
    monkeypatch.delenv("EDITOR_SEED_DIR", raising=False)
    monkeypatch.setattr(providers, "load_settings", lambda: {})
    monkeypatch.setattr(core, "installer_hint", lambda: None)
    assert core._resolve_repo_root() == core.DEFAULT_REPO.resolve()


def test_setup_reports_when_the_courses_are_the_seeded_copy(home, monkeypatch):
    from fastapi.testclient import TestClient
    import app as appmod

    make_seed(home / "bundle")
    root = seed.ensure()
    monkeypatch.setattr(core, "REPO_ROOT", root)
    monkeypatch.setattr(core, "COURSES_DIR", root / "courses")
    body = TestClient(appmod.app).get("/api/setup").json()
    assert body["seeded"] is True
    assert body["valid"] is True

    monkeypatch.setattr(core, "REPO_ROOT", home)
    assert TestClient(appmod.app).get("/api/setup").json()["seeded"] is False
