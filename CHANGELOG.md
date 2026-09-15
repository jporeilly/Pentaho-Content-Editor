# Changelog — Pentaho Content Editor

The authoring surface for `courses/`. Versioned separately from the
Pentaho Content Manager learner app, which it is not shipped with: the
editor runs from source on an author's machine and never reaches a VM.

Entries before 1.0.0 live in the learner app's
[CHANGELOG](../CHANGELOG.md), where the editor had no version of its own
and rode along with the app's. That is the thing 1.0.0 fixes.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Vite declared as `^8.3.0`, matching the Content Manager.** Both
  repos asked for `^8.0.10` and resolved on their own, which had put the
  editor on 8.3.0 and the app on 8.1.5. The preview imports 27 modules
  from the app through the `@app` alias, so the same source was being
  bundled by two different Vite versions - a weak footing for a preview
  whose whole job is to match what the learner sees. The resolved
  version here does not move; the declaration catches up to it.

## [1.0.0] - 2026-09-15

First version the editor has carried of its own.

Not a rewrite and not a feature release: the number marks the point the
editor stopped being a mode of the learner app and became a product with
its own lifecycle. It had already grown its own name, icon, favicon,
Desktop shortcut, backend and repo guide, and it is the tool 13 courses
and 226 guides were written in. What it lacked was a version, so a
release cut for editor-only work was still built and installed as a
learner-app release that no VM would ever receive.

### What it does as of 1.0.0

- **Structure** — course tree with drag-to-reorder, add lab/page, an AI
  lab generator, rename and delete.
- **Editing** — markdown textarea with a live preview that renders a lab
  *exactly* as the learner app does, sharing the renderer rather than
  imitating it.
- **Insert** — headings, callouts, lists, text spans, media, code fences,
  tables, tabs, and the Pentaho blocks (launch buttons, graph buttons,
  environment-check panels).
- **Tables** — a builder for shape and per-column alignment, and a tidy
  command that re-pads the table under the cursor.
- **Callouts** — every kind the renderer understands, a dialog for the
  title strip, and multi-line selections that stay inside the quote.
- **Navigation** — an outline of the lab's headings that ignores
  headings inside code fences.
- **Assets** — image upload, paste and drop, named by timestamp.
- **Course** — settings, welcome-page editor, import from PDF/DOCX/PPTX,
  glossary and exam files.
- **AI** — rewrite, review and generate, grounded against the docs.
- **Verify** — the course checker, run against the live tree.
- **Publish** — commit and push the authoring repo, then publish the
  course to the distribution repo VMs sync from.

### Known limits

- Runs from source (`scripts\start-editor.ps1`); there is no installer.
- The preview shares 27 modules with the learner app. That is deliberate
  — it is what makes the preview truthful — but it means the editor
  cannot currently be built without the learner app's source tree.
