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
    # On success the answer is stdout; on failure the reason is stderr.
    text = (proc.stderr or proc.stdout) if proc.returncode else (proc.stdout or proc.stderr)
    return proc.returncode, (text or "").strip()


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


# A pull rebases and may rewrite files: allow it longer than a status
# probe, still short enough that a hung remote cannot hold the button.
PULL_TIMEOUT = 60


def _paths(out: str) -> set[str]:
    return {line.strip() for line in out.splitlines() if line.strip()}


def _local_changes(root: Path) -> set[str]:
    """Every path with work git does not hold yet: staged, unstaged and
    untracked. Untracked counts because a pull that ADDS that path stops
    with "untracked working tree files would be overwritten"."""
    q = ["-c", "core.quotepath=off"]
    _, tracked = _git([*q, "diff", "--name-only", "HEAD"], root)
    _, untracked = _git([*q, "ls-files", "--others", "--exclude-standard"], root)
    return _paths(tracked) | _paths(untracked)


def _rebase_in_progress(root: Path) -> bool:
    for name in ("rebase-merge", "rebase-apply"):
        code, path = _git(["rev-parse", "--git-path", name], root)
        if code == 0 and path and (root / path).exists():
            return True
    return False


@router.post("/api/repo/pull")
def repo_pull() -> dict[str, Any]:
    """Bring the Content Manager checkout up to date with its remote.

    The author's edits come first. Uncommitted work survives a pull
    (`--autostash`), but only when the remote did not change the same
    files: a stash that cannot re-apply leaves conflict markers inside a
    guide, which is worse than not pulling. So an overlap is refused up
    front, with the files named. Local commits are replayed on top of
    the remote (`rebase`), as `git pull --rebase` would; a rebase that
    stops on a conflict is aborted, which puts the checkout, the stash
    included, back exactly as it was.

    Answers `{ok, pulled, detail, conflicts, status}`. `pulled` is how
    many remote commits came in; `status` is the pill's new state.
    """
    status = repo_status(fetch=True)
    result: dict[str, Any] = {"ok": False, "pulled": 0, "detail": None, "conflicts": [], "status": status}

    if status["state"] in ("no-repo", "no-git", "detached", "no-remote"):
        result["detail"] = status["detail"] or "This checkout has no remote branch to pull from."
        return result
    if not status["fetched"]:
        result["detail"] = "Couldn't reach the remote, so there is nothing new to pull."
        return result
    if status["behind"] == 0:
        result["ok"] = True
        result["detail"] = "Already up to date."
        return result

    root = core.REPO_ROOT
    upstream = status["upstream"]
    if status["dirty"]:
        _, incoming = _git(["-c", "core.quotepath=off", "diff", "--name-only", f"HEAD...{upstream}"], root)
        overlap = sorted(_local_changes(root) & _paths(incoming))
        if overlap:
            result["conflicts"] = overlap
            result["detail"] = (
                f"Not pulled: {len(overlap)} file(s) you changed here were also changed on the remote. "
                "Save and Publish (or commit) them first, then pull."
            )
            return result

    code, out = _git(["rebase", "--autostash", upstream], root, PULL_TIMEOUT)
    if code != 0:
        if _rebase_in_progress(root):
            _git(["rebase", "--abort"], root, PULL_TIMEOUT)
        reason = out.splitlines()[-1] if out else ""
        result["detail"] = f"The pull stopped and was undone; the checkout is as it was. {reason}".strip()
        result["status"] = repo_status(fetch=False)
        return result

    result["ok"] = True
    result["pulled"] = status["behind"]
    result["detail"] = f"Pulled {status['behind']} change(s) from {upstream}."
    result["status"] = repo_status(fetch=False)
    return result
