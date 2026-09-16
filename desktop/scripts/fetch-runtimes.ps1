<#
.SYNOPSIS
    Vendor Node.js and MinGit into the installer's "Full" option.

.DESCRIPTION
    The editor shells out to Node for the Content Manager's authoring
    scripts (New Course, New Lab, Import, Verify) and to git for Publish.
    Requiring both from the machine is a fine default for a developer and
    a wall for an author on a managed laptop, so the Full install carries
    them and the Minimal one does not.

    Nothing about the app changes either way: api/tools.py prefers a
    bundled copy and falls back to PATH, so a Minimal install on a
    machine with its own Node behaves exactly as before, and a Full
    install ignores whatever else is installed.

    The layout is what tools.py looks for:

        tools\node\node.exe        (shape "<tool>/<tool>.exe")
        tools\git\cmd\git.exe      (shape "<tool>/cmd/<tool>.exe")

    Both are stamped with their version, so a re-run is a no-op and a
    version bump is a rebuild.

.PARAMETER NodeVersion
    Node to vendor; empty means "whatever the Content Manager pins".
    Only node.exe is kept - npm, npx and the docs are tens of megabytes
    of things the editor never calls.

    The version is NOT a free choice. That repository's
    verify-course.mjs imports a TypeScript module directly, which needs
    Node 24's native type stripping: vendoring 22.14 produced an
    installed editor whose Verify died with ERR_UNKNOWN_FILE_EXTENSION
    while the very same command worked from a checkout, on the machine's
    own newer Node.

.PARAMETER GitVersion
    MinGit, the portable Git for Windows distribution the Content
    Manager already ships with its own installers.

.NOTES
    Windows PowerShell 5.1+. ASCII-only on purpose.
#>
[CmdletBinding()]
param(
    [string]$NodeVersion = "",
    [string]$GitVersion = "2.55.0.windows.1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$desktopDir = Split-Path -Parent $PSScriptRoot
$repoRoot   = Split-Path -Parent $desktopDir
$vendorDir  = Join-Path $desktopDir "src-tauri\vendor\tools"

# The scripts we shell out to decide the Node version, not us. Read the
# Content Manager's own pin where it is there - the build already needs
# that checkout for the renderer - and fall back to the version known to
# work when it is not.
if (-not $NodeVersion) {
    $NodeVersion = "24.16.0"
    $pcm = if ($env:PCM_REPO) { $env:PCM_REPO } else { Join-Path (Split-Path -Parent $repoRoot) "Pentaho-Content-Manager" }
    $nvmrc = Join-Path $pcm ".nvmrc"
    if (Test-Path -LiteralPath $nvmrc) {
        $pinned = (Get-Content -LiteralPath $nvmrc -Raw).Trim().TrimStart("v")
        if ($pinned -match "^\d+\.\d+\.\d+$") {
            $NodeVersion = $pinned
            Write-Host "  (Node $NodeVersion, from the Content Manager's .nvmrc)"
        }
    }
}

function Say($m)  { Write-Host "  $m" }
function Ok($m)   { Write-Host "  [ok] $m" -ForegroundColor Green }

Write-Host ""
Write-Host "  Vendoring Node $NodeVersion and MinGit $GitVersion" -ForegroundColor Cyan

New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- Node -----------------------------------------------------------
$nodeDir   = Join-Path $vendorDir "node"
$nodeStamp = Join-Path $nodeDir ".version"

if ((-not $Force) -and (Test-Path $nodeStamp) -and
    ((Get-Content -LiteralPath $nodeStamp -Raw).Trim() -eq $NodeVersion)) {
    Ok "node $NodeVersion already vendored"
} else {
    if (Test-Path $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null

    $nodeZip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
    $nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
    Say "downloading $nodeUrl"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip -UseBasicParsing

    $staging = Join-Path $env:TEMP "node-unzip-$PID"
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $staging -Force
    Remove-Item -LiteralPath $nodeZip -Force

    # node.exe alone. The zip is ~28 MB extracted and all but one file of
    # it is npm, npx, corepack and documentation - none of which the
    # editor ever calls. It runs four .mjs scripts.
    $exe = Get-ChildItem -LiteralPath $staging -Filter "node.exe" -Recurse | Select-Object -First 1
    if (-not $exe) { throw "node.exe not found in the downloaded archive" }
    Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $nodeDir "node.exe") -Force
    Remove-Item -LiteralPath $staging -Recurse -Force

    Set-Content -LiteralPath $nodeStamp -Value $NodeVersion -Encoding ASCII
    Ok "node.exe vendored ($([math]::Round((Get-Item (Join-Path $nodeDir 'node.exe')).Length / 1MB, 1)) MB)"
}

& (Join-Path $nodeDir "node.exe") --version | ForEach-Object { Say "node reports $_" }

# ---- MinGit ---------------------------------------------------------
$gitDir   = Join-Path $vendorDir "git"
$gitStamp = Join-Path $gitDir ".version"

if ((-not $Force) -and (Test-Path $gitStamp) -and
    ((Get-Content -LiteralPath $gitStamp -Raw).Trim() -eq $GitVersion)) {
    Ok "MinGit $GitVersion already vendored"
} else {
    if (Test-Path $gitDir) { Remove-Item -LiteralPath $gitDir -Recurse -Force }
    New-Item -ItemType Directory -Path $gitDir -Force | Out-Null

    # The release tag carries the full version; the asset drops the
    # ".windows.N" suffix. Same shape the Content Manager fetches.
    $short = $GitVersion -replace '\.windows\.\d+$', ''
    $gitZip = Join-Path $env:TEMP "mingit-$short.zip"
    $gitUrl = "https://github.com/git-for-windows/git/releases/download/v$GitVersion/MinGit-$short-64-bit.zip"
    Say "downloading $gitUrl"
    Invoke-WebRequest -Uri $gitUrl -OutFile $gitZip -UseBasicParsing
    Expand-Archive -LiteralPath $gitZip -DestinationPath $gitDir -Force
    Remove-Item -LiteralPath $gitZip -Force

    Set-Content -LiteralPath $gitStamp -Value $GitVersion -Encoding ASCII
    Ok "MinGit vendored"
}

$gitExe = Join-Path $gitDir "cmd\git.exe"
if (-not (Test-Path -LiteralPath $gitExe)) { throw "extraction incomplete: $gitExe not found" }
& $gitExe --version | ForEach-Object { Say "git reports $_" }

$size = [math]::Round(((Get-ChildItem -LiteralPath $vendorDir -Recurse -File |
        Measure-Object -Property Length -Sum).Sum / 1MB), 0)
Ok "runtimes ready - $size MB total"
Write-Host ""
exit 0
