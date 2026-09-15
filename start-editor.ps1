# Start the Pentaho Content Editor: the FastAPI backend and the Vite UI.
#
# The editor is its own project, but it edits the Pentaho Content
# Manager's courses, so the Content Manager must be installed first.
# Both halves find it the same way: the sibling directory by default,
# or $env:PCM_REPO when it lives elsewhere.
#
# ASCII only on purpose - em-dashes break PowerShell 5.1 parsing.

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$editorRoot = $PSScriptRoot
$apiPort = 8000
$uiPort  = 5273
$uiUrl   = "http://localhost:$uiPort/"

function Get-Listeners([int]$Port) {
    # Address-family agnostic on purpose: uvicorn binds IPv4 only and
    # Vite binds IPv6 only on this machine, and Windows resolves
    # localhost to ::1 first. A TcpClient probe against 127.0.0.1
    # reports the running UI as down, and a naive launcher then
    # restarts it forever.
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Stop-Editor {
    $stopped = 0
    foreach ($port in @($apiPort, $uiPort)) {
        foreach ($c in Get-Listeners $port) {
            $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
            if (-not $p) { continue }
            foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.ProcessId)" -ErrorAction SilentlyContinue)) {
                Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
                $stopped++
            }
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
    Write-Host "  Stopped $stopped editor process(es)."
}

if ($Stop) { Stop-Editor; return }

# Where the Content Manager lives, and therefore the courses.
$pcmRepo = if ($env:PCM_REPO) { $env:PCM_REPO } else { Join-Path (Split-Path $editorRoot -Parent) "Pentaho-Content-Manager" }
if (-not (Test-Path (Join-Path $pcmRepo "courses"))) {
    Write-Host ""
    Write-Host "  Cannot find the Pentaho Content Manager's courses at:"
    Write-Host "    $pcmRepo\courses"
    Write-Host ""
    Write-Host "  The editor edits that app's courses, so install the Pentaho"
    Write-Host "  Content Manager first, then set PCM_REPO to its root."
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  Pentaho Content Editor"
Write-Host "  ----------------------"
Write-Host "  courses: $pcmRepo\courses"

$python = Join-Path $editorRoot "api\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "  No API virtual environment. Create it with:"
    Write-Host "    py -3 -m venv api\.venv; api\.venv\Scripts\python -m pip install -r api\requirements.txt"
    exit 1
}

if ((Get-Listeners $apiPort).Count -gt 0) {
    Write-Host "  api   already running on $apiPort"
} else {
    Write-Host "  api   starting on $apiPort ..."
    Start-Process -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app:app", "--port", "$apiPort", "--app-dir", (Join-Path $editorRoot "api")) `
        -WorkingDirectory (Join-Path $editorRoot "api") -WindowStyle Minimized
}

if ((Get-Listeners $uiPort).Count -gt 0) {
    Write-Host "  ui    already running on $uiPort"
} else {
    Write-Host "  ui    starting on $uiPort ..."
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "npm", "run", "dev", "--", "--no-open") `
        -WorkingDirectory $editorRoot -WindowStyle Minimized
}

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    if ((Get-Listeners $apiPort).Count -gt 0 -and (Get-Listeners $uiPort).Count -gt 0) { break }
    Start-Sleep -Milliseconds 500
}

if ((Get-Listeners $uiPort).Count -eq 0) {
    Write-Warning "The editor UI did not come up on $uiPort within 90s. Check the minimized npm window."
    exit 1
}

Write-Host ""
Write-Host "  Editor ready:  $uiUrl"
Write-Host "  Stop with:     start-editor.ps1 -Stop"
Write-Host ""

if (-not $NoBrowser) { Start-Process $uiUrl }
