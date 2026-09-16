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

Nothing yet.

## [1.11.0] - 2026-09-16

### Changed

- **The install stops to tell you whether it found your courses.** The
  "Find my Content Manager courses" component used to print a line into
  a details pane nobody reads and move on; now it reads the hint back
  out of the registry — from the 64-bit view, the one the app itself
  reads — confirms the folder really holds a `courses/`, and shows the
  answer. That read-back is the check that would have caught the bug
  this component shipped with: a 32-bit installer's PowerShell writes
  HKLM into WOW6432Node, so the scan succeeded, the install said so, and
  the editor read an empty key and asked on first run anyway. An exit
  code says the script thought it worked; only reading the value back
  says it did. All three outcomes — connected, nothing found, recorded
  but empty — are reported, and every dialog is behind the same guard,
  because an unattended install that stops on a dialog is one that never
  finishes.


## [1.10.0] - 2026-09-16

### Changed

- **No splash on a normal start.** The window stays hidden while the
  backend comes up and opens onto the editor already drawn — the learner
  app has no startup screen, and the author should not be able to tell
  which of the two has a server behind it. The backend answers in about
  1.4 seconds from cold on this machine, which is too short to be worth
  narrating. Nothing was deleted: the splash still loads and still polls,
  and it still holds the diagnostics, the restart button and the log —
  it is shown only when it has something to say. Three paths reveal the
  window, and the third is what makes the first two safe: a beat after
  the splash hands over to the app, at once when it fails, and
  unconditionally after two and a half seconds by a watchdog that asks
  nobody and knows nothing about the backend.
- **A fast build for iterating: `npm run dist:fast`.** A full build was
  526 seconds, and 516 of them were NSIS compressing 287 MB of vendored
  Python, Node and git into a 75 MB installer with solid LZMA. Cargo is
  five seconds of it and the UI seven, so nothing about the code was
  ever the problem. The fast build swaps the compressor for zlib, which
  trades installer size for turnaround; `npm run dist` is unchanged and
  stays the one that ships.


## [1.9.1] - 2026-09-16

### Fixed

- **Uninstalling deleted the author's settings.** The uninstall page
  offers to remove the application data, and the installer template — the
  learner app's, adopted wholesale in 1.8.0 so both install the same way
  — ticks that box by default. For a learner it is the right default:
  the folder holds course progress, and a reinstall means starting over.
  Here it holds the LLM provider, the model and the path to the Content
  Manager checkout, so an uninstall on the way to a newer build threw
  away configuration nobody had asked it to touch, and the author found
  out at the first-run screen. Unticked by default now; anyone who wants
  a clean slate can still ask for one. Pinned by
  `src/installerTemplate.test.ts`, because re-syncing the template from
  the app would restore the old default without a word.


## [1.9.0] - 2026-09-16

### Fixed

- **The AI review showed raw JSON instead of findings.** One finding in
  twelve quoted a Windows path with an unescaped backslash, `json.loads`
  rejected the entire document, and the panel fell back to printing the
  model's answer at the author — losing every anchor, mark, jump and
  Apply button the review had earned, for one character. Parsing is
  forgiving now: it repairs the two mistakes models actually make (a lone
  backslash, a trailing comma) and, failing that, reads the findings one
  object at a time, so a malformed finding costs only itself. The prompt
  also asks for valid JSON, which reduces how often any of it is needed.
- The uninstaller removes the bundled runtimes, the provisioning scripts
  and the machine-wide registry hint it wrote. The author's settings in
  `%APPDATA%` stay, deliberately — that is what lets a reinstall come
  back already configured. (Not actually true in this release: the
  uninstall page's own checkbox deleted them anyway. Fixed in 1.9.1.)

### Added

- **The installer is self-contained, and asks what to install.** It now
  carries its own Node and git alongside its own Python, so a Full
  install scaffolds, verifies and publishes on a machine that has
  neither — `api/tools.py` already preferred a bundled copy over PATH,
  which is the seam this fills. The wizard gained the Content Manager's
  components page: **Full** and **Minimal (app only)**, with the bundled
  runtimes shown read-only because they always ship, exactly as MinGit
  does over there. What a component toggles is an ACTION, not a payload —
  NSIS packs every section into the exe whether it runs or not, so a
  components page cannot shrink a download, only two separate installers
  could.
- **The installer looks for your courses.** The Full install's "Find my
  Content Manager courses" component scans the usual roots and records
  what it finds, so the first launch opens straight into the courses
  instead of asking. It writes to HKLM rather than the settings file,
  and that is forced: an elevated installer's `%APPDATA%` belongs to the
  elevating account, which on a managed laptop is an admin who will
  never run the editor. The app treats it as a hint — below the
  environment variable and below the author's own saved choice, and
  ignored when it points at a folder that has since moved.
- **Optionally installs Ollama**, the default provider and the only one
  that keeps a lab guide on the author's machine. Only if missing, and
  it pulls no model: that is a multi-gigabyte decision for Settings,
  where the sizes are visible.
- **A header pill for the Content Manager checkout**: which one, and
  whether it has moved on without you. The editor writes into a
  repository other people publish into, and nothing said so — you could
  spend an afternoon rewriting a guide that was replaced upstream this
  morning and find out at Publish, or not at all. It fetches once on
  load and then only when clicked, because `behind` cannot be known
  without asking the remote and asking costs a round trip on a VPN that
  may not be up. Every unusable state — no git, not a checkout, no
  upstream, unreachable remote — is a state the pill renders rather than
  an error that interrupts editing.


## [1.8.0] - 2026-09-16

### Added

- **The first-run screen offers the checkouts it can find**, instead of
  asking for an absolute path from memory. It scans the obvious roots one
  level deep — the sibling directory, `C:\Projects`, the usual clone
  folders under the home directory — for anything holding a `courses/`,
  and lists what it finds; one with the authoring scripts sorts above a
  content-only clone, which is labelled as editing-only rather than
  hidden. Scanning happens **only when the editor is lost**: the endpoint
  is polled at every boot, and one that knows where its courses are has
  no reason to go looking. It takes about a tenth of a second here.

### Fixed

- **The desktop shell's splash no longer hangs in front of a working
  app.** Its readiness probe sent bare LF line endings, which are not
  HTTP: uvicorn's httptools parser — pulled in by the
  `uvicorn[standard]` extra this app vendors — answered every probe with
  400 Bad Request and logged "Invalid HTTP request received", so
  `server_ready` never went true and the window sat on "Starting the
  bundled Python runtime" forever. The backend was up and healthy the
  whole time; curl got a 200 and the UI rendered fine in a browser, which
  is exactly why it survived verification. Inherited from the sibling
  app's shell, where the identical code works because that app vendors
  plain `uvicorn` and its pure-Python parser tolerates bare LF.
- **`index.html` is never cached.** Its asset references are
  content-hashed, so a cached copy outlives the files it points at — and
  after an upgrade a webview holding the old one asks for a bundle that
  install deleted, which is a blank window and a 404 in a console nobody
  opens. Met in the flesh while verifying the screen above: a stale index
  served a JS file that no longer existed, and the feature looked broken
  when it was not.


## [1.7.2] - 2026-09-16

### Changed

- **The icon generator tie to the Content Manager is cut.** The app icon
  and the wizard bitmaps are committed artifacts now, and nothing in this
  repo generates them — so building needs no icon tooling and no reach
  across. They are still drawn by that app's generator, which owns the
  brand, but on demand and by hand: `desktop/README.md` carries the exact
  recipe for the day the brand moves. Copying ~340 lines of drawing code
  here was the alternative, and a second drawing of a brand that has
  already been revised once diverges on the next revision.
- **Built installers land in `dist/` again, like every other app in the
  suite**, and the Vite bundle moved to `ui/`. They had been sharing
  `dist/`, which is why the installer briefly collected to `installers/`
  instead: Vite empties its own output directory on every build, so an
  installer collected there would be deleted by the next `npm run build`
  — and before that, it was packaged INTO the next installer. The sibling
  apps never hit this because their UI builds to `frontend/dist`, leaving
  the root free. Renaming the bundle is what makes `dist/` mean here what
  it means everywhere else.


## [1.7.1] - 2026-09-16

### Added

- **The installer wears the suite's wizard art.** It has always been an
  NSIS install like the other PDC-Demo apps, but with Tauri's stock grey
  wizard while they show the black Pentaho header and sidebar — so the
  first thing an author saw looked borrowed. The bitmaps are drawn by the
  Content Manager's own icon generator, called as a subprocess with the
  editor's pencil badge, its own title and its own sub-line. Two flags
  were added over there rather than a second drawing of the brand here
  (`--out-dir`, `--subtitle`): the brand has moved once already, and one
  composition is the whole reason the badge system works.


## [1.7.0] - 2026-09-16

### Added

- **Apply a review finding with the AI.** A located finding gets an
  "Apply with AI" button: it selects the markdown block the quote sits
  in and runs the ordinary Rewrite over that block, with the reviewer's
  own issue and fix as the instruction. Deliberately the long way round
  rather than a one-click patch from the review's own output - the
  reviewer is the least reliable thing in the editor, so applying goes
  through a second call, over a passage you can see selected, landing in
  the buffer under the same one-level undo as every other rewrite.
  Nothing is saved. The feedback loop closes itself: once applied, the
  quote stops matching and the finding reports as *fixed since the
  review ran*.
- It cannot reach beyond the block, and does not pretend to. A finding
  whose fix is "add a link at the end of the page" is not a rewording
  problem; those stay a job for the author, which is why the panel still
  leads with the quote and the jump.

### Fixed

- **The docs grounding is reference material, not raw material** —
  everywhere, now, rather than at the one endpoint where it was caught.
  It used to be appended to the END of every prompt, which is where a
  model looks for the thing it was asked to work on. That cost two bugs:
  a review reporting a *Critical* problem with the "Relevant Pentaho
  documentation" section of a lab that had no such section, and then —
  found by the very first use of Apply — a rewrite that wrote 4,000
  characters of documentation links and a Google Cloud SDK URL straight
  into a guide. The first was patched in place; the second proved that
  was the wrong fix. Prompt assembly is now one function
  (`core.grounded_prompt`): instructions, then the grounding labelled
  REFERENCE ONLY, then the content fenced and last. All four grounded
  call sites use it — rewrite, review, lab generation and import.


## [1.6.0] - 2026-09-16

### Added

- **The editor installs.** A Windows installer (`desktop/`, Tauri shell +
  vendored Python, the recipe the PDC-Demo suite already uses) starts the
  editor's own server on a free port and points a webview at it. The app
  inside is unchanged, so the packaged and development builds cannot
  drift. It removes the venv, the `pip install`, the two terminals and
  the IPv4/IPv6 port trap — the whole setup wall in front of an author on
  a corporate laptop, who can perfectly well install tooling but should
  not have to stand up a Python environment to write a lab guide.
- **A first-run screen.** The courses are not bundled and never will be:
  they belong to the Content Manager, and the editor edits that
  repository in place. So an installed editor asks where the checkout is,
  validates it, and remembers. It also says what the machine is missing
  — Node.js costs New Course, New Lab, Import and Verify; git costs
  Publish — once, up front, instead of four features failing later in
  four different ways. Neither is bundled, and without them the editor
  still opens, edits, saves, previews and runs its AI actions.
- **The preview's renderer version is on screen**, beside the editor's
  own. It only matters once installed: the Content Manager's renderer is
  compiled in at build time, so a packaged editor can be previewing with
  an older renderer than the checkout it is editing. That drift was
  previously invisible, and "the preview doesn't match the app" is the
  exact bug the shared renderer exists to prevent.

### Fixed

- **The production bundle ran for the first time, and crashed.** Two
  Reacts: the preview imports the Content Manager's source through
  `@app`, and a bare `import React from "react"` in those files resolves
  against THAT repository's node_modules, so the bundle carried the
  editor's 19.3.0 and the app's 19.2.5. Two copies means two hook
  dispatchers and the second is null - the packaged app opened to a blank
  window on `useState`. Invisible for as long as the editor only ever ran
  from the dev server, which resolves both to one copy. `npm run build`
  was treated as the check that the cross-repo wiring holds; nobody had
  ever RUN the artifact. Fixed with `resolve.dedupe`, and pinned by a
  test over the config itself.

### Changed

- **The editor's own files moved out of the code directory** when it is
  not writable (`api/paths.py`): settings and the publish cache resolve
  to `%APPDATA%` for an install, and stay exactly where they were —
  `api/settings.json` — in a checkout. An install directory that is never
  written to is one the uninstaller can remove completely.
- **A missing courses directory no longer kills the backend at import.**
  It used to raise, which from a checkout is a typo you fix in the shell
  you just used, and from an installed app is uvicorn dying before the
  window opens and the author being told the API is unreachable. It is
  now reported through `/api/health` and `/api/setup`, and the editor can
  be re-pointed while it runs.
- Verify and New Lab go through the tool resolver too. They built their
  own `subprocess.run(["node", ...])` and so would have ignored a bundled
  Node and failed with a FileNotFoundError instead of the message that
  says which features still work. Found by running Verify against the
  installed app rather than trusting that one call site was all of them.
- An unknown `/api/...` path answers 404 rather than the SPA. With the UI
  mounted, the catch-all was handing index.html back with a 200, so a
  mistyped endpoint surfaced as a JSON parse error somewhere else
  entirely.
- `node` and `git` are resolved through one module that prefers a bundled
  copy and falls back to PATH — the shape the Content Manager already
  uses for the MinGit it ships — so vendoring either later is a directory
  and no code change. The errors name what still works without them.
- Two more version carriers (`desktop/package.json`,
  `desktop/src-tauri/tauri.conf.json`), so the installer cannot ship a
  version the app denies. Six in total, all checked.
- Built installers are collected to `installers/`, not `dist/`. The rest
  of the suite collects to `dist/`, but here that is the Vite output and
  staging packages it as the UI - so the 1.5.0 installer shipped a 29 MB
  copy of itself inside `app/dist/`. Found by listing the artifact, which
  is why that step is in the build's own README.
- The uninstaller removes the resource trees wholesale
  (`desktop/src-tauri/nsis/hooks.nsh`). NSIS deletes the exact file list
  it installed, and the UI's filenames are content-hashed - so one
  upgrade leaves an orphan bundle behind, and an orphan keeps the install
  directory alive forever. Proven by the suite's marker experiment:
  install, plant files in the state folder, uninstall, and confirm the
  install directory is completely gone while the state is untouched.


## [1.5.0] - 2026-09-16

### Added

- **The AI review is marked in the source, anchored to the text it
  quotes.** It was the last panel left printing prose for the author to
  go and find — Verify had gone panel → line → exact span across 1.3.0
  and 1.4.0 without it. It could not follow the same route: the verifier
  reports a line because it measured the file, while a model asked for
  one guesses, and a confident squiggle under an innocent line is worse
  than none. So the model is asked for the TEXT instead, copied verbatim,
  and the editor finds it in the buffer. Each located finding underlines
  its quote (dots, where Verify's are dashes — a verdict and an opinion
  should not look alike), colours the gutter number, and carries its
  issue and fix in the tooltip; the panel lists them as rows, and
  clicking a quote jumps to it and selects it.
- **A finding whose quote is not in the guide is listed, never marked.**
  The anchor is also the check: a fabricated quote matches nothing, so it
  lands under "couldn't be found in the guide — check these by hand"
  rather than underlining whatever was nearby. It earned its place on the
  first live run, catching a *Critical* demand to delete a section that
  existed only in the review's own prompt.
- Findings are re-anchored to the live buffer on every keystroke, so one
  you have just fixed reports itself as **fixed since the review ran**
  instead of pointing at text that is gone. Verify, which reads disk,
  still needs its "lines may have moved" warning; this does not.

### Fixed

- **The docs grounding is no longer reviewed as part of the lab.** It was
  appended after the guide, so the two ran together into one document and
  the review reported problems with the Pentaho documentation block —
  quoting it, and asking the author to delete it. The grounding now comes
  before the guide, and the guide is fenced between explicit markers.
- **The 1.2.0 entry below, which the bump script had mangled.** Its notes
  said find & replace takes a plain substring "because guides are full of
  `**`, `[`, `(`, `` `$` `` and `` `|` ``" — and the ``$` `` in that list
  was expanded by `String.replace`, which reads it as "everything before
  the match". A second copy of this file's header was spliced into the
  middle of the sentence, and it has been in every release since. The
  cause is fixed in the Content Manager's shared machinery (`798f91f`),
  where the notes are now written by a replacement function that
  interprets nothing.

### Changed

- Verify's marks and the review's are merged in one tested pass
  (`lineAnnotations.ts`) rather than twice inside the editor component,
  where a line carrying both could be underlined by one pass and left
  untitled by the other.


## [1.4.0] - 2026-09-15

### Added

- **Verify underlines the exact text, not the whole line.** The squiggle
  now goes under the fence *tag* rather than the fence line, and under
  one `<dfn>…</dfn>` of several rather than the line carrying them all —
  a line with two unknown terms gets two underlines. Line granularity
  was the ceiling of what the verifier reported, not a choice; needs
  Pentaho Content Manager 0.4.49 or later, and against an older one it
  falls back to marking the line.


## [1.3.0] - 2026-09-15

### Added

- **Verify marks the line.** It used to print into a panel and leave you
  to find what it meant: now a flagged line gets a squiggle and a
  coloured gutter number, with the message on hover. Problems that belong
  to no line — a manifest metric, a SUMMARY link — are counted separately
  above the editor, so a guide never looks clean in the gutter while
  Verify is still reporting failures. Needs Pentaho Content Manager
  0.4.48 or later, whose verifier reports `path:line: message`; against
  an older one nothing breaks — every problem simply lands in the
  not-tied-to-a-line count.
- **The markdown source is colour-coded** with the same hues as the
  insert menus - a heading is blue in the toolbar and blue in the source,
  Media cyan in both, code green in both. Switchable from the Theme menu.
- **Line numbers, a current-line band, and fence matching.** The verifier
  and the AI review report problems by line, and there was no way to find
  line 74. Inside a fenced block both markers light up; an unclosed fence
  lights only its opener, which is the tell.
- **A command palette over every insert block**, on `Ctrl/Cmd+/` or
  `Ctrl/Cmd+Shift+P`. Type, arrow, Enter. The insert row is ten menus
  over thirty-six blocks, and below about 1100px it wrapped and pushed
  its last entry out of sight behind a scroller nobody finds. Commands
  come from the same registry and run through the same insert path as
  the menus, so the two cannot drift.


## [1.2.0] - 2026-09-15

### Added

- **Scroll sync between the editor and the preview.** Guides run to
  thousands of words; you scrolled one pane and then hunted for your
  place in the other. Proportional, both ways.
- **Find & replace, on Ctrl/Cmd+F.** There was none, so every text sweep
  meant opening the lab in a second editor - which is precisely how an
  afternoon's work went over the side on 2026-09-03. Plain substring
  rather than regex, because guides are full of `**`, `[`, `(`, `$` and
  `|`. The browser's own Ctrl+F is suppressed on purpose: it searches the
  rendered page, so it finds the preview and the sidebar and never the
  markdown you are editing.
- **A filter over the structure tree.** Courses run to eighteen entries
  and the only way to reach one was to read the list. Dragging is off
  while a filter is active: a drop lands relative to the labs you can
  see, and with rows hidden that is not where you think it is.
- **Six more editor palettes** beside the original two - Ocean, Ember on
  the Pentaho amber, Forest, Plum, Parchment for glare, and Contrast for
  small or dim VM screens. Old settings migrate rather than reset.
  Measured, not eyeballed: body text runs 13:1 to 21:1 in all eight and
  the muted tone never drops below 5.3:1. The PREVIEW stays light and
  dark only - it simulates what a learner can actually have, and that is
  its whole job.
- **A hue per insert family.** The insert row carries ten menus whose
  labels are the same size, weight and colour, so finding "Media" meant
  reading all ten. Each family now has a marker under its label, the same
  hue on its hover and on the top edge of its open popover. Decoration
  only - the label still says which is which.


## [1.1.0] - 2026-09-15

### Changed

- **Vite declared as `^8.3.0`, matching the Content Manager.** Both
  repos asked for `^8.0.10` and resolved on their own, which had put the
  editor on 8.3.0 and the app on 8.1.5. The preview imports 11 modules
  from the app through the `@app` alias, so the same source was being
  bundled by two different Vite versions - a weak footing for a preview
  whose whole job is to match what the learner sees. The resolved
  version here does not move; the declaration catches up to it.

### Fixed

- **The bump script's machinery now comes from the Content Manager.**
  `<PCM>/scripts/lib/version-carriers.mjs` holds the line-ending-safe
  I/O, the lockfile guard, the changelog promotion, the report and the
  CLI shell; what stays here is the carrier list, which is the part that
  genuinely differs. It replaces a second copy of the same sixty lines
  that had already diverged from the app's. A bump therefore needs the
  Content Manager present - the one operation here that otherwise touches
  only this repo - and says so plainly if it is missing.
- **`npm run version:check` and `npm run bump` work again.** Both called
  `scripts/bump-version.mjs`, which stayed behind in the Content Manager
  during the split, so each failed with `MODULE_NOT_FOUND` - the editor
  had a version and a changelog and no working way to move either. The
  script is ported, and it also checks `package-lock.json`, which the
  app's version does not: the app's lock read 0.4.41 while the project
  shipped 0.4.46 and nothing noticed, because nothing was looking.
- **The "can't reach the API" splash printed commands that no longer
  work.** It still said `cd editor/api` and a bare `uvicorn`, paths from
  before the editor became its own repo - so the one screen whose entire
  job is telling you how to recover sent you to a directory that does not
  exist. It now offers `start-editor.ps1` first, then the by-hand form,
  and how to create the venv if there isn't one.
- **Stale pre-split paths swept out of the docs and comments.** README,
  CLAUDE.md, four API docstrings and five frontend comments still
  described `src/author/`, `editor/api/`, `vite.author.config.ts` and
  `npm run author`. The README also listed drag-and-drop reordering,
  course/lab metadata forms, in-editor new course, image upload and a
  files manager as "not yet" - all four had shipped.


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
