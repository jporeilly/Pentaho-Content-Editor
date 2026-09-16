"""Is the Content Manager checkout we are editing up to date?

The editor writes straight into a git checkout that other people also
publish into. Nothing warned about that: you could spend an afternoon
rewriting a guide that someone replaced upstream this morning, and find
out at Publish — or not at all, if your save quietly won.

So the header carries a pill for it: which checkout, and how it stands
against its remote. Behind is the number that matters; ahead and a dirty
tree are shown because they change what "behind" means to the author
about to pull.

Three rules this endpoint follows, all of them about not being a
nuisance:

  * **Nothing here is fatal.** A folder that is not a git repository, a
    missing remote, no git on the machine at all — each returns a state
    the pill can render, never an error that interrupts editing. The
    editor works fine on a folder that git has never heard of.
  * **Fetching is opt-in.** `behind` cannot be known without asking the
    remote, and asking costs a network round trip on a possibly absent
    VPN. The pill fetches once on load and then only when clicked.
  * **Short timeouts.** A fetch that hangs must not hold a header pill
    for three minutes; it reports "couldn't reach the remote" and the
    author carries on.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import core
import tools

router = APIRouter()

# Local plumbing answers instantly; a fetch is the only one that touches
# the network, and 20s is already generous for "is my VPN on?".
LOCAL_TIMEOUT = 10
FETCH_TIMEOUT = 20


def _git(args: list[str], cwd: Path, timeout: int = LOCAL_TIMEOUT) -> tuple[int, str]:
    """Run git, returning (returncode, output). Never raises."""
    git = tools.git()
    if not git:
        return 127, "git was not found"
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
    try:
        proc = subprocess.run(
            [git, "-c", "credential.interactive=false", *args],
            cwd=str(cwd), capture_output=True, text=True, encoding="utf-8",
            timeout=timeout, env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, str(e)
    return proc.returncode, (proc.stdout or proc.stderr).strip()


@router.get("/api/repo/status")
def repo_status(fetch: bool = False) -> dict[str, Any]:
    """How the Content Manager checkout stands against its remote.

    `state` is what the pill renders, and is deliberately a small closed
    set rather than a sentence:

      no-repo   the folder is not a git checkout (fine, just unknowable)
      no-git    git is not on this machine (so is this)
      detached  no branch, so no upstream to compare with
      no-remote a branch with no upstream — a local-only checkout
      behind    the remote has commits this checkout does not
      ahead     local commits not pushed
      diverged  both
      current   in step
    """
    root = core.REPO_ROOT
    out: dict[str, Any] = {
        "path": str(root),
        "name": root.name,
        "state": "no-repo",
        "branch": None,
        "upstream": None,
        "ahead": 0,
        "behind": 0,
        "dirty": False,
        "fetched": False,
        "detail": None,
    }

    if not root.is_dir():
        out["detail"] = "The folder is not there."
        return out
    if not tools.git():
        out["state"] = "no-git"
        out["detail"] = "git was not found on this machine."
        return out

    code, _ = _git(["rev-parse", "--is-inside-work-tree"], root)
    if code != 0:
        out["detail"] = "This folder is not a git checkout."
        return out

    # Uncommitted work. Cheap, and it changes what a pull would mean.
    code, changes = _git(["status", "--porcelain"], root)
    out["dirty"] = code == 0 and bool(changes.strip())

    code, branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], root)
    if code != 0 or branch == "HEAD":
        out["state"] = "detached"
        out["detail"] = "No branch is checked out."
        return out
    out["branch"] = branch

    code, upstream = _git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root)
    if code != 0:
        out["state"] = "no-remote"
        out["detail"] = f"{branch} is not tracking a remote branch."
        return out
    out["upstream"] = upstream

    if fetch:
        # --quiet, and failure is reported rather than raised: a laptop
        # off the VPN is the normal case for this call, not an error.
        code, detail = _git(["fetch", "--quiet"], root, FETCH_TIMEOUT)
        out["fetched"] = code == 0
        if code != 0:
            out["detail"] = "Couldn't reach the remote — showing the last known state."

    # left = commits upstream has and we do not (behind), right = ours.
    code, counts = _git(["rev-list", "--left-right", "--count", f"{upstream}...HEAD"], root)
    if code == 0 and "\t" in counts:
        behind, ahead = counts.split("\t")[:2]
        out["behind"] = int(behind.strip() or 0)
        out["ahead"] = int(ahead.strip() or 0)

    if out["behind"] and out["ahead"]:
        out["state"] = "diverged"
    elif out["behind"]:
        out["state"] = "behind"
    elif out["ahead"]:
        out["state"] = "ahead"
    else:
        out["state"] = "current"
    return out
