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
| The scaffolder + verifier | `api/core.py`, `routers/{labs,courses,imports}.py` | `node <script>` run with `cwd=REPO_ROOT` |
| The release machinery | `scripts/bump-version.mjs` | `<PCM>/scripts/lib/version-carriers.mjs` |

The third one is easy to miss: the editor does not reimplement course
scaffolding, it **shells out to the app's scripts** — `new-course.mjs`,
`new-lab.mjs`, `stamp-manifests.mjs` and `verify-course.mjs`, all run
with `cwd=REPO_ROOT`. So the editor also needs **Node on PATH** and the
app's `scripts/` present, not merely its `src/` and `courses/`. One
source of truth for `SUMMARY.md` wiring and manifest metrics is the whole
point; don't grow a second copy here.

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

**Scroll sync** (`scrollSync.ts`) links the two panes. Proportional,
not line-for-line: a line-accurate map needs every source line's rendered
height measured on each keystroke, and markdown blocks are uneven enough
(a fence is tall in both, a table is short in source and tall rendered)
that it buys little. The care is in the feedback loop - syncing A onto B
makes B fire its own scroll event straight back - so one pane holds a
lock while it drives and releases a beat later, because a wheel gesture
arrives as a burst and an eager release lets the far pane take over
mid-gesture.

**The markdown source is painted twice** (`markdownTokens.ts`): a layer
of coloured blocks, and the textarea on top with transparent text and a
visible caret. A textarea cannot colour its own contents, so this is the
only route short of replacing it. That makes exactness the whole game -
the two must agree on every character's position, or the colours slide
out from under the text, worst at the foot of a long guide where it
reads as the highlighter simply being wrong.

Three things bite, and only the first is obvious:

* The tokeniser never changes the text. It escapes, wraps in spans, and
  adds nothing. Thirteen round-trip tests assert that stripping the
  markup returns the input byte for byte.
* **A scrolling textarea grows a scrollbar, which narrows the width its
  text wraps at.** The layer, not scrolling, stayed 15px wider and
  wrapped two lines fewer over a 107-line guide — with boxes, fonts and
  padding all matching perfectly. Both reserve the gutter ALWAYS; the
  layer's scrollbar is painted transparent rather than given zero width,
  because zero width hands the gutter back and reopens the gap.
* One block per source line, not one `<pre>`. A `<pre>` ending in `\n`
  renders a line short, and blank lines collapse — hence the `min-height`
  on `.hl-line`. Blocks count exactly as a textarea does.

The gutter is **padding, not a column**: each number hangs in the padding
of the block it labels, so it cannot drift from its line the way a
separate column with its own wrapping would. The current-line band and
fence-pair classes are written straight onto those nodes rather than
re-rendered — the caret moves far more often than the text changes.

**The command palette** (`commandRanking.ts`, `CommandPalette.tsx`) on
Ctrl/Cmd+/ or Ctrl/Cmd+Shift+P. Commands are generated from `BLOCKS` and
call the same `insert()` the menus do — never a second list, which is how
the Callout menu once ended up missing a kind the renderer supported.
Ranking is deliberately explicable (exact, prefix, contains, group,
title, then subsequence) with ties holding registry order, so the list
does not reshuffle as you type.

**Its logic file is `commandRanking.ts`, not `commandPalette.ts`,** and
that is not a style choice: PascalCase component beside camelCase module
is this repo's convention everywhere else, but `CommandPalette.tsx` and
`commandPalette.ts` are THE SAME FILE on Windows. tsc rejects it
(TS1149), and once renamed, Vite keeps serving the old module id from its
graph — a case-only rename needs the dev server restarted, not refreshed.

**Find & replace** (`findReplace.ts`, `FindBar.tsx`) on Ctrl/Cmd+F. The
browser's own binding is suppressed deliberately: it searches the
RENDERED page, so it hits the preview and the sidebar and never the
markdown source. Plain substring, never regex - guides are full of `**`,
`[`, `(`, `$` and `|`, and an author typing `**Note:**` into a regex box
gets an error or silence. `replaceAll` splices from a fixed match list
right to left: rescanning would never terminate when the replacement
contains the needle (`lab` to `lab guide`), and a left-to-right splice
shifts every later offset into the middle of a word.

**The structure filter hides rows, it never rebuilds the list.** Reorder
and inline rename address a lab by its `[topicIndex, labIndex]` position,
so a filtered array renumbers every lab after the first hidden one and
moves the wrong file. Dragging is off while filtering for the same
reason. Both maps still run over everything; only the output is dropped.

**Eight editor palettes, two preview themes** (`theme.ts`). The *editor*
theme is comfort; the *preview* theme is correctness — learners run the app in
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
| Frontend | `npm test` (vitest) | 144 tests, 12 files |
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

## Versioning

`scripts/bump-version.mjs` moves the version everywhere it is written
down, and `--check` asserts the carriers agree (wired as
`npm run bump` / `npm run version:check`). The **mechanics are shared**
with the app's bump script and live in
`<PCM>/scripts/lib/version-carriers.mjs`; what stays here is only the
carrier list, because that is the part that genuinely differs:

| Carrier | Key |
| --- | --- |
| `package.json` | `version` |
| `package-lock.json` | `version` (top level) |
| `package-lock.json` | `packages[""].version` |
| `CHANGELOG.md` | the newest `## [x.y.z]` heading |

**The lockfile is a carrier, and the app's script does not treat it as
one.** That is not a stylistic difference: the Content Manager's lock sat
at 0.4.41 while the project shipped 0.4.46, and nothing noticed, because
`version:check` over there looks at four files and none of them is the
lockfile. npm rewrites both keys on install, so they drift every time a
version moves without one. If the app's script is ever revisited, this is
the gap to close.

A bump **refuses when `[Unreleased]` is empty**, so a release cannot be
cut with no notes, and refuses to touch `package-lock.json` unless it is
still the 2-space JSON npm writes — reformatting 3,800 lines to change
two would bury the real edit. Bumping to a version the changelog already
lists **skips the changelog** rather than adding a second heading for it,
which is what a drift-repair bump needs: `bump 1.0.0` when only the
lockfile fell behind fixes the lockfile and leaves the notes alone.

**Always pass `--` through npm.** `npm run bump 1.1.0 --dry-run` claims
`--dry-run` for npm itself and never forwards it, so the "dry run"
performs a **real bump**. The form that works is
`npm run bump -- 1.1.0 --dry-run`, or call the script directly.

**Line endings are load-bearing.** `core.autocrlf` is true here with no
`.gitattributes`, so every checked-out file is CRLF while npm writes the
lockfile LF. The shared module reads LF-normalised and writes back in the
file's own style. Skipping that is not cosmetic: the lockfile guard
compares against an LF round-trip, so on a fresh Windows checkout it
could never pass, and the changelog edit would splice LF lines into a
CRLF file.

Because the machinery is over there, **a bump needs the Content Manager
present** - the one operation here that otherwise touches only this
repo's own files. It fails with a plain "install the Content Manager
first" rather than a stack trace. The alternative was a second copy of
the same sixty lines, which is what this replaced — and those two copies
diverged immediately: this one was written with the lockfile carrier and
three fixes the app's had never had, and keeping them level meant porting
each one across by hand. The mechanics are pinned by
`<PCM>/scripts/lib/version-carriers.test.ts` (18 tests), so a change over
there that would break a bump here fails a test rather than a release.
