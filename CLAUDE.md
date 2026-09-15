# Pentaho Content Editor

The authoring surface for Pentaho Content Manager's `courses/`. A plain
browser app — **not** part of the Tauri learner app, never shipped to a
VM, and since 2026-09-15 no longer part of its repository either.

Its own repo (`jporeilly/Pentaho-Content-Editor`, private), its own
dependencies, version (`package.json`, currently 1.0.0) and
[`CHANGELOG.md`](CHANGELOG.md). Entries before 1.0.0 live in the learner
app's changelog, where the editor had no version of its own.

## It needs the Content Manager installed first

The editor edits *that* app's courses and previews them with *that* app's
renderer, so it is useless alone. **Install order is Content Manager,
then editor.** Both halves find it the same way — the sibling directory
by default, overridden by the **`PCM_REPO`** environment variable:

| Hook | Where | Resolves to |
| --- | --- | --- |
| The renderer | `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | `@app` → `<PCM>/src` |
| The courses | `api/core.py` | `COURSES_DIR` → `<PCM>/courses` |

Both fail loudly rather than mysteriously: the Vite config throws naming
`PCM_REPO` if the app's `src/` is absent, and `api/core.py` raises an
"install the Content Manager first" error if `courses/` is.

Because the renderer lives outside this project root, Vite needs the app
repo in `server.fs.allow` — it is, alongside `.`.

## Two processes, both required

| Piece | Command | Port |
| --- | --- | --- |
| FastAPI backend | `api\.venv\Scripts\python.exe -m uvicorn app:app --port 8000 --app-dir api` | 8000 |
| Vite frontend | `npm run dev` | 5273 |

Normally started together by **`start-editor.ps1`** in the repo root
(`-Stop` to shut both down, `-NoBrowser` for scripted use). UI at
`http://localhost:5273/`.

**uvicorn runs WITHOUT `--reload`.** Python changes under `api/` are not
live: `start-editor.ps1 -Stop` then start again. Vite serves the frontend
from source, so `src/*` hot-reloads.

**Port-probe trap:** on this machine uvicorn binds IPv4 only
(`127.0.0.1`) and Vite binds IPv6 only (`::1`), and Windows resolves
`localhost` to `::1` first. A `TcpClient` probe against `127.0.0.1`
reports the *running* Vite UI as down and a naive launcher restarts it
forever. Check listeners with `Get-NetTCPConnection -State Listen
-LocalPort <p>`, which is address-family agnostic. Port 5273 also
collided silently with Media Studio's dev server until that moved to
5681; the launcher now names a foreign port owner rather than looping.

**Start it from Explorer, not from a tool shell.** A Vite started by an
agent's shell cannot unlink files under `node_modules`, so the optimizer
commit fails and the page serves 200s while every module 504s with
`Outdated Optimize Dep` — a blank editor with a healthy-looking server.

## Coordinate before editing `src/*`

The editor is a live SPA reading and writing `courses/` on disk. Editing
its source triggers a Vite full reload, which **replaces every open
editor tab and takes the textarea state with it**. This cost the user an
afternoon of work on 2026-09-03.

- Ask whether the editor is open before touching `src/*`.
- Never instruct a blind Ctrl+S. A second tab holding an older copy
  writes it straight over newer text.
- After any disk-side edit to a guide the user has open, tell them to
  reload that lab before saving.
- Editing `api/*` is safe (no reload), but needs a restart to take
  effect.

The 2026-09-03 guards reduce the damage but don't remove the need to
coordinate:

- **`bodyHash` / 409** — `saveLab` sends the hash the body was loaded
  at as `baseHash`; `routers/labs.py` refuses the save when disk has
  moved on. The next Save overwrites deliberately (`force`).
- **localStorage drafts** (`pcm-author-draft:<course>/<lab>`, built in
  `hooks.ts`) — restored on load only when `baseHash` still matches
  disk, so a stale draft is dropped rather than resurrected.
- **`beforeunload`** warns on unsaved text.
- **Manifest-only saves** — ☑ Tracking and ⏱ timing PUT the manifest
  with a `null` body, so they can never write stale guide text.

## Layout

```
author-root
├── author-header        brand · course picker · New/Import/Course/Verify/Publish · Chat · AI pill · Save
├── author-sources / author-verify        dismissable result panels
├── author-body          flex row, both seams draggable
│   ├── author-structure-wrap   width from useSplit("pcm-author-sidebar-px"); « collapses to author-rail
│   ├── author-splitter
│   └── author-panes
│       ├── author-editor-col   flex-basis from useSplit("pcm-author-editor-px")
│       │   ├── author-editor-bar   LAB actions (Rewrite/Image/Files/Tracking/⏱/Review)
│       │   ├── author-toolbar      INSERT menus — one scrolling row
│       │   ├── author-textarea
│       │   └── ChatPanel (optional)
│       ├── author-splitter
│       └── author-preview
└── author-statusbar     the one status line
```

Two rules this layout exists to enforce, both learned from real bugs:

1. **Lab actions and insert menus never share a flex row.** They used to.
   The toolbar was `flex: 1 1 auto` beside six fixed-width buttons, so it
   collapsed to its min-content wrap width and stacked into six rows —
   249px of chrome above the textarea, with the Review button still
   clipped off the pane.
2. **The status line is never in the header.** The save-conflict message
   is a full sentence; in the header's nowrap flex row it stretched the
   header to 2010px in a 1440px window and pushed **Save off-screen** —
   at the exact moment the author needed to press it.

Pane sizes go through `clampSplit` (`Splitter.tsx`), which takes the
neighbour's floor as its own argument — it can't be derived from the
pane's `min`, because the sidebar's neighbour is the editor *and* the
preview while the editor's is the preview alone. The floor is applied
**last**, after the ceiling and the neighbour cap, so on a window too
narrow for both panes the dragged one holds its floor and the neighbour
takes the squeeze; flooring first leaves a useless sliver. Pinned by
`clampSplit.test.ts`.

Insert menus are `Menu.tsx` (button + popover), not `<select>`: a select
sizes to its widest option. The popover is `position: fixed` with
coordinates measured from the button, because the toolbar is an
`overflow-x` scroller and would clip an absolutely-positioned child.

## Insert blocks, and the ones that open a dialog

`Toolbar.tsx` holds the block registry. Most entries write markdown
straight in; four carry a `dialog` (`"table" | "tabs" | "tidy" |
"callout"`) and open a modal with a live markdown preview first, because
a fixed stub is worse than no help:

- **Table** (`TableModal`, `tableBuilder.ts`) asks for the shape and the
  per-column alignment. Tables are the third most used construct in the
  courses and the toolbar used to write a fixed 2×2 stub.
- **Tidy table** re-pads the table the cursor is in, keeping alignment.
- **Tabs** (`TabsModal`) names its own tabs — it used to write a fixed
  Windows/macOS pair, and an unclosed `:::` fence is one of the two
  errors the course verifier treats as fatal.
- **Callout — with title** (`CalloutModal`, `callouts.ts`) picks the
  kind and writes the `####` title strip. `quoteLines` prefixes **every**
  line: a multi-line callout that only quoted the first one silently
  truncated in the renderer.

**Go to → Outline** (`outline.ts`) jumps to a heading. It is fence-aware,
so a `#` inside a code block is not mistaken for a heading — including
tilde fences and fences longer than three characters.

## Preview fidelity is a contract, not a convention

`Preview.tsx` must render a lab **exactly** as the learner sees it.
Anything that decides how a guide looks is imported from the app through
`@app` — never copied. Eleven modules today, among them:

- `@app/components/MarkdownBody` — the renderer itself.
- `@app/components/GuideHeader` — title, `~N min`, video badge,
  description, progress bar.
- `@app/components/guideBody` — `stripLeadingH1`, `countSteps`,
  `tracksProgress`.
- `@app/styles/app.css` + `fonts.css` — the real stylesheet, so the
  preview inherits the app's palette rather than an approximation.

Never re-implement those here. Before this was shared, the preview showed
a leading H1 learners never see (rendered near-invisible, 1.23:1
contrast, because it inherited the dark chrome's colour on the white
preview surface), omitted the whole learner header, and numbered steps on
`noProgress` labs whose own prose said they don't track steps.

`WelcomePane.tsx` follows the same rule — it previews with the app's real
`WelcomeScreen`, fed from live `course.json` + the structure tree.

**Two themes, two questions** (`theme.ts`). The *editor* theme is
comfort; the *preview* theme is correctness — learners run the app in
either, and a guide that reads fine on white can be unreadable on the
dark surface (a hard-coded colour in inline HTML, a screenshot with a
white background, a callout with no dark variant). Both are classes on
`<html>`, which is where the app itself puts `pcm-dark`.

**The code-menu contract is two tests, one per repo.** The app keeps
"every language in the registry has a grammar"
(`src/components/codeLanguages.test.ts` over there); the editor keeps
"the menu only writes a fence that registry knows"
(`src/codeMenu.test.ts` here, importing through `@app`). One file cannot
import across two repositories, so both halves have to exist.

## The Welcome page has no `guide.md`

It is generated from `course.json` (`title`, `description`,
`welcome.{eyebrow,video,caption,analyticsNote}`, `moduleSummaries`,
`mode`, `kind`, `theme`, `launchers`, `certification`) plus the topic
tree. `WelcomePane` edits those fields against a live preview; the ⚙
Course modal still edits the same `welcome` block, and both preserve
unknown keys (`welcomeRest`) so nothing is dropped on save.

`moduleSummaries[].title` must match a topic title in `SUMMARY.md`
post-prefix-strip. **⟳ Sync topics** adds a row for every unmatched
topic rather than making the author hand-match them.

## Tauri shims — keep three configs in step

The preview reuses learner components that import `@tauri-apps/*` at
module load, so they are aliased to inert browser versions in
`src/shims/`. Two `[refresh] skipped: Tauri backend unavailable` errors
in devtools are **expected**, not a fault.

The aliases (`@app` and the three shims) are declared in **three** files
and must agree: `vite.config.ts` (dev + build), `vitest.config.ts`
(tests) and `tsconfig.json` `paths` (type-checking).

**A shim whose signature disagrees with the thing it stands in for is a
trap.** While the shims were only a *Vite* alias, tsc still checked the
renderer against the genuine `@tauri-apps` types, so nobody noticed the
`invoke` shim took one argument where the real API takes two. Mapping
them in `tsconfig.json` during the repo split turned every two-argument
call into a type error. Fixed — but keep signatures honest.

There is no `cacheDir` override any more, and none is needed: separate
repos mean separate `node_modules`, so the two dev servers can no longer
re-optimize over each other's cache.

## Backend

`api/routers/`: `courses` (course.json, structure, delete), `labs` (body
+ manifest, hash guard), `assets`, `imports` (PDF/DOCX/PPTX → course),
`ai` (rewrite/review/generate, multi-provider), `export`, `publish`,
`settings`. The editor writes straight into `<PCM>/courses/<id>/`.

`api/settings.json` holds the machine-specific LLM provider config. It is
**gitignored and has never been committed** — recreate it by hand on a
new machine rather than looking for it in history.

Pasted images are named `<epoch-ms>.png` — just the number, no
`pasted-` prefix.

**⇧ Publish** does the whole loop: commit + push the authoring repo,
then publish the course to the distribution repo VMs sync from (skipping
a course-root `README.md`, which is the internal ops runbook; nested
`README.md` files still publish). It commits as
`jporeilly@users.noreply.github.com` — GH007 email privacy blocks the
hotmail address.

## Tests

| Suite | Command | Size |
| --- | --- | --- |
| Frontend | `npm test` (vitest) | 76 tests, 8 files |
| Backend | `cd api && .venv\Scripts\python -m pytest -q` | 39 tests |

The backend venv is normally created from `requirements.txt` alone, which
does **not** include pytest — `python -m pytest` then fails with "No
module named pytest" on an otherwise healthy install. Add the dev deps
once:

```
api\.venv\Scripts\python -m pip install -r api\requirements-dev.txt
```

`npm run build` runs `tsc` then a Vite production build, which bundles
the app's renderer through `@app` — so it is the check that the
cross-repo wiring still holds.

## Known gaps

- **`npm run version:check` and `npm run bump` are broken.** Both call
  `scripts/bump-version.mjs`, which stayed behind in the Content Manager
  during the split; here it fails with `MODULE_NOT_FOUND`. Either port
  the script or drop the two entries from `package.json`.
- **`README.md` still describes the pre-split layout** (`editor/`,
  `src/author/`, `vite.author.config.ts`, `index.author.html`, and a
  `../CLAUDE.md` link that now points outside the repo). Accurate about
  behaviour, wrong about every path.
