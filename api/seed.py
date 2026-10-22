"""A Content Manager tree baked into the installer, for a machine with none.

The editor edits a Content Manager *checkout*: its `courses/`, and the
`scripts/` and `src/` that scaffolding and Verify shell out to. A clean
laptop has no checkout, so a plain install opens on the first-run screen
asking for a folder that does not exist.

A **seeded** installer (`npm run dist:seeded`, built from
`desktop/scripts/stage-seed.mjs`) carries a pruned copy of one:

    <install>/seed/manifest.json
    <install>/seed/pcm/courses/<id>/...      the courses it was built with
    <install>/seed/pcm/scripts/...           the four authoring scripts + lib
    <install>/seed/pcm/src/...               the two modules verify imports
    <install>/seed/pcm/node_modules/...      lowlight and what it needs
    <install>/seed/pcm/package.json, .nvmrc

`ensure()` lays that out once, under the author's own state directory,
because the install tree is read-only and the editor *writes* courses.

Three rules, each learned from the way PCM's own seeded installers work:

1. **Lowest priority.** `core._resolve_repo_root` consults this after
   `PCM_REPO`, the saved setting and the installer's registry hint, so a
   real checkout always wins and the seed is only what a machine with
   nothing else gets. Nothing is persisted as `pcmRepo`: installing a
   real checkout later takes over with no setting to clear.
2. **Additive for content.** A course the seed carries is copied only if
   it is missing. An upgrade never overwrites a course the author has
   been editing, and never deletes one.
3. **Replaceable for tooling.** `scripts/`, `src/`, `node_modules/` and
   the two root files belong to the build, not the author, so they are
   replaced whenever the seed's id changes. A stale authoring script is a
   Verify that disagrees with the Engine.

Nothing here raises. A failed copy returns None and the editor falls
through to the first-run screen, which can say what is wrong; an
exception at import would kill uvicorn before the window opens.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path

import paths

log = logging.getLogger("editor.seed")

EDITOR_ROOT = Path(__file__).resolve().parents[1]

# What the build owns and the author never edits: replaced on a new seed.
TOOLING = ("scripts", "src", "node_modules", "package.json", ".nvmrc")

STATE_FILE = ".seed-state.json"
TARGET_NAME = "pcm-seed"


def seed_dir() -> Path | None:
    """The bundled seed directory, or None when this build carries none.

    `EDITOR_SEED_DIR` first, for tests and for anyone running the backend
    by hand. Otherwise the installed shape: the staged tree is
    `<install>/app`, and the installer lays the seed beside it as
    `<install>/seed`. The `app` check matters: from a checkout,
    `EDITOR_ROOT.parent` is the folder holding every repo, and a stray
    `seed` directory there must not be mistaken for ours.
    """
    override = os.environ.get("EDITOR_SEED_DIR", "").strip()
    if override:
        path = Path(override).expanduser()
    elif EDITOR_ROOT.name == "app":
        path = EDITOR_ROOT.parent / "seed"
    else:
        return None
    if (path / "manifest.json").is_file() and (path / "pcm" / "courses").is_dir():
        return path
    return None


def target() -> Path:
    """Where the seed is laid out: beside the author's own settings."""
    return paths.state_dir() / TARGET_NAME


def is_seeded(root: Path | None) -> bool:
    """Is `root` the directory `ensure()` lays out?"""
    if root is None:
        return False
    try:
        return Path(root).resolve() == target().resolve()
    except OSError:
        return False


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()


def _incomplete(src: Path, dst: Path) -> bool:
    """Is anything the seed carries for `name` missing from the copy?

    Files, not just the top-level names: one deleted script inside
    scripts/ (a clean-up tool, an interrupted uninstall of something
    else) is a Verify that dies with a module error the author cannot
    read. A few thousand `exists` calls, once per start.
    """
    if not dst.exists():
        return True
    if not src.is_dir():
        return False
    for folder, _dirs, files in os.walk(src):
        rel = Path(folder).relative_to(src)
        for name in files:
            if not (dst / rel / name).exists():
                return True
    return False


def _copy(src: Path, dst: Path) -> None:
    """Copy `src` to `dst` through a temp name, so a failure leaves nothing.

    Without the rename, an interrupted copy leaves a half-populated
    course directory, and "exists, so skip" then keeps it forever.
    """
    partial = dst.with_name(f".{dst.name}.partial")
    _remove(partial)
    if src.is_dir():
        shutil.copytree(src, partial)
    else:
        shutil.copy2(src, partial)
    _remove(dst)
    partial.rename(dst)


def ensure() -> Path | None:
    """Lay the seed out under the state directory; return its root.

    None when this build has no seed, or when laying it out failed.
    Cheap on every later start: one manifest read and a few `exists`.
    """
    src_root = seed_dir()
    if src_root is None:
        return None
    src = src_root / "pcm"
    dst = target()
    manifest = _read_json(src_root / "manifest.json")
    seed_id = str(manifest.get("id") or "")

    try:
        dst.mkdir(parents=True, exist_ok=True)
        state = _read_json(dst / STATE_FILE)

        changed = state.get("toolingId") != seed_id
        for name in TOOLING:
            if (src / name).exists() and (changed or _incomplete(src / name, dst / name)):
                _copy(src / name, dst / name)

        courses = dst / "courses"
        courses.mkdir(exist_ok=True)
        for course in sorted((src / "courses").iterdir()):
            if course.is_dir() and not (courses / course.name).exists():
                _copy(course, courses / course.name)

        (dst / STATE_FILE).write_text(
            json.dumps({"toolingId": seed_id, "pcmVersion": manifest.get("pcmVersion")}, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:
        log.warning("could not lay out the bundled Content Manager seed at %s: %s", dst, exc)
        return None

    return dst
