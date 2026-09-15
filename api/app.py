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

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import core
from routers import courses, labs, assets, ai, settings, imports, export, publish

app = FastAPI(title="Pentaho Content Editor API")

# The Vite dev server (author frontend) runs on a different port, so
# allow cross-origin from localhost during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

for _module in (courses, labs, assets, ai, settings, imports, export, publish):
    app.include_router(_module.router)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "coursesDir": str(core.COURSES_DIR), "exists": core.COURSES_DIR.exists()}
