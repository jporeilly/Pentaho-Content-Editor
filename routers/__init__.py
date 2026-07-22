"""Domain routers for the course-editor API.

Each module exposes a ``router`` (an ``APIRouter``); ``app.py`` mounts
them. Split by domain so each file stays small and testable:

* ``courses``  — course-level CRUD (course.json, verify)
* ``labs``     — labs + the SUMMARY.md structure tree + AI lab drafting
* ``assets``   — the asset tree endpoint, image uploads, lab files
* ``ai``       — rewrite / review / chat over the configured LLM
* ``settings`` — LLM provider settings + health/suggest/docs-test
* ``imports``  — build a course from an uploaded document
* ``export``   — export a course .zip / install it locally
"""
