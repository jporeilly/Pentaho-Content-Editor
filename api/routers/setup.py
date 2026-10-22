"""First run: where the courses are, and what the machine is missing.

From a checkout none of this is needed — the Content Manager is the
sibling directory, Node and git are already there or the author would not
have a checkout to edit. Installed, all three become questions the app
has to ask and answer for itself, because there is no shell to fix them
in and no author who will guess that `PCM_REPO` is a thing.

So one endpoint says everything the first-run screen needs:

  • where we are pointed, and what is wrong with it if anything;
  • whether the authoring scripts are there (scaffolding and Verify);
  • whether Node and git are (the same features, and Publish).

None of it is fatal except a missing courses directory. The editor is
worth having against a content-only clone on a machine with no Node: you
can edit, save, preview and use the AI actions. Saying so once, plainly,
beats four features failing later with four different errors.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

import core
import seed
import tools

router = APIRouter()


class RepoChoice(BaseModel):
    path: str


def _status() -> dict[str, Any]:
    problem = core.repo_problem()
    scaffolding = core.scaffolding_available()
    found = tools.status()

    # What the author cannot do right now, in the words of the buttons
    # they would otherwise press. Empty when everything is present.
    unavailable: list[str] = []
    if not scaffolding:
        unavailable.append(
            "New Course, New Lab, Import and Verify — this folder has no scripts/ "
            "directory, so the Content Manager's authoring scripts are not there"
        )
    elif not found["node"]["found"]:
        unavailable.append(
            "New Course, New Lab, Import and Verify — they run the Content "
            "Manager's scripts, which need Node.js"
        )
    if not found["git"]["found"]:
        unavailable.append("Publish — it commits and pushes with git")

    return {
        "pcmRepo": str(core.REPO_ROOT),
        # True when the folder is the copy a seeded installer laid down
        # rather than a checkout the author chose: worth saying, because
        # publishing from it is not publishing from their repository.
        "seeded": seed.is_seeded(core.REPO_ROOT),
        "valid": problem is None,
        "reason": problem,
        # Only when it is real. From a checkout the sibling directory is
        # a genuine suggestion; from an install it resolves to a path
        # inside Program Files that has never existed, and offering that
        # as the answer sends the author looking for a folder nobody has
        # ever had.
        "defaultRepo": str(core.DEFAULT_REPO) if core.DEFAULT_REPO.is_dir() else "",
        "scaffolding": scaffolding,
        "tools": found,
        "unavailable": unavailable,
        # Only when we are lost. Scanning is cheap but not free, and this
        # endpoint is polled at every boot — an editor that already knows
        # where its courses are has no reason to go looking for others.
        "candidates": core.find_repo_candidates() if problem else [],
    }


@router.get("/api/setup")
def get_setup() -> dict[str, Any]:
    return _status()


@router.put("/api/setup")
def put_setup(choice: RepoChoice) -> dict[str, Any]:
    """Point the editor at a Content Manager checkout, and remember it.

    Raises 400 with the reason when the folder is not one, which is the
    text the first-run screen shows — the validation and the message the
    author reads are the same thing, so they cannot disagree.
    """
    core.set_repo_root(choice.path)
    return _status()
