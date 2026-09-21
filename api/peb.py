"""The Exam Bank, and how a course is handed over to it.

The exam pool is not this editor's work. `courses/<id>/exam.json` has two
writers and they own disjoint keys: the editor owns the SETTINGS
(`title`, `description`, `passMark`, `questionsPerAttempt`, `shuffle`,
`webhookUrl`, `webhookSecret`, `intake` — the `_EXAM_SETTINGS` tuple in
`routers/courses.py`), and the Exam Bank owns `questions`. Neither
touches the other's keys, so two apps can edit one file without a
protocol between them and git reconciles the rare collision.

**The button is a LAUNCH, not a dependency.** The editor spawns the bank
with a course to open and gets out of the way. It deliberately does not
call the bank's API, nor the bank this one's:

  * this editor's port is assigned at launch (`desktop/boot.py` makes
    `--port` required with no default), so the bank would have to
    DISCOVER a running editor rather than call a known address;
  * it would make one app a runtime dependency of the other — three
    processes alive to move a question into a course, and a silent
    failure the moment either is closed;
  * and it would remove no conflict, because the key contract already
    prevents the only one there is.

Three places are searched, in the same order and for the same reasons as
`tools.py` searches for node and git: an installed copy, then a checkout
beside the other two repos, then nothing. "Nothing" is a first-class
answer here rather than an error — the bank is a separate product on its
own release cycle, and an author who has never installed it should get a
button that explains itself, not one that fails.

The course travels in the ENVIRONMENT (`PEB_COURSE`), not as an argument.
The bank's entry point takes no arguments today and ignores `sys.argv`
entirely, so a flag would be silently dropped; an environment variable is
ignored just as harmlessly by a version that does not read it yet, and
works the day it does.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import core

# Where an installed bank will register itself - the key its own plan
# names for the installer, not this suite's publisher key.
#
# NOTHING WRITES IT YET. The bank's installer is the last phase of its
# restack, so on every machine today this lookup misses and the checkout
# below is what answers. Reading it now costs one failed registry open
# and means the button starts preferring a real install the day one
# exists, with no change here.
_PEB_KEY = r"SOFTWARE\Pentaho\ExamBank"

# The launcher inside an install, most specific first.
_INSTALL_SHAPES = ("pentaho-exam-bank.exe", "exam-bank.exe")

# What a CHECKOUT is launched with. `run.bat` is the bank's own front
# door: it loads .env, frees a stale port, activates the venv and repairs
# it when a dependency is missing. Calling `python main.py` directly
# would skip all four and fail on a machine whose venv has drifted —
# which is most of them, most of the time.
#
# THIS TARGET MOVES. `run.bat` starts the bank's NiceGUI app on 7777,
# and at the bank's 0.4.0 that layer is deleted in favour of a React
# front end (Vite 7789 over its FastAPI on 7788) - about ten of the
# twelve thousand lines its restack retires. Stable through its 0.1.x;
# the durable contract is the install (the registry key above) and the
# launcher name inside it, not this file.
#
# Two things are worth knowing when that day comes, because they are
# what the button is FOR: the bank will read `PEB_COURSE` to open on
# the course it was launched with, and it still cannot publish back -
# its exporter regenerates exam.json from a fixed parameter list and
# would drop `intake`, which this editor owns. So the tooltip's
# round-trip hedge outlives the move; only "makes you pick the course
# again" goes with it.
_CHECKOUT_LAUNCHER = "run.bat"

# The directory name the repo has now, newest first. The two earlier
# names are accepted as well: a machine that has not pulled the Exam Bank
# rename still has a perfectly good bank on it, and the button going dead
# because a sibling checkout was not renamed on the same day is a failure
# with nothing on screen to explain it.
_CHECKOUT_NAMES = ("Pentaho-Exam-Bank", "Pentaho-Question-Bank", "question_bank")

# The package directory inside a checkout, and the same story: `exam_bank`
# after the rename, `question_bank` before it.
_CHECKOUT_PACKAGES = ("exam_bank", "question_bank")

# This repo's own root. A module constant rather than a `__file__`
# expression inside the search, because it is one of the two parents
# searched and a test cannot otherwise describe a machine WITHOUT a bank
# - the dev box that runs the tests has a real checkout beside this
# repo, so "absent" was unreachable and five tests asserted nothing.
_EDITOR_ROOT = Path(__file__).resolve().parents[1]


def _override(*names: str) -> str:
    """The first of these environment variables that is set to something.

    Each override has two names, the Exam Bank's and the one it had before
    the rename. A machine with the old one exported in a shell profile
    would otherwise fall back to searching, find a different copy of the
    bank, and give no sign that it had ignored what it was told.
    """
    for name in names:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def install() -> Path | None:
    """The installed bank's directory, or None.

    `PEB_INSTALL_DIR` (or the pre-rename `PQB_INSTALL_DIR`) first so a
    test, or an author with a portable copy, can say where it is without
    touching the registry. Both registry views are read for the reason
    `tools.py` gives: this process is 64-bit and the value is written by
    a 32-bit NSIS.
    """
    override = _override("PEB_INSTALL_DIR", "PQB_INSTALL_DIR")
    if override:
        path = Path(override).expanduser()
        return path if path.is_dir() else None
    try:
        import winreg
    except ImportError:
        return None
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _PEB_KEY, 0, winreg.KEY_READ | view) as key:
                value, _ = winreg.QueryValueEx(key, "")
        except OSError:
            continue
        path = Path(str(value).strip('"'))
        if path.is_dir():
            return path
    return None


def checkout() -> Path | None:
    """An Exam Bank checkout, or None.

    `PEB_REPO` mirrors `PCM_REPO`, then the siblings of the two repos we
    already know about: the Content Manager's root (which is wherever
    `PCM_REPO` pointed) and this editor's own. A dev machine has all
    three side by side under one directory, and either sibling finds the
    third from the other two.
    """
    override = _override("PEB_REPO", "PQB_REPO")
    if override:
        path = Path(override).expanduser()
        return path if _is_checkout(path) else None
    for parent in (core.REPO_ROOT.parent, _EDITOR_ROOT.parent):
        for name in _CHECKOUT_NAMES:
            candidate = parent / name
            if _is_checkout(candidate):
                return candidate
    return None


def _is_checkout(path: Path) -> bool:
    """A directory holding the bank's launcher and its package."""
    if not (path / _CHECKOUT_LAUNCHER).is_file():
        return False
    return any((path / name).is_dir() for name in _CHECKOUT_PACKAGES)


def find() -> dict[str, object]:
    """Where the bank is and how it would be started.

    Shaped for the UI: `kind` decides whether the button is live, and
    `path` is what its tooltip says, because "which copy did it open?" is
    the question an author asks the moment two exist.
    """
    installed = install()
    if installed:
        for shape in _INSTALL_SHAPES:
            exe = installed / shape
            if exe.is_file():
                return {"kind": "installed", "path": str(installed), "launcher": str(exe)}
        # Registered but no launcher inside it: a broken or partial
        # install, which is worth saying rather than falling through to
        # the checkout and quietly opening a different copy.
        return {"kind": "broken", "path": str(installed), "launcher": None}
    repo = checkout()
    if repo:
        return {"kind": "checkout", "path": str(repo), "launcher": str(repo / _CHECKOUT_LAUNCHER)}
    return {"kind": None, "path": None, "launcher": None}


def status() -> dict[str, object]:
    """`find()` plus the sentence the UI shows when it cannot launch."""
    found = find()
    kind = found["kind"]
    if kind == "installed":
        found["detail"] = f"Installed at {found['path']}"
    elif kind == "checkout":
        found["detail"] = f"Running from the checkout at {found['path']}"
    elif kind == "broken":
        found["detail"] = (
            f"Registered at {found['path']} but no launcher is there — "
            "reinstall the Exam Bank."
        )
    else:
        found["detail"] = (
            "The Exam Bank isn't installed. It edits the exam pool "
            "(the questions); this editor owns the exam settings beside them."
        )
    found["available"] = kind in ("installed", "checkout")
    return found


def launch(course_id: str) -> dict[str, object]:
    """Start the bank on `course_id`. Raises RuntimeError if it is absent.

    Detached on purpose: the bank outlives the request, and the editor
    neither waits for it nor owns its lifetime. It opens its own window —
    its NiceGUI server runs with `show=True` — so there is no URL for the
    editor to open and no second window to manage.
    """
    found = find()
    if not found["launcher"]:
        raise RuntimeError(str(status()["detail"]))
    # Both names. A bank checkout that predates the Exam Bank rename
    # reads PQB_COURSE and nothing else, and sending only the new name
    # would open it on no course with no error - the exact silent
    # failure the handover exists to avoid. Drop the old one once no
    # bank on any machine still reads it.
    env = {**_clean_env(), "PEB_COURSE": course_id, "PQB_COURSE": course_id}
    # The Content Manager checkout the bank should read the course from.
    # It resolves this itself the same way the editor does, but passing
    # the answer we already have means the two cannot disagree about
    # which courses/ they are looking at.
    env["PCM_REPO"] = str(core.REPO_ROOT)
    launcher = Path(str(found["launcher"]))
    _spawn(launcher, env)
    return {"launched": str(launcher), "kind": found["kind"], "course": course_id}


# Variables that describe THIS backend's Python and would describe the
# child's if they were inherited.
_VENV_VARS = ("VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT", "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP")


def _clean_env() -> dict[str, str]:
    """The environment minus this app's Python, which is not the bank's.

    Found by launching the real thing: the editor's backend runs inside
    its own virtualenv, so a child inherits `VIRTUAL_ENV` and a `PATH`
    beginning with `api/.venv/Scripts`. The bank's `run.bat` then layers
    its own activate on top of that, its `python -c "import nicegui"`
    check resolves to the EDITOR's interpreter, which has no nicegui, and
    the launcher concludes its own virtualenv is broken and starts
    rebuilding it. Nothing ever reaches port 7777 and the window closes
    on its own - which reads as "the button did nothing".

    So the venv variables come out and the venv's own directories come
    off PATH. Everything else is passed through: the bank wants the
    user's PATH, not a sanitised one.
    """
    env = {k: v for k, v in os.environ.items() if k not in _VENV_VARS}
    venv = os.environ.get("VIRTUAL_ENV")
    if venv and env.get("PATH"):
        venv_path = str(Path(venv).resolve()).lower()
        kept = [
            part for part in env["PATH"].split(os.pathsep)
            if part and not str(Path(part).resolve()).lower().startswith(venv_path)
        ]
        env["PATH"] = os.pathsep.join(kept)
    return env


def _spawn(launcher: Path, env: dict[str, str]) -> None:
    """Start the launcher in its own console, outliving this process.

    CREATE_NEW_CONSOLE, and NOT with DETACHED_PROCESS beside it: Windows
    rejects that pair outright, which surfaced as a 500 from a launch
    that had not started anything. The console is wanted, not tolerated -
    `run.bat` reports what it is doing and rebuilds the venv when a
    dependency is missing, and a silent window would make a 40-second
    repair look like nothing happening.

    CREATE_BREAKAWAY_FROM_JOB matters when the editor is the PACKAGED
    app: its shell puts the backend in a job object so closing the window
    kills the server, and a child inherits that job - so the bank would
    die with the editor that opened it. Not every job permits breakaway,
    so a refusal falls back rather than failing the launch: an app that
    closes with the editor beats an app that never opens.
    """
    if sys.platform != "win32":  # pragma: no cover - the suite is Windows-only
        subprocess.Popen([str(launcher)], cwd=str(launcher.parent), env=env, close_fds=True)
        return
    base = subprocess.CREATE_NEW_CONSOLE
    for flags in (base | subprocess.CREATE_BREAKAWAY_FROM_JOB, base):
        try:
            subprocess.Popen(
                [str(launcher)],
                cwd=str(launcher.parent),
                env=env,
                creationflags=flags,
                close_fds=True,
            )
            return
        except OSError:
            continue
    raise OSError(f"Windows refused to start {launcher}")
