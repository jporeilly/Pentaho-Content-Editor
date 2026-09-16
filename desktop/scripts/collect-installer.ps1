# Copies the freshly built NSIS installer out of Tauri's deeply nested
# output directory to the repo root's installers\ folder - one short,
# memorable path for every build artifact. Run after tauri:build; wired
# into the "dist" npm script.
#
# NOT into dist\, which is where the rest of the suite collects. In this
# repository dist\ is the VITE build output, and stage-app.ps1 packages
# it as the app's UI - so an installer collected there was staged into
# the NEXT build's payload. The 1.5.0 build shipped a 29 MB copy of
# itself inside app\dist\, and only the uninstall experiment found it.
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nsis = Join-Path $here "..\src-tauri\target\release\bundle\nsis"
$dist = Join-Path $here "..\..\installers"

$exe = Get-ChildItem -Path $nsis -Filter "*-setup.exe" -ErrorAction Stop |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) {
    Write-Error "no *-setup.exe found in $nsis - run 'npm run tauri:build' first"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -Path $exe.FullName -Destination $dist -Force
$final = Join-Path (Resolve-Path $dist).Path $exe.Name
$hash = (Get-FileHash -Path $final -Algorithm SHA256).Hash
Write-Output "installer -> $final"
Write-Output "sha256    -> $hash"
