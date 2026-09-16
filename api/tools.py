"""The external tools the editor shells out to: `node` and `git`.

Neither is the editor's own work. Node runs the Content Manager's
authoring scripts — `new-course.mjs`, `new-lab.mjs`, `stamp-manifests.mjs`
and `verify-course.mjs` — because there is one source of truth for
scaffolding and it lives over there. Git is what Publish commits and
pushes with.

Three places are searched, in this order: a copy bundled with the editor,
the Content Manager's own install, then PATH.

**The editor bundles neither any more.** It carried both for three
releases, and 177 MB of a 287 MB payload was two runtimes — which cost
about six minutes of every build, since NSIS recompresses the lot each
time. Git came back out because the Content Manager ALREADY SHIPS IT: its
installer vendors MinGit, so on any machine with the learner app there is
a perfectly good git sitting in `<PCM install>\\mingit\\cmd\\git.exe`,
and shipping a second copy 90 MB at a time is the same file twice.

Node came out the same way, and the Content Manager now ships that too.
It has no use for one itself — it vendors Node so that the editor beside
it does not have to — which is the right place for it: the Node version
is dictated by THAT repo's `verify-course.mjs` (it imports a TypeScript
module directly and needs 24's native type stripping), so the repo that
sets the requirement is the one that satisfies it. An older PCM install
has no `node/`, and PATH catches that.

The bundle seam stays because it costs nothing: dropping a `tools/`
directory into the install turns vendoring back on with no code change.

What breaks without each, which is what the first-run screen reports:

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

# Where the Content Manager's installer puts what it vendors, relative to
# its install directory. Same names it uses itself.
_PCM_SHAPES = {"git": ("mingit/cmd/git.exe",), "node": ("node/node.exe",)}

# The publisher key every installer in this suite writes its location to;
# the default value is the install directory. Set by the Content
# Manager's own NSIS, and read here rather than guessed, because
# per-machine and per-user installs land in different places.
_PCM_KEY = r"SOFTWARE\Pentaho Presales Engineering\Pentaho Content Manager"


def pcm_install() -> Path | None:
    """The Content Manager's install directory, or None.

    `PCM_INSTALL_DIR` first so a test - or an author with a portable copy
    - can say where it is without touching the registry. Reads the
    64-bit view explicitly: this process is 64-bit, but the value was
    written by a 32-bit NSIS, and getting that wrong is precisely how the
    editor's own course hint was invisible for a release.
    """
    override = os.environ.get("PCM_INSTALL_DIR")
    if override:
        path = Path(override).expanduser()
        return path if path.is_dir() else None
    try:
        import winreg
    except ImportError:
        return None
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _PCM_KEY, 0, winreg.KEY_READ | view) as key:
                value, _ = winreg.QueryValueEx(key, "")
        except OSError:
            continue
        path = Path(str(value).strip('"'))
        if path.is_dir():
            return path
    return None


def find(tool: str) -> str | None:
    """The path to `tool`: bundled, then the Content Manager's, then PATH."""
    for shape in _SHAPES:
        candidate = BUNDLE_DIR / shape.format(tool=tool)
        if candidate.is_file():
            return str(candidate)
    pcm = pcm_install()
    if pcm:
        for shape in _PCM_SHAPES.get(tool, ()):
            candidate = pcm / shape
            if candidate.is_file():
                return str(candidate)
    return shutil.which(tool)


def node() -> str | None:
    return find("node")


def git() -> str | None:
    return find("git")


def _source(path: str | None) -> str:
    """Which of the three places answered - worth saying out loud.

    "the Content Manager's" is a different situation from "yours, on
    PATH": the first goes away if the learner app is uninstalled, and the
    second is a version this editor never chose. An author debugging why
    Verify behaves differently from their terminal wants to know which
    one they are looking at.
    """
    if not path:
        return "missing"
    if str(path).startswith(str(BUNDLE_DIR)):
        return "bundled"
    pcm = pcm_install()
    if pcm and str(path).startswith(str(pcm)):
        return "content-manager"
    return "path"


def status() -> dict[str, dict[str, object]]:
    """Both tools, for the setup endpoint and the first-run screen."""
    found = {"node": node(), "git": git()}
    return {
        name: {
            "found": path is not None,
            "path": path,
            "source": _source(path),
            "bundled": bool(path) and str(path).startswith(str(BUNDLE_DIR)),
        }
        for name, path in found.items()
    }
