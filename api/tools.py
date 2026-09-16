"""The external tools the editor shells out to: `node` and `git`.

Neither is the editor's own work. Node runs the Content Manager's
authoring scripts — `new-course.mjs`, `new-lab.mjs`, `stamp-manifests.mjs`
and `verify-course.mjs` — because there is one source of truth for
scaffolding and it lives over there. Git is what Publish commits and
pushes with.

A bundled copy is preferred over PATH, which is the shape the Content
Manager already uses for the MinGit it ships (`scripts/fetch-mingit.ps1`,
and `install-course.ps1` reaching for `..\\mingit\\cmd\\git.exe` before
falling back). Nothing is bundled with the editor today: the packaged
build asks for Node and git on the machine and says so at startup rather
than carrying ~50 MB for tools an author who has a courses checkout has
almost certainly got. This module is where that decision is written
down, so reversing it is a vendored directory and no code change.

What breaks without each, which is what the first-run screen reports:

  node — New Course, New Lab, Import, and Verify. Editing, saving,
         preview, the AI actions and Publish do not touch it: the
         manifest metrics a save re-stamps are computed in core.py,
         mirroring stamp-manifests.mjs rather than calling it.
  git  — Publish only.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

# Where a bundled tool would live: <install>/tools/<name>/... — set by the
# desktop shell, which knows its own resource directory.
BUNDLE_DIR = Path(os.environ.get("EDITOR_TOOLS_DIR") or (Path(__file__).resolve().parents[1] / "tools"))

# The layouts the official distributions unpack into. MinGit puts git in
# cmd/; the Node zip puts node.exe at its root.
_SHAPES = ("{tool}.exe", "{tool}/{tool}.exe", "{tool}/cmd/{tool}.exe", "{tool}/bin/{tool}.exe")


def find(tool: str) -> str | None:
    """The path to `tool`, bundled copy first, or None if it is nowhere."""
    for shape in _SHAPES:
        candidate = BUNDLE_DIR / shape.format(tool=tool)
        if candidate.is_file():
            return str(candidate)
    return shutil.which(tool)


def node() -> str | None:
    return find("node")


def git() -> str | None:
    return find("git")


def status() -> dict[str, dict[str, object]]:
    """Both tools, for the setup endpoint and the first-run screen."""
    found = {"node": node(), "git": git()}
    return {
        name: {
            "found": path is not None,
            "path": path,
            "bundled": bool(path) and str(path).startswith(str(BUNDLE_DIR)),
        }
        for name, path in found.items()
    }
