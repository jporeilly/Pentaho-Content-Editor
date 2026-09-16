<#
.SYNOPSIS
    Stage the Python backend + built React UI for bundling.

.DESCRIPTION
    Copies api\ and dist\ into src-tauri\vendor\app, which
    tauri.conf.json's bundle.resources maps to "app" inside the install.

    The staged tree MIRRORS the repo layout:

        app\boot.py         (desktop launcher - see desktop\boot.py)
        app\api\app.py
        app\dist\index.html

    That is not cosmetic. app.py resolves the built UI as
    EDITOR_ROOT/dist - one level up from api\ - so flattening the two
    into a single directory would leave the server running with no UI to
    serve, which looks exactly like a crash and is not one.

    What must NOT ship, and why each one is listed:

      settings.json     machine-specific, names the author's provider and
                        may name a private endpoint. Gitignored, never
                        committed, and it must not reach an installer
                        either - a second author would inherit the first
                        one's configuration.
      .publish-cache    a clone of the distribution repo. Large, and it
                        carries git credentials' fetch history.
      .venv / venv      the dev environment. The staged tree runs on the
                        VENDORED runtime; a bundled dev venv is tens of
                        megabytes of the wrong Python. The PDC Policy
                        installer shipped exactly that for four releases
                        because nobody listed the artifact.
      __pycache__       bytecode the installer never shipped is a file
                        the uninstaller leaves behind.
      test_*.py         the test suite imports pytest, which is not in
      requirements-dev  the vendored runtime - it could never run there,
                        so it is 600 lines of dead weight in an install.

.NOTES
    Windows PowerShell 5.1+. ASCII-only on purpose.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
# Without this an undefined variable expands to empty and robocopy just
# returns exit 16 - which is how a staging destination silently became "".
Set-StrictMode -Version Latest

$desktopDir = Split-Path -Parent $PSScriptRoot
$repoRoot   = Split-Path -Parent $desktopDir
$srcApi     = Join-Path $repoRoot "api"
$srcUi      = Join-Path $repoRoot "dist"
$stageDir   = Join-Path $desktopDir "src-tauri\vendor\app"
$stageApi   = Join-Path $stageDir "api"
$stageUi    = Join-Path $stageDir "dist"

function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Staging the app" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath (Join-Path $srcApi "app.py"))) {
    throw "api\app.py not found - is $repoRoot the repo root?"
}
if (-not (Test-Path -LiteralPath (Join-Path $srcUi "index.html"))) {
    throw "dist\index.html not found - run 'npm run build' in the repo root first"
}

if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

# robocopy: mirror of a clean tree. Exit codes 0-7 are success (8+ is a
# real failure) - a quirk worth pinning, because treating any non-zero as
# failure makes every build look broken.
#
# /XD and /XF names are RELATIVE on purpose: an absolute path matches
# only the top-level directory, so any subpackage __pycache__ from the
# dev checkout would ship into Program Files, where the uninstaller
# leaves it behind (found on PDC-Insights 1.17.0).
& robocopy $srcApi $stageApi "/E" "/NFL" "/NDL" "/NJH" "/NJS" "/NP" `
    "/XD" "__pycache__" ".pytest_cache" ".venv" "venv" ".publish-cache" `
    "/XF" "settings.json" ".write-probe" "test_*.py" "requirements-dev.txt" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed staging the api package (exit $LASTEXITCODE)" }

# /XF *.exe: the UI is HTML, CSS and JavaScript. Anything executable in
# dist\ arrived by accident - as a collected installer did once, putting
# a 29 MB copy of the installer inside the installer.
& robocopy $srcUi $stageUi "/E" "/NFL" "/NDL" "/NJH" "/NJS" "/NP" "/XF" "*.exe" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed staging the UI (exit $LASTEXITCODE)" }

# boot.py puts api\ on sys.path before importing it. The embeddable
# runtime's ._pth replaces sys.path outright, so without this the server
# cannot import app whatever working directory it is given.
Copy-Item -LiteralPath (Join-Path $desktopDir "boot.py") -Destination (Join-Path $stageDir "boot.py") -Force

# Belt and braces: prove nothing private or environmental slipped
# through. Each of these has shipped in a suite installer at least once.
foreach ($never in @((Join-Path $stageApi ".venv"),
                     (Join-Path $stageApi "venv"),
                     (Join-Path $stageApi "settings.json"),
                     (Join-Path $stageApi ".publish-cache"))) {
    if (Test-Path -LiteralPath $never) { throw "$never reached the staging tree - fix the exclude list" }
}

# The paths the shell and the server actually depend on. Assert them
# here, where the fix is obvious, rather than at first launch on someone
# else's laptop.
foreach ($must in @((Join-Path $stageApi "app.py"),
                    (Join-Path $stageApi "core.py"),
                    (Join-Path $stageApi "paths.py"),
                    (Join-Path $stageApi "tools.py"),
                    (Join-Path $stageApi "routers\setup.py"),
                    (Join-Path $stageUi  "index.html"),
                    (Join-Path $stageDir "boot.py"))) {
    if (-not (Test-Path -LiteralPath $must)) { throw "staging incomplete: $must is missing" }
}

# Prove the staged tree can actually be imported, using the runtime that
# will ship with it. File-existence checks cannot catch a module excluded
# by mistake; this can, and it costs a couple of seconds.
#
# EDITOR_STATE_DIR points the import at a scratch directory: importing
# app.py loads providers, which resolves the state directory at import,
# and the check must not create or touch the author's real settings.
$vendorPy = Join-Path $desktopDir "src-tauri\vendor\python\python.exe"
if (Test-Path -LiteralPath $vendorPy) {
    $probe = "import sys, os; sys.path.insert(0, os.path.join(sys.argv[1], 'api')); import app; print('import ok')"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $prevState = $env:EDITOR_STATE_DIR
    $env:EDITOR_STATE_DIR = Join-Path $env:TEMP "pce-stage-check"
    # -B: do NOT write bytecode. Without it this check compiles
    # __pycache__ into the tree robocopy just finished excluding it from,
    # and those .pyc files then ship.
    $out = & $vendorPy -B -c $probe $stageDir 2>&1
    $code = $LASTEXITCODE
    $env:EDITOR_STATE_DIR = $prevState
    $ErrorActionPreference = $prevEap
    if ($code -ne 0) {
        $out | ForEach-Object { Warn $_ }
        throw "the staged tree cannot import app - a module is missing from the stage"
    }
    Get-ChildItem -LiteralPath $stageDir -Recurse -Directory -Filter "__pycache__" |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
    Ok "staged tree imports cleanly on the vendored runtime"
} else {
    Warn "no vendored runtime yet - skipping the import check (run fetch:python first)"
}

$count = (Get-ChildItem -LiteralPath $stageDir -Recurse -File).Count
$size = [math]::Round(((Get-ChildItem -LiteralPath $stageDir -Recurse -File |
        Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Ok "staged $count file(s), $size MB to src-tauri\vendor\app"
Write-Host ""

# robocopy returns 1 for "files were copied" and PowerShell surfaces the
# LAST native exit code as the script's, so a successful run would look
# like a failure to npm and abort the tauri build.
exit 0
