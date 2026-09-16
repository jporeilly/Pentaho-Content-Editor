# The Windows installer

A Tauri shell that starts the editor's own FastAPI server on a free port
and points a webview at it. The app inside is unchanged — the same React
UI the dev server serves, so the packaged and development builds cannot
drift apart.

What packaging removes: the venv, `pip install`, `npm install`, two
terminals, and knowing that Vite binds IPv6 while uvicorn binds IPv4.
The audience is authors on corporate laptops. They can install tooling —
which is why Node and git are required rather than vendored — but a
Python environment is not something anyone should have to stand up in
order to write a lab guide, and a version of it that drifts from the one
this was tested against is worse than none.

What it does **not** remove: the content. The editor edits a Pentaho
Content Manager checkout's `courses/` and scaffolds by shelling out to
that repository's scripts, so an installed editor still needs a checkout
to point at — which it asks for on first run.

## Build it

```
cd desktop
npm install          # once
npm run dist
```

`dist` runs four steps, and each is worth knowing on its own:

| Step | What it does |
| --- | --- |
| `build:ui` | `npm run build` in the repo root. Bundles the UI **and the Content Manager's renderer** through the `@app` alias, with `VITE_EDITOR_API=` from `.env.production` so every call is same-origin. |
| `stage:app` | Copies `api/` and `dist/` into `src-tauri/vendor/app`, excluding the dev venv, `settings.json` and the publish cache, then proves the staged tree imports on the vendored runtime. |
| `tauri:build` | Compiles the shell and bundles the NSIS installer. `beforeBuildCommand` re-runs `fetch:python` (idempotent) and `stage:app`. |
| `collect` | Copies the installer to the repo root's `installers/` and prints its SHA-256. **Not** `dist/` — that is the Vite output, which staging packages as the UI, so an installer collected there ends up inside the next build's payload. It did, once: a 29 MB copy of itself. |

`npm run fetch:python` is the one that takes minutes: it downloads
Python's embeddable package, patches its `._pth` so site-packages works
at all, bootstraps pip, installs `api/requirements.txt` and proves the
result can import what `boot.py` needs. It is stamped with the Python
version **and** the requirements hash, so adding a dependency rebuilds
it and forgetting to is not a silent old-dependency-set install.

**The build machine needs the Content Manager checkout.** The preview's
renderer is compiled in, so `PCM_REPO` (or the sibling directory) gates
releases as well as development.

## Verify what you built

List the artifact before installing it. The Policy installer shipped
17 MB of a second Python for four releases, and only listing it found
that:

```
7z l "..\installers\Pentaho Content Editor_1.5.0_x64-setup.exe" | findstr /i "venv settings.json __pycache__ setup.exe"
```

Nothing should match.

## The traps, all of them paid for once

- **`\\?\` paths.** `resource_dir()` canonicalises to the verbatim form,
  which is legal for file APIs and illegal as a working directory, so
  `os.chdir` throws while every path check passes. `strip_verbatim` in
  `main.rs`, and `_plain()` in `boot.py` as a second line of defence.
- **Readiness is asked of Rust.** The splash is on a `tauri://` origin,
  so `fetch()` to `127.0.0.1` is cross-origin: the server answers 200 and
  the webview refuses to hand it back. `invoke('server_ready')` instead.
- **The embeddable runtime's `._pth` replaces `sys.path`** and drops the
  working directory, so `python -m uvicorn app:app --app-dir api` cannot
  work however it is launched. `boot.py` sets the path explicitly.
- **A job object kills the server with us**, including on a crash or a
  Task Manager kill. A leaked uvicorn holds its port and the next launch
  fails invisibly.
- **Relative `/XD` names in staging.** An absolute path matches only the
  top level, so subpackage `__pycache__` ships.
- **Icons are not a cargo build input.** After `make-icons.py`, run
  `cargo clean --release -p pentaho-content-editor-desktop` or the cached
  exe keeps the old icon embedded.
- **Hashed asset names outlive an upgrade.** NSIS uninstalls the exact
  file list it installed, so `index-<oldhash>.js` from a previous version
  survives and its directory cannot be removed. `src-tauri/nsis/hooks.nsh`
  clears `app\` and `python\` wholesale on PREINSTALL and POSTUNINSTALL.
- **An NSIS uninstaller re-execs itself elevated as `%TEMP%\Au_.exe`.**
  `uninstall.exe` returns within a second while the real work has barely
  begun, so anything checking for leftovers straight afterwards reports
  files that are being deleted as it reads them. Wait on `Au_.exe`.
- **Signing is wired and off.** `sign.ps1` exits 0 with a note unless
  `EDITOR_SIGN_THUMBPRINT` (or the suite-wide `PDCG_SIGN_THUMBPRINT`) is
  set. Unsigned installs work; Windows shows SmartScreen.

## Layout

```
desktop/
  boot.py                     puts api/ on sys.path, then runs uvicorn
  dist/index.html             the startup screen (SOURCE, not build output)
  scripts/                    fetch-python, stage-app, make-icons, sign, collect
  src-tauri/
    src/main.rs               paths, commands, the window
    src/server.rs             free port, job object, log draining, readiness
    vendor/python  vendor/app build output, gitignored
```
