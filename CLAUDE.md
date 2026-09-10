# Course Editor (`src/author/` + `editor/api/`)

The authoring surface for `courses/`. A plain browser app — **not** part
of the Tauri learner app, never shipped to a VM. The root
[`CLAUDE.md`](../../CLAUDE.md) covers the learner app; this file covers
the editor.

## Two processes, both required

| Piece | Command | Port |
| --- | --- | --- |
| FastAPI backend | `editor\api\.venv\Scripts\python.exe -m uvicorn app:app --port 8000 --app-dir editor\api` | 8000 |
| Vite frontend | `npm run author` | 5273 |

Normally started together by **`scripts\start-editor.ps1`** (`-Stop` to
shut both down, `-NoBrowser` for scripted use). UI at
`http://localhost:5273/index.author.html`.

**uvicorn runs WITHOUT `--reload`.** Python changes under `editor/api/`
are not live: `start-editor.ps1 -Stop` then start again. Vite serves the
frontend from source, so `src/author/*` hot-reloads.

**Port-probe trap:** on this machine uvicorn binds IPv4 only
(`127.0.0.1`) and Vite binds IPv6 only (`::1`), and Windows resolves
`localhost` to `::1` first. A `TcpClient` probe against `127.0.0.1`
reports the *running* Vite UI as down and a naive launcher restarts it
forever. Check listeners with `Get-NetTCPConnection -State Listen
-LocalPort <p>`, which is address-family agnostic.

## Coordinate before editing `src/author/*`

The editor is a live SPA reading and writing `courses/` on disk. Editing
its source triggers a Vite full reload, which **replaces every open
editor tab and takes the textarea state with it**. This cost the user an
afternoon of work on 2026-09-03.

- Ask whether the editor is open before touching `src/author/*`.
- Never instruct a blind Ctrl+S. A second tab holding an older copy
  writes it straight over newer text.
- After any disk-side edit to a guide the user has open, tell them to
  reload that lab before saving.
- Editing `editor/api/*` is safe (no reload), but needs a restart to
  take effect.

The 2026-09-03 guards reduce the damage but don't remove the need to
coordinate:

- **`bodyHash` / 409** — `saveLab` sends the hash the body was loaded
  at; the API refuses a save when disk has moved on. The next Save
  overwrites deliberately (`forceNext`).
- **localStorage drafts** (`pcm-author-draft:<course>/<lab>`) — restored
  on load only when `baseHash` still matches disk, so a stale draft is
  dropped rather than resurrected.
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

## Preview fidelity is a contract, not a convention

`Preview.tsx` must render a lab **exactly** as the learner sees it.
Anything that decides how a guide looks lives in `../components` and is
imported by both surfaces:

- [`GuideHeader.tsx`](../components/GuideHeader.tsx) — title, `~N min`,
  video badge, description, progress bar.
- [`guideBody.ts`](../components/guideBody.ts) — `stripLeadingH1`,
  `countSteps`, `tracksProgress`.

Never re-implement those in the editor. Before this was shared, the
preview showed a leading H1 learners never see (rendered near-invisible,
1.23:1 contrast, because it inherited the dark chrome's colour on the
white preview surface), omitted the whole learner header, and numbered
steps on `noProgress` labs whose own prose said they don't track steps.

`WelcomePane.tsx` follows the same rule — it previews with the app's real
`WelcomeScreen`, fed from live `course.json` + the structure tree.

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

## Tauri shims

The preview reuses learner components that import `@tauri-apps/*` at
module load. `vite.author.config.ts` aliases them to inert browser
versions in `src/author/shims/`. Two `[refresh] skipped: Tauri backend
unavailable` errors in devtools are **expected**, not a fault.

The author config has its own `cacheDir` (`node_modules/.vite-author`) —
sharing the learner app's optimizer cache makes the two dev servers
re-optimize over each other and pages hang.

## Backend

`editor/api/routers/`: `courses` (course.json, structure, delete),
`labs` (body + manifest, hash guard), `assets`, `imports` (PDF/DOCX/PPTX
→ course), `ai` (rewrite/review/generate, multi-provider), `export`,
`publish`, `settings`. The editor writes straight into `courses/<id>/`.

**⇧ Publish** does the whole loop: commit + push the authoring repo,
then publish the course to the distribution repo VMs sync from (skipping
a course-root `README.md`). It commits as
`jporeilly@users.noreply.github.com` — GH007 email privacy blocks the
hotmail address.

Pytest smoke suite: `cd editor/api && python -m pytest -q` (also a CI job).
