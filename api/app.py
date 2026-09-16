"""Pentaho Content Editor API — FastAPI backend for the visual editor.

A thin, local read/write service over the repo's ``courses/`` folder so
the React editor (which reuses the app's own MarkdownBody renderer for a
true-WYSIWYG preview) can list, open, and save courses and labs without
the author touching JSON or the folder layout by hand.

Runs on the author's machine only — it is NOT shipped to the learner VMs
(those run the Tauri renderer). Start it with::

    cd api
    pip install -r requirements.txt
    uvicorn app:app --reload --port 8000

Structure
---------
The endpoints live in ``routers/`` (one module per domain); the shared
kernel — paths, filesystem/JSON helpers, manifest-metric helpers, the
SUMMARY.md structure parser, and the AI-prompt helpers — is in ``core``.
This module only assembles the app: CORS, the routers, and ``/api/health``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import core
from routers import courses, labs, assets, ai, settings, imports, export, publish, setup

app = FastAPI(title="Pentaho Content Editor API")

# The Vite dev server (author frontend) runs on a different port, so
# allow cross-origin from localhost during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

for _module in (courses, labs, assets, ai, settings, imports, export, publish, setup):
    app.include_router(_module.router)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "coursesDir": str(core.COURSES_DIR),
        "exists": core.COURSES_DIR.exists(),
        # The one thing a packaged editor must be able to say while it is
        # still useless: "I am running, I just don't know where your
        # courses are." Before this, a wrong PCM_REPO killed the process
        # at import and the window showed "can't reach the API" — true,
        # and no help at all.
        "needsSetup": core.repo_problem() is not None,
    }


# ── The built UI, when there is one ─────────────────────────────────
#
# Packaged, the editor is ONE process on ONE port: uvicorn serves the API
# and the SPA that calls it, which is also what makes the frontend's
# relative API base work (see .env.production). From a checkout there is
# usually no ui/, and Vite serves it on 5273 with its own hot
# reload — so this mount appears only when the build output is actually
# there, and the dev flow is untouched either way.
#
# Mounted LAST, after every router: it answers "/" and everything below
# it, so anything registered afterwards would be shadowed by the SPA.
# The built UI. Named ui/ rather than dist/ because dist/ holds built
# INSTALLERS here, as it does across this suite (vite.config.ts says why).
DIST_DIR = core.EDITOR_ROOT / "ui"


def mount_ui(target: FastAPI, dist: Path) -> bool:
    """Serve the built SPA from `dist`, or do nothing if it is not built.

    A function rather than a block at import so it can be tested against
    a temporary directory: whether the UI is mounted depends on the shape
    of the machine it starts on, which is exactly the kind of thing that
    is discovered to be wrong on someone else's.
    """
    if not (dist / "index.html").is_file():
        return False

    # The mount goes on FIRST. Starlette matches routes in the order they
    # were added, so a catch-all registered ahead of it would swallow
    # every hashed asset and hand back index.html with a 200 — a blank
    # page and no error anywhere.
    if (dist / "assets").is_dir():
        target.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @target.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Any path that is not a file we ship is the SPA's own route.

        The editor has no client-side router today, but a reload on a
        deep link must not 404, and a missing asset must not silently
        return index.html with a 200 — hence the file check first, and
        the containment check so `..` cannot walk out of the UI root.
        """
        # An unknown /api path is a 404, not the SPA. Answering HTML
        # with a 200 to a mistyped endpoint turns a clear failure into a
        # JSON parse error three layers away from the cause.
        if full_path.startswith("api/"):
            raise HTTPException(404, f"No such endpoint: /{full_path}")
        candidate = (dist / full_path).resolve()
        if full_path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        # index.html is never cached. Its asset references are
        # content-hashed, so a cached copy outlives the files it points
        # at: upgrade the app, and a webview holding yesterday's
        # index.html asks for a bundle this install deleted — a blank
        # window with a 404 in a console nobody opens. The assets
        # themselves may cache forever; that is what the hash is for.
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return True


mount_ui(app, DIST_DIR)
