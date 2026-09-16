<#
.SYNOPSIS
    Record a Pentaho Content Manager checkout found on this machine.

.DESCRIPTION
    Run by the installer's "Find my Content Manager courses" component.
    The editor edits a CHECKOUT - courses/ and the authoring scripts -
    and on a fresh machine it cannot guess where that is. Finding one at
    install time means the first launch opens straight into the courses
    instead of asking.

    Written to HKLM, and that is not laziness about per-user settings.
    The installer runs ELEVATED: $env:APPDATA here is the elevating
    account's profile, which on a managed laptop is an admin account
    that will never run the editor. A machine-wide hint that the app
    reads as a candidate is the honest way round it - the app still
    decides, and the author can still change it.

    Finds nothing? Exit 1, quietly. The first-run screen does the same
    search itself and offers what it finds, so this is an optimisation,
    never a requirement.

.NOTES
    Windows PowerShell 5.1+. ASCII-only on purpose.
#>
[CmdletBinding()]
param(
    [string]$KeyPath = "HKLM:\SOFTWARE\Pentaho\ContentEditor"
)

$ErrorActionPreference = "Stop"

# The same roots, in the same order, as api/core.py's own scan. One
# level deep: a recursive hunt across a home directory is how an
# installer ends up waiting on OneDrive or a mapped drive.
$roots = @(
    "C:\Projects",
    (Join-Path $env:USERPROFILE "Projects"),
    (Join-Path $env:USERPROFILE "source\repos"),
    (Join-Path $env:USERPROFILE "git"),
    (Join-Path $env:USERPROFILE "Documents"),
    $env:USERPROFILE
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

function Test-Checkout($path) {
    if (-not (Test-Path -LiteralPath (Join-Path $path "courses"))) { return $null }
    $scripts = Test-Path -LiteralPath (Join-Path $path "scripts\new-course.mjs")
    return [pscustomobject]@{ Path = $path; Scaffolding = $scripts }
}

$found = @()
foreach ($root in $roots) {
    # The obvious name first, then anything else one level down that
    # happens to hold courses - a clone renamed on checkout is common.
    $named = Join-Path $root "Pentaho-Content-Manager"
    if (Test-Path -LiteralPath $named) {
        $hit = Test-Checkout $named
        if ($hit) { $found += $hit }
    }
    try {
        foreach ($child in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop | Select-Object -First 120)) {
            if ($child.Name.StartsWith(".")) { continue }
            $hit = Test-Checkout $child.FullName
            if ($hit) { $found += $hit }
        }
    } catch {
        continue   # unreadable root: skip it, never fail the install
    }
}

# One that can also scaffold and verify beats one that can only be
# edited; among equals, the first root wins.
$best = $found | Sort-Object -Property @{ Expression = { -not $_.Scaffolding } }, Path |
    Select-Object -First 1 -Unique

if (-not $best) {
    Write-Host "No Content Manager checkout found - the editor will ask on first run."
    exit 1
}

# Written to the 64-BIT registry view, explicitly.
#
# NSIS installers are 32-bit, so the PowerShell they launch is the
# SysWOW64 one, and every HKLM\SOFTWARE write it makes is silently
# redirected into HKLM\SOFTWARE\WOW6432Node. The install then "succeeds"
# and the 64-bit app reads an empty key forever. Found exactly that way:
# the component ran, the scan worked, and the editor still asked on
# first run.
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
    [Microsoft.Win32.RegistryHive]::LocalMachine,
    [Microsoft.Win32.RegistryView]::Registry64)
try {
    $key = $base.CreateSubKey("SOFTWARE\Pentaho\ContentEditor")
    try {
        $key.SetValue("PcmRepo", $best.Path, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
        $key.Close()
    }
} finally {
    $base.Close()
}
Write-Host "Recorded Content Manager checkout: $($best.Path)"
if (-not $best.Scaffolding) {
    Write-Host "  (no scripts\ - editing only; New Course, New Lab, Import and Verify need a full checkout)"
}
exit 0
