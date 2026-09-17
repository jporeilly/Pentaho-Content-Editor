# Pentaho Content Editor

A local, browser-based **visual editor** for Pentaho Content Manager
courses. It removes the "you must know markdown and hand-edit JSON"
barrier: pick a course and lab, edit the guide with an insert-block
toolbar, watch a **live preview rendered by the learner app's own
Engine**, and save — the lab's `manifest.json` metrics are recomputed
for you.

This is an **authoring tool that runs on your machine only.** It is *not*
shipped to the learner VMs — those run the Tauri app. The two stay
deliberately separate, and since 2026-09-15 they are separate
repositories with separate version numbers.

## It needs the Content Manager first

The editor has no courses of its own and no Engine of its own. Install
[Pentaho Content Manager](https://github.com/jporeilly/Pentaho-Content-Manager)
**first**, then this. It reaches into that repository four ways:

| What | Where it looks |
| --- | --- |
| The Engine (preview fidelity) | `<PCM>/src`, via the `@app` alias |
| The courses it edits | `<PCM>/courses` |
| The scaffolder + verifier it shells out to | `<PCM>/scripts/*.mjs`, run with Node |
| The version-bump machinery | `<PCM>/scripts/lib/version-carriers.mjs` |

By default that is the **sibling directory** `../Pentaho-Content-Manager`.
If it lives elsewhere, set **`PCM_REPO`** to its root — both the frontend
and the backend honour it, and both fail with a clear message rather than
a stack trace if the target is missing.

```
C:\Projects\
  Pentaho-Content-Manager\      <- install this first
  Pentaho-Content-Editor\       <- this repo
```

## Layout

```text
src/            React frontend (imports the app's Engine through @app)
  shims/        inert browser stand-ins for the @tauri-apps modules
api/            FastAPI backend — reads and writes <PCM>/courses/
  routers/      courses, labs, assets, imports, ai, export, publish, settings
  .venv/        backend virtual environment (gitignored)
icons/          editor.ico
index.html   vite.config.ts   vitest.config.ts   tsconfig.json
start-editor.ps1
```

## Installing it

There is a Windows installer, built from [`desktop/`](desktop/README.md):
a Tauri shell that starts the editor's own server on a free port and
points a webview at it, carrying **its own Python runtime** so the
machine needs none. No venv, no `pip install`, no two terminals.

```powershell
cd desktop
npm install          # once
npm run dist         # -> dist\Pentaho Content Editor_<version>_x64-setup.exe
```

The installed editor asks on first run where your Content Manager
checkout is — the courses are not bundled and never will be, because
they are that repository's content and this edits it in place. It also
reports what the machine is missing: **Node.js** (used for New Course,
New Lab, Import and Verify, which run the Content Manager's own scripts)
and **git** (Publish). Neither is bundled; without them the editor still
opens, edits, saves, previews and runs its AI actions.

Everything below is the development flow, from a checkout.

## Running it

**The easy way** — `start-editor.ps1` in the repo root starts both halves,
waits for them, and opens the browser:

```powershell
.\start-editor.ps1              # -Stop to shut both down, -NoBrowser for scripts
```

**By hand**, two processes. First-time backend setup:

```powershell
py -3 -m venv api\.venv
api\.venv\Scripts\python -m pip install -r api\requirements.txt
```

Then, in two terminals:

```powershell
cd api; .venv\Scripts\python -m uvicorn app:app --port 8000
```

```powershell
npm install; npm run dev        # Vite dev server on http://localhost:5273
```

Open <http://localhost:5273/>. If the frontend can't reach the API it
shows these commands on the splash screen.

> Point the frontend at a non-default API with `VITE_EDITOR_API`, e.g.
> `VITE_EDITOR_API=http://localhost:9000 npm run dev`.

**A note on ports.** uvicorn binds IPv4 only and Vite binds IPv6 only on
Windows, while `localhost` resolves to `::1` first — so a naive "is it
up?" probe against `127.0.0.1` reports the running UI as down. Check with
`Get-NetTCPConnection -State Listen -LocalPort 5273`, which is
address-family agnostic. `start-editor.ps1` already does this, and names
the owner if something foreign holds the port.

## What it does

**Course and lab management**

- Course picker and a **structure tree** of topics and labs, with a
  **filter box** over it. Dragging is disabled while a filter is active,
  because a drop lands relative to the labs you can see.
- **Drag to reorder** labs, across topic boundaries — persists to
  `SUMMARY.md` and re-sequences every lab's manifest `order`.
- **Rename** a lab inline (double-click) — updates the manifest title and
  the `SUMMARY.md` link text.
- **New course** and **new lab** in-editor; both delegate to the Content
  Manager's `scripts/new-course.mjs` / `new-lab.mjs`, so there is one
  source of truth for scaffolding and `SUMMARY.md` wiring.
- **Course settings (⚙)** — a form over `course.json`, including the
  Welcome page's fields, with unknown keys preserved on save.
- **Lab files** — manage the `files/` and `_assets/` a lab ships.
- **Verify** — runs the Content Manager's guideline checker in-app, and
  marks each problem on the line, and under the exact text, it is about.
- **Delete a course (⚙ → Danger zone)** — permanently removes
  `courses/<slug>/` from disk. The button stays disabled until you type
  **delete**, and the backend independently refuses without it (HTTP
  428). Installed copies and anything already published are untouched.

**Writing**

- Markdown editor with a **Format row** (bold, italic, inline code,
  strikethrough — the same `toggleWrap` the Ctrl-keys call, so a button
  and its shortcut cannot disagree) and an **insert-block toolbar**
  grouped into Heading / Callout / List / Text / Media / Block / Pentaho
  menus, so authors never memorise syntax.
- Four blocks open a **dialog with a live preview** rather than pasting a
  stub: **Table** (shape + per-column alignment), **Tidy table** (re-pad
  the table at the cursor), **Tabs** (name your own tabs), and
  **Callout — with title**.
- **Callout** — all seven kinds the Engine parses: Note, Tip, Warning,
  Critical, Success, Objectives, and **Under the hood**, the teaching
  panel that goes *after* an action to explain what the engine did.
- **Media** — image (flush-left with a centred caption), centred and
  float-left/right variants, **Video** (a Vimeo link, keeping the
  Unlisted `id/hash` shape), **Video — with caption** (the house form for
  a lab clip), and PDF embeds. Paste or drop an image straight in.
- **Text** — Highlight / Muted / Attention and centre/right alignment.
  Semantic, mapped to theme tokens: no raw colour (it would fail one
  theme) and no font size (a fake heading drops that step out of progress
  tracking, since step ids come from real `h2`/`h3` text).
- **Pentaho** — launcher and graph buttons, and all five `data-env-check`
  profiles by name (`""`, `tryit`, `server`, `ai`, `streaming`), the
  insert whose *spelling* decides behaviour.
- **Block / List** — code (with the language picker), `::: tabs`, links,
  dividers, `<details>` collapsibles, and task lists.
- **Go to → Outline** jumps to any heading, and is fence-aware so a `#`
  inside a code block is never mistaken for one.
- **The markdown source is colour-coded** with the same hues as the
  insert menus: a heading is blue in the toolbar and blue in the source,
  Media cyan in both, code green in both. Line numbers in the gutter, a
  band on the current line, and both markers of a fenced block lit when
  the caret is inside it - an unclosed fence lights only its opener.
  Turn the colouring off from the Theme menu if you would rather not.
- **A command palette** on `Ctrl/Cmd+/` (or `Ctrl/Cmd+Shift+P`) reaches
  every insert block by name - type, arrow, Enter. It is built from the
  same registry as the menus and inserts through the same path, so the
  two can never offer different things.
- **Find & replace** on `Ctrl/Cmd+F` - plain substring, not regex, since
  guides are full of `**`, `[`, `(`, `$` and `|`. Enter and Shift+Enter
  walk the matches, Escape closes. The browser's own find is suppressed
  deliberately: it searches the rendered page, not your markdown.
- Each insert family carries its own **hue** - a marker under the label
  and the same colour on its open popover - so the row is scannable
  without reading all ten labels.

**Preview and save**

- **Live preview** using the learner app's real `MarkdownBody` — callouts,
  tabs, code-copy, videos and glossary terms render exactly as the
  packaged app shows them. The Tauri-only bits are shimmed (`src/shims/`,
  aliased in `vite.config.ts`).
- **Scroll sync.** The preview follows the editor and the editor follows
  the preview, proportionally, so the two panes always show the same part
  of the lab.
- **Eight editor palettes**: Midnight, Daylight, Ocean, Ember, Forest,
  Plum, Parchment and Contrast. The *editor* theme is comfort; the
  *preview* theme is correctness — learners run the app in either, and a
  guide that reads fine on white can be unreadable on the dark surface.
  Flipping the preview catches that while authoring.
- **Save** writes `guide.md` and re-stamps `manifest.json` (`stepCount` /
  `estimatedMinutes` / `hasVideo`), mirroring the app's
  `scripts/stamp-manifests.mjs`. `Ctrl/Cmd+S` also saves. A save is
  refused (409) if the file changed on disk since you loaded it.

**AI assistance**

- **AI providers + Settings (⚙ in the header)** — choose **Ollama**
  (local, free, no key), **Anthropic** (Claude) or **OpenAI**, and pick
  the model per provider. A connection indicator shows the active
  provider, model and status. Preferences persist to a gitignored
  `api/settings.json`; **API keys are never stored** — they are read from
  `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in the environment and Settings
  only reports whether each is detected.
- **🔍 Review — an AI read of the open lab, marked in the source.** Each
  finding quotes the text it is about, and the editor finds that text in
  the buffer and underlines it; click a quote in the panel to jump to it.
  Findings whose quote is **not in the guide** are listed separately
  instead of being marked, which is how a confident remark about a lab
  the model half-invented is caught rather than followed — on the first
  live run it demanded the removal of a section that existed only in its
  own prompt. Because the marks are re-anchored to the buffer as you
  type, a finding you have fixed reports itself as fixed rather than
  drifting onto another line.
- **✨ AI Lab** — draft a whole lab from a title and optional outline. The
  draft follows the block conventions, is saved as a new lab and opens
  for review. The button disables and explains itself when no provider is
  ready.
- **⬆ Import — create a course from a document** — upload a **PDF, DOCX,
  PPTX, Markdown or text** file; the LLM proposes an outline you review
  and edit, then generates each lab grounded in the source and scaffolds
  the course. Extraction uses `pypdf` / `python-docx` / `python-pptx`.
- **Pentaho docs grounding (GitBook MCP)** — point the AI at the Pentaho
  docs' MCP endpoint (`https://docs.pentaho.com/~gitbook/mcp`) and lab
  generation, import and rewrite search the docs first, so drafts track
  the real product. A **Test** button confirms it is reachable.

**Publishing**

- **Publish to VMs (⚙ Course → Publish to VMs)** — pushes the course to
  the central [Pentaho-Courses](https://github.com/jporeilly/Pentaho-Courses)
  distribution repo that provisioned VMs sync from on every app launch.
  **Check changes** shows an added/changed/removed summary against the
  repo's HEAD (line-ending-insensitive, like git); **Publish** commits and
  pushes with an optional message; **Tag** cuts a release tag (`v2026.07`)
  so workshop images pinned with `set-git-source -Ref <tag>` stay frozen.
  Uses the git credentials already on your machine; a persistent clone
  lives in the gitignored `api/.publish-cache/`.

## Development

```powershell
npm test                        # frontend, vitest
npm run build                   # tsc + Vite production build
cd api; .venv\Scripts\python -m pytest -q      # backend
```

The backend venv is normally built from `requirements.txt`, which does
**not** include pytest. Add the dev deps once:

```powershell
api\.venv\Scripts\python -m pip install -r api\requirements-dev.txt
```

`npm run build` bundles the learner app's Engine through `@app`, so it
is also the check that the cross-repo wiring still holds.

### Versioning

```powershell
npm run version:check                 # assert every carrier agrees
npm run bump -- 1.1.0                 # move them all, and date the changelog
npm run bump -- 1.1.0 --dry-run       # show what would change, write nothing
```

Note the `--`. Without it npm claims `--dry-run` for itself and never
passes it on, so `npm run bump 1.1.0 --dry-run` performs a **real** bump.
Run the script directly (`node scripts/bump-version.mjs 1.1.0 --dry-run`)
if you would rather not think about it.

The version lives in `package.json`, both version keys in
`package-lock.json`, and the newest `## [x.y.z]` heading in
`CHANGELOG.md`. A bump promotes `[Unreleased]` to a dated heading and
opens a fresh one, and refuses if there are no release notes to promote.

See [`CLAUDE.md`](CLAUDE.md) for the architecture, the layout rules, and
the traps worth knowing before changing anything.

## Not yet

- Exam authoring stays in the Question Bank app.
