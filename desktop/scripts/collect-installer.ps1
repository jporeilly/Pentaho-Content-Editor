# Copies the freshly built NSIS installer out of Tauri's deeply nested
# output directory to the repo root's dist\ folder - the same short,
# memorable path every app in this suite collects to. Run after
# tauri:build; wired into the "dist" npm script.
#
# It briefly lived in installers\ instead, because dist\ used to be the
# VITE output here and stage-app.ps1 packaged it as the UI: the 1.5.0
# build shipped a 29 MB copy of itself inside app\dist\, found only by
# listing the artifact. The UI now builds to ui\ (vite.config.ts), which
# frees this folder for what it means everywhere else.
[CmdletBinding()]
param(
    # "seeded" -> <name>-seeded-setup.exe, so the seeded and plain installers
    # of one version sit side by side in dist\ instead of overwriting each other.
    [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$nsis = Join-Path $here "..\src-tauri\target\release\bundle\nsis"
$dist = Join-Path $here "..\..\dist"

$exe = Get-ChildItem -Path $nsis -Filter "*-setup.exe" -ErrorAction Stop |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) {
    Write-Error "no *-setup.exe found in $nsis - run 'npm run tauri:build' first"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
$name = $exe.Name
if ($Suffix) { $name = $name -replace '-setup\.exe$', "-$Suffix-setup.exe" }
Copy-Item -Path $exe.FullName -Destination (Join-Path (Resolve-Path $dist).Path $name) -Force
$final = Join-Path (Resolve-Path $dist).Path $name
$hash = (Get-FileHash -Path $final -Algorithm SHA256).Hash
Write-Output "installer -> $final"
Write-Output "sha256    -> $hash"
