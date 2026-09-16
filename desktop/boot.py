"""Entry point for the desktop shell's backend.

Why this exists rather than `python -m uvicorn app:app --app-dir api`,
which is what start-editor.ps1 runs from a checkout:

The vendored runtime is Python's Windows "embeddable package", whose
`._pth` file REPLACES sys.path outright. The current directory is not on
it, and PYTHONPATH is ignored while a `._pth` is present - so `app`,
`core` and the rest of the api/ package are simply not importable, no
matter what working directory the process is given. The failure is a bare
ModuleNotFoundError with nothing pointing at the cause.

Putting the api directory on sys.path explicitly fixes that, and gives
the packaged and development launches ONE code path instead of two that
can drift.

    python boot.py --port 5599 [--app-dir <dir>]

--app-dir defaults to the directory beside this file, which is the shape
stage-app.ps1 produces:

    app/boot.py
    app/api/app.py
    app/dist/index.html

The api directory - not the root - goes on sys.path, because the modules
import each other flatly (`import core`, `from routers import labs`),
exactly as uvicorn's `--app-dir api` arranges from a checkout.
"""
import argparse
import os
import sys


def _plain(path):
    r"""Drop Windows' verbatim \\?\ prefix from a drive path.

    os.chdir() cannot use one: SetCurrentDirectory rejects the verbatim
    form, so an install under C:\Program Files failed here with every
    path check passing. The shell strips it too - this is the second line
    of defence, because the cost of getting it wrong is a server that
    dies before it can say why.

    Genuine UNC paths (\\?\UNC\...) and paths over the legacy limit still
    need the prefix, so only ordinary drive paths are unwrapped.
    """
    p = str(path)
    if p.startswith("\\\\?\\"):
        rest = p[4:]
        if len(rest) > 2 and rest[1] == ":" and rest[0].isalpha() and len(rest) < 250:
            return rest
    return p


def main():
    ap = argparse.ArgumentParser(description="Start the Pentaho Content Editor backend.")
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--app-dir", default=None)
    args = ap.parse_args()

    here = _plain(os.path.dirname(os.path.abspath(__file__)))
    app_root = _plain(os.path.abspath(args.app_dir or here))
    api_dir = os.path.join(app_root, "api")

    app_py = os.path.join(api_dir, "app.py")
    if not os.path.isfile(app_py):
        # Explicit beats a ModuleNotFoundError three frames deep: this is
        # the message that tells whoever is reading the log that the
        # INSTALL is wrong, not the app.
        sys.exit("boot: api/app.py not found at {} - the install is incomplete".format(app_py))

    sys.path.insert(0, api_dir)
    # The working directory is the app ROOT, not api/: app.py resolves the
    # built UI as <root>/dist, one level up from itself.
    os.chdir(app_root)

    # Belt and braces with the shell's PYTHONDONTWRITEBYTECODE: never
    # compile bytecode into a read-only install tree - a .pyc the
    # installer never shipped is a file the uninstaller leaves behind.
    sys.dont_write_bytecode = True

    import uvicorn
    uvicorn.run("app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
