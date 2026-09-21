"""Finding the Exam Bank, and handing a course to it.

Run from api/:  python -m pytest -q test_peb.py

Nothing here starts a process. `launch` is exercised with Popen stubbed,
because what matters is WHAT it would run and what the child would see
in its environment - the bank's own tests cover the bank starting.
"""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import core
import peb
import app as appmod


def make_checkout(root: Path, package: str = "exam_bank") -> Path:
    """The two things `_is_checkout` insists on: a launcher and a package."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "run.bat").write_text("@echo off\n")
    (root / package).mkdir(exist_ok=True)
    return root


def clear_repo_env(monkeypatch) -> None:
    """Both names of the checkout override - `_override` reads either."""
    for name in ("PEB_REPO", "PQB_REPO"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def no_registry(monkeypatch):
    """No installed bank anywhere - the state of every machine today."""
    monkeypatch.setattr(peb, "install", lambda: None)


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A courses dir with one course, and the repo root beside it."""
    repo = tmp_path / "Pentaho-Content-Manager"
    courses = repo / "courses"
    (courses / "sample").mkdir(parents=True)
    (courses / "sample" / "course.json").write_text(json.dumps({"id": "sample", "title": "Sample"}))
    monkeypatch.setattr(core, "REPO_ROOT", repo)
    monkeypatch.setattr(core, "COURSES_DIR", courses)
    # The editor's own root is the second parent the search walks. The
    # machine running these tests HAS a real bank beside this repo, so
    # without this the "no bank anywhere" cases would quietly find it -
    # and one of them would launch it.
    monkeypatch.setattr(peb, "_EDITOR_ROOT", tmp_path / "Pentaho-Content-Editor")
    return tmp_path


class TestFindingIt:
    def test_a_sibling_checkout_is_found(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        make_checkout(env / "Pentaho-Exam-Bank")
        found = peb.find()
        assert found["kind"] == "checkout"
        assert found["launcher"].endswith("run.bat")

    @pytest.mark.parametrize("directory,package", [
        ("Pentaho-Question-Bank", "question_bank"),   # before the Exam Bank rename
        ("Pentaho-Question-Bank", "exam_bank"),       # renamed inside, not outside
        ("Pentaho-Exam-Bank", "question_bank"),       # renamed outside, not inside
        ("question_bank", "question_bank"),           # before the Pentaho- prefix
    ])
    def test_the_pre_rename_shapes_still_count(
        self, env, monkeypatch, no_registry, directory, package
    ):
        """A machine that has not pulled the rename still has a good bank.

        The button going dead because a sibling checkout was renamed on a
        different day is a failure with nothing on screen to explain it,
        and the rename moved two names - the directory and the package -
        so the half-renamed states are real, not hypothetical.
        """
        clear_repo_env(monkeypatch)
        make_checkout(env / directory, package)
        assert peb.find()["kind"] == "checkout"

    def test_a_directory_of_the_right_name_is_not_enough(self, env, monkeypatch, no_registry):
        # Half a checkout - no run.bat - must not be reported as one, or
        # the button fails at the moment it is pressed instead of being
        # honestly disabled.
        clear_repo_env(monkeypatch)
        (env / "Pentaho-Exam-Bank" / "exam_bank").mkdir(parents=True)
        assert peb.find()["kind"] is None

    def test_peb_repo_overrides_everything(self, env, monkeypatch, no_registry):
        elsewhere = make_checkout(env / "somewhere-else")
        monkeypatch.setenv("PEB_REPO", str(elsewhere))
        make_checkout(env / "Pentaho-Exam-Bank")
        assert peb.find()["path"] == str(elsewhere)

    def test_a_bad_override_finds_nothing_rather_than_the_sibling(self, env, monkeypatch, no_registry):
        # Silently ignoring a typo and opening a DIFFERENT bank is worse
        # than saying there isn't one: the author would edit questions
        # for a copy they never chose.
        monkeypatch.setenv("PEB_REPO", str(env / "nope"))
        make_checkout(env / "Pentaho-Exam-Bank")
        assert peb.find()["kind"] is None

    def test_an_install_wins_over_a_checkout(self, env, monkeypatch):
        install = env / "Program Files" / "Pentaho Exam Bank"
        install.mkdir(parents=True)
        (install / "pentaho-exam-bank.exe").write_text("")
        monkeypatch.setattr(peb, "install", lambda: install)
        make_checkout(env / "Pentaho-Exam-Bank")
        assert peb.find()["kind"] == "installed"

    def test_registered_but_empty_is_broken_not_absent(self, env, monkeypatch):
        install = env / "Program Files" / "Pentaho Exam Bank"
        install.mkdir(parents=True)
        monkeypatch.setattr(peb, "install", lambda: install)
        make_checkout(env / "Pentaho-Exam-Bank")
        found = peb.status()
        assert found["kind"] == "broken"
        assert found["available"] is False
        assert "reinstall" in found["detail"].lower()


class TestStatusText:
    def test_absent_explains_what_the_bank_is(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        detail = peb.status()["detail"]
        assert "questions" in detail
        # And what this editor keeps, so the division is stated once.
        assert "settings" in detail

    def test_available_is_true_only_for_something_launchable(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        assert peb.status()["available"] is False
        make_checkout(env / "Pentaho-Exam-Bank")
        assert peb.status()["available"] is True


class TestLaunching:
    def test_the_child_is_told_the_course_and_the_repo(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        repo = make_checkout(env / "Pentaho-Exam-Bank")
        seen = {}

        def fake_popen(argv, **kwargs):
            seen["argv"] = argv
            seen["env"] = kwargs["env"]
            seen["cwd"] = kwargs["cwd"]
            return object()

        monkeypatch.setattr(peb.subprocess, "Popen", fake_popen)
        out = peb.launch("sample")

        assert seen["argv"] == [str(repo / "run.bat")]
        assert seen["cwd"] == str(repo)
        # The slug, never a path to exam.json: the bank resolves courses
        # itself, and two opinions about which checkout is authoritative
        # disagree silently on a machine with more than one.
        assert seen["env"]["PEB_COURSE"] == "sample"
        # And under the name it had before the Exam Bank rename. A bank
        # checkout that has not been pulled reads only the old one, and
        # sending just the new name opens it on no course at all, with
        # nothing on screen to say why.
        assert seen["env"]["PQB_COURSE"] == "sample"
        assert seen["env"]["PCM_REPO"] == str(core.REPO_ROOT)
        assert out["course"] == "sample"

    def test_the_child_does_not_inherit_this_app_s_virtualenv(self, env, monkeypatch, no_registry):
        # The editor's backend runs inside its own venv. Inherited, the
        # bank's launcher checks `import nicegui` against the EDITOR's
        # interpreter, decides its own venv is broken and starts
        # rebuilding it - so nothing ever serves and the window closes.
        # Found by clicking the real button.
        clear_repo_env(monkeypatch)
        make_checkout(env / "Pentaho-Exam-Bank")
        editor_venv = env / "Pentaho-Content-Editor" / "api" / ".venv"
        (editor_venv / "Scripts").mkdir(parents=True)
        monkeypatch.setenv("VIRTUAL_ENV", str(editor_venv))
        monkeypatch.setenv("PYTHONHOME", str(editor_venv))
        monkeypatch.setenv("PATH", os.pathsep.join([str(editor_venv / "Scripts"), "C:\Windows\system32"]))

        seen = {}
        monkeypatch.setattr(peb.subprocess, "Popen", lambda argv, **kw: seen.update(kw) or object())
        peb.launch("sample")

        child = seen["env"]
        assert "VIRTUAL_ENV" not in child
        assert "PYTHONHOME" not in child
        # The venv's Scripts directory is off PATH, and the rest of PATH
        # survives - the bank wants the user's PATH, not a bare one.
        assert "\.venv\Scripts" not in child["PATH"]
        assert "C:\Windows\system32" in child["PATH"]

    def test_launching_without_a_bank_raises_the_status_sentence(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        with pytest.raises(RuntimeError) as err:
            peb.launch("sample")
        assert "Exam Bank" in str(err.value)


class TestEndpoints:
    def test_status_endpoint_returns_the_ui_shape(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        body = TestClient(appmod.app).get("/api/peb").json()
        assert set(body) >= {"kind", "path", "launcher", "detail", "available"}

    def test_an_unknown_course_is_404_before_anything_starts(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        make_checkout(env / "Pentaho-Exam-Bank")
        started = []
        monkeypatch.setattr(peb.subprocess, "Popen", lambda *a, **k: started.append(a))
        res = TestClient(appmod.app).post("/api/peb/launch", json={"course": "nope"})
        assert res.status_code == 404
        assert started == []

    def test_no_bank_is_409_not_500(self, env, monkeypatch, no_registry):
        # Nothing failed - the bank is simply not on this machine, which
        # is a state the UI already describes.
        clear_repo_env(monkeypatch)
        res = TestClient(appmod.app).post("/api/peb/launch", json={"course": "sample"})
        assert res.status_code == 409

    def test_a_good_launch_reports_what_it_started(self, env, monkeypatch, no_registry):
        clear_repo_env(monkeypatch)
        make_checkout(env / "Pentaho-Exam-Bank")
        monkeypatch.setattr(peb.subprocess, "Popen", lambda *a, **k: object())
        body = TestClient(appmod.app).post("/api/peb/launch", json={"course": "sample"}).json()
        assert body["kind"] == "checkout"
        assert body["course"] == "sample"
