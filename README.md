# Pentaho Content Editor (visual authoring app)

A local, browser-based **visual editor** for the courses in this repo. It
removes the "you must know markdown and hand-edit JSON" barrier: pick a
course and lab, edit the guide with an insert-block toolbar, watch a
**live preview rendered by the app's own renderer**, and save — the lab's
`manifest.json` metrics are recomputed for you on save.

This is an **authoring tool that runs on your machine only.** It is *not*
shipped to the learner VMs — those run the Tauri renderer. The editor and
the learner app deliberately stay separate (see the "React + FastAPI vs
Tauri" decision in [`../CLAUDE.md`](../CLAUDE.md)).

```text
editor/
  api/            FastAPI backend — read/write over ../courses/
    app.py
    requirements.txt
  README.md       (this file)

src/author/       React frontend (reuses the app's MarkdownBody renderer)
vite.author.config.ts
index.author.html
```

## Running it

Two processes: the FastAPI backend and the Vite frontend.

**1. Backend** (once: create a venv and install):

```bash
cd editor/api
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate on Unix
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

**2. Frontend** (from the repo root, in a second terminal):

```bash
npm run author                  # Vite dev server on http://localhost:5273
```

Open http://localhost:5273/index.author.html. If the frontend can't reach
the API it shows the exact commands above.

> Point the frontend at a non-default API with `VITE_EDITOR_API`, e.g.
> `VITE_EDITOR_API=http://localhost:9000 npm run author`.

## What works today

- Course picker + a **structure tree** of topics and labs.
- **Reorder** labs (up/down, across topic boundaries) — persists to
  `SUMMARY.md` and re-sequences every lab's manifest `order`.
- **Rename** a lab inline (double-click) — updates the manifest title and
  the `SUMMARY.md` link text.
- **New lab** — delegates to `scripts/new-lab.mjs` (one source of truth
  for lab creation + SUMMARY wiring).
- **Pentaho docs grounding (GitBook MCP)** — Settings can point the AI at
  the Pentaho docs' GitBook MCP endpoint (`https://docs.pentaho.com/~gitbook/mcp`).
  When enabled, lab generation, import, and rewrite first search the docs
  and use the results as grounding context, so drafts track the real
  product. A **Test** button confirms the endpoint is reachable.
- **✨ AI Lab** — draft a whole lab from a title + optional outline using
  the configured **LLM provider**. The draft follows the block conventions
  (H1, callouts, `## ` steps, `::: tabs`), is saved as a new lab, and opens
  for review. The button disables + explains itself when the provider
  isn't ready. Author-side only.
- **AI providers + Settings (⚙ in the header)** — choose **Ollama**
  (local, free, no key), **Anthropic** (Claude, via the official SDK), or
  **OpenAI** (GPT), and pick the model per provider. A **connection
  indicator** in the header shows the active provider, model, and status
  (green = connected). Provider prefs persist to a gitignored
  `editor/api/settings.json`; **API keys are never stored** — they're read
  from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the environment, and the
  Settings panel only shows whether each is detected. `pip install -r
  requirements.txt` pulls the `anthropic` + `openai` SDKs (Ollama needs
  neither).
- **New Course** / **Verify** in the top toolbar (scaffold a course from
  the blank template; run the guideline checker in-app).
- **⬆ Import — create a course from a document** — upload a **PDF, DOCX,
  PPTX, Markdown, or text** file; the LLM proposes a course outline
  (title + topics + labs) you review and edit, then it generates each lab
  grounded in the source and scaffolds the whole course. Text extraction
  uses `pypdf` / `python-docx` / `python-pptx` (author-side only). Uses the
  configured provider, so an LLM must be set up in Settings.
- Markdown editor with a **Format row** (bold, italic, inline code,
  strikethrough — the same `toggleWrap` the Ctrl-keys call, so a button
  and its shortcut cannot disagree) and an **insert-block toolbar**
  grouped into Heading / Callout / List / Text / Media / Block / Pentaho
  menus, so authors never memorise syntax:
  - **Media** — image (flush-left with a centred caption), centred and
    float-left/right image variants, **Video** (a Vimeo link, keeping the
    Unlisted `id/hash` shape), **Video — with caption** (the house form
    for a lab clip: a figure whose `pcm-video-caption` figcaption gets
    the same ▶ icon the Welcome page's tour row uses), and PDF embeds.
  - **Callout** — all seven kinds the renderer parses, including
    *Success* and *Under the hood*, plus a plain untagged quote.
  - **Text** — Highlight / Muted / Attention and centre/right alignment.
    Semantic, mapped to theme tokens: no raw colour (it would fail one
    theme) and no font size (a fake heading drops that step out of
    progress tracking, since step ids come from real `h2`/`h3` text).
  - **Pentaho** — launcher and graph buttons, and all five
    `data-env-check` profiles by name (`""`, `tryit`, `server`, `ai`,
    `streaming`), the insert whose *spelling* decides behaviour.
  - **Block / List** — code, `::: tabs`, tables, links, dividers,
    `<details>` collapsibles, and task lists.
- **Live preview** using the real `src/components/MarkdownBody` — callouts,
  tabs, code-copy, videos, and glossary terms render exactly as the
  packaged app shows them. (The Tauri-only bits are shimmed — see
  `src/author/shims/` and the aliases in `vite.author.config.ts`.)
- **Save** writes `guide.md` and re-stamps `manifest.json`
  (`stepCount` / `estimatedMinutes` / `hasVideo`), mirroring
  `scripts/stamp-manifests.mjs`. `Ctrl/Cmd+S` also saves.
- **Publish to VMs (⚙ Course → Publish to VMs)** — pushes the course to
  the central [Pentaho-Courses](https://github.com/jporeilly/Pentaho-Courses)
  distribution repo that provisioned VMs sync from on every app launch.
  **Check changes** shows an added/changed/removed file summary against
  the repo's HEAD (line-ending-insensitive, like git); **Publish**
  commits and pushes with an optional message; **Tag** cuts a release
  tag (`v2026.07`) so workshop images pinned with
  `set-git-source -Ref <tag>` stay frozen. Uses the git credentials
  already on the author's machine; a persistent clone lives in the
  gitignored `editor/api/.publish-cache/`. Backend:
  `editor/api/routers/publish.py`.
- **Delete a course (⚙ Course → Danger zone)** — permanently removes
  `courses/<slug>/` from disk. The button stays disabled until you type
  the confirmation phrase **delete**, and the backend independently
  refuses the request without it (HTTP 428). Installed copies in the
  app and anything already published to Pentaho-Courses are untouched.

## Not yet (next phases)

- Native drag-and-drop reordering (today it's up/down buttons).
- Forms for `course.json` and lab metadata (description/kind), and
  in-editor **new course**.
- Image upload into `_assets/` and a `files/` manager.
- Exam authoring stays in the Question Bank app.

## How the preview reuse works

The frontend imports the app's `MarkdownBody` directly. That component
pulls in a few `@tauri-apps/*` modules (external-link open, launcher
`invoke`, window). `vite.author.config.ts` aliases those three imports to
inert browser shims in `src/author/shims/`, and `Preview.tsx` wraps the
renderer in the `ToolPanelProvider` + `GlossaryProvider` its hooks need.
Asset URLs resolve through the backend's `/tree/` endpoint, so
`../_assets/images/x.png` and `files/y.png` load just like in production.
