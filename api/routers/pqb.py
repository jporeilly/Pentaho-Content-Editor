"""Hand a course over to the Question Bank.

Two endpoints and nothing else, because the editor's involvement with
the question pool ends at the handover — see `pqb.py` for why this is a
launch rather than an integration.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import core
import pqb

router = APIRouter()


class LaunchRequest(BaseModel):
    course: str


@router.get("/api/pqb")
def pqb_status() -> dict[str, Any]:
    """Where the bank is, or the sentence explaining that it is nowhere."""
    return pqb.status()


@router.post("/api/pqb/launch")
def pqb_launch(req: LaunchRequest) -> dict[str, Any]:
    """Start the bank on a course.

    The course is checked HERE rather than left to the bank: a typo would
    otherwise open an empty bank with no explanation, several seconds
    later, in a different window.
    """
    if not (core.COURSES_DIR / req.course).is_dir():
        raise HTTPException(status_code=404, detail=f"No such course: {req.course}")
    try:
        return pqb.launch(req.course)
    except RuntimeError as err:
        # 409, not 500: nothing failed: the bank is simply not on this
        # machine, which is a legitimate state the UI already describes.
        raise HTTPException(status_code=409, detail=str(err)) from err
    except OSError as err:  # pragma: no cover - depends on the machine
        raise HTTPException(status_code=500, detail=f"Couldn't start the Question Bank: {err}") from err
