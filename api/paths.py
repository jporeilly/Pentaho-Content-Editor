"""Where the editor keeps its OWN files — settings, caches, nothing else.

Two things live outside the courses it edits: the machine-specific LLM
provider settings, and the shallow clone Publish keeps. Both used to sit
in ``api/`` beside the code, which is correct for a checkout and wrong
for an install: a packaged editor lives under ``C:\\Program Files``,
where writes fail, and any file that did land there is one the installer
never shipped and the uninstaller would leave behind.

Resolution order, and the reason for each step:

1. ``EDITOR_STATE_DIR`` — an explicit answer, for tests and for anyone
   who wants their settings somewhere specific. Nothing else is consulted
   when it is set.
2. ``api/`` itself, WHEN IT IS WRITABLE. This is what keeps a checkout
   behaving exactly as it always has: same settings.json, same
   .publish-cache, no migration, no surprise when a dev machine suddenly
   reads different settings than it wrote yesterday.
3. ``%APPDATA%\\Pentaho Content Editor`` — the installed case, which
   step 2 falls out of by failing to write.

Writability is PROBED, not inferred from the path. "Am I under Program
Files?" is a guess that breaks for a per-user install, a portable copy on
a memory stick, or a checkout on a read-only share; asking the
filesystem is the same question the actual write will ask.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent

_resolved: Path | None = None


def _writable(directory: Path) -> bool:
    """Can this process create a file in `directory` right now?"""
    probe = directory / ".write-probe"
    try:
        probe.write_text("", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def _per_user() -> Path:
    """The per-user data directory, by platform convention."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
        return Path(base) / "Pentaho Content Editor"
    return Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")) / "pentaho-content-editor"


def state_dir() -> Path:
    """The directory for the editor's own files, created if need be.

    Cached: the probe writes a file, and this is asked on every settings
    read. Call `reset()` after changing EDITOR_STATE_DIR.
    """
    global _resolved
    if _resolved is not None:
        return _resolved

    explicit = os.environ.get("EDITOR_STATE_DIR")
    if explicit:
        chosen = Path(explicit).expanduser()
    elif API_DIR.is_dir() and _writable(API_DIR):
        chosen = API_DIR
    else:
        chosen = _per_user()

    chosen.mkdir(parents=True, exist_ok=True)
    _resolved = chosen.resolve()
    return _resolved


def reset() -> None:
    """Forget the cached answer — for tests, and after the env changes."""
    global _resolved
    _resolved = None
