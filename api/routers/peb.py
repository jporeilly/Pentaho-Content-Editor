"""Hand a course over to the Exam Bank.

Two endpoints and nothing else, because the editor's involvement with
the question pool ends at the handover — see `peb.py` for why this is a
launch rather than an integration.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import core
import peb

router = APIRouter()


class LaunchRequest(BaseModel):
    course: str


@router.get("/api/peb")
def peb_status() -> dict[str, Any]:
    """Where the bank is, or the sentence explaining that it is nowhere."""
    return peb.status()


@router.post("/api/peb/launch")
def peb_launch(req: LaunchRequest) -> dict[str, Any]:
    """Start the bank on a course.

    The course is checked HERE rather than left to the bank: a typo would
    otherwise open an empty bank with no explanation, several seconds
    later, in a different window.
    """
    if not (core.COURSES_DIR / req.course).is_dir():
        raise HTTPException(status_code=404, detail=f"No such course: {req.course}")
    try:
        return peb.launch(req.course)
    except RuntimeError as err:
        # 409, not 500: nothing failed: the bank is simply not on this
        # machine, which is a legitimate state the UI already describes.
        raise HTTPException(status_code=409, detail=str(err)) from err
    except OSError as err:  # pragma: no cover - depends on the machine
        raise HTTPException(status_code=500, detail=f"Couldn't start the Exam Bank: {err}") from err
