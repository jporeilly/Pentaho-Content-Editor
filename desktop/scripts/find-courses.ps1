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
    [string]$KeyPath = "HKLM:\SOFTWARE\Pentaho\ContentEditor",
    # Report what would be recorded and stop before the registry write,
    # which needs elevation. For tests, and for a developer checking the
    # search without installing.
    [switch]$ReportOnly,
    # Search these roots instead of the list below. For tests: the default
    # list includes C:\Projects, so a test run against it passes or fails on
    # whatever checkouts this machine happens to hold.
    [string[]]$Roots
)

$ErrorActionPreference = "Stop"

# The same roots, in the same order, as api/core.py's own scan. One
# level deep: a recursive hunt across a home directory is how an
# installer ends up waiting on OneDrive or a mapped drive.
if (-not $Roots) {
    $Roots = @(
        "C:\Projects",
        (Join-Path $env:USERPROFILE "Projects"),
        (Join-Path $env:USERPROFILE "source\repos"),
        (Join-Path $env:USERPROFILE "git"),
        (Join-Path $env:USERPROFILE "Documents"),
        $env:USERPROFILE
    )
}
$Roots = @($Roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

function Test-Checkout($path) {
    if (-not (Test-Path -LiteralPath (Join-Path $path "courses"))) { return $null }
    $scripts = Test-Path -LiteralPath (Join-Path $path "scripts\new-course.mjs")
    # A git worktree has a .git FILE ("gitdir: ...") where a main checkout
    # has a .git directory. A worktree is a branch in flight - on the dev
    # machine, a release branch that predated four exam rewrites - so it
    # ranks below any main checkout. A copy with no .git at all is not a
    # worktree: courses/ is still the whole requirement.
    $worktree = Test-Path -LiteralPath (Join-Path $path ".git") -PathType Leaf
    return [pscustomobject]@{ Path = $path; Scaffolding = $scripts; Worktree = $worktree }
}

$found = @()
foreach ($root in $Roots) {
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

# A main checkout beats a git worktree, whatever else; then one that can
# also scaffold and verify beats one that can only be edited; among
# equals, the first found wins. That last key used to be Path, so the tie
# went ALPHABETICALLY - C:\Projects\pcm-060 sorts before
# C:\Projects\Pentaho-Content-Manager - and the installed editor opened a
# stale worktree, where a Publish would have pushed its older exams. The
# order is spelled out because Sort-Object in Windows PowerShell 5.1 is
# not stable either. (The Exam Bank's copy of this search had the same
# fault, fixed there in 7e8bb90.)
for ($i = 0; $i -lt $found.Count; $i++) {
    $found[$i] | Add-Member -NotePropertyName Order -NotePropertyValue $i
}
$best = $found | Sort-Object -Property @(
    @{ Expression = { $_.Worktree } },
    @{ Expression = { -not $_.Scaffolding } },
    @{ Expression = { $_.Order } }
) | Select-Object -First 1

if (-not $best) {
    Write-Host "No Content Manager checkout found - the editor will ask on first run."
    exit 1
}

# Say what was passed over, so an install log explains a choice that looks
# wrong next to a worktree.
if (-not $best.Worktree) {
    foreach ($skipped in @($found | Where-Object { $_.Worktree } | Select-Object -ExpandProperty Path -Unique)) {
        Write-Host "Passed over git worktree $skipped."
    }
}

if ($ReportOnly) {
    Write-Host "Would record $($best.Path) under $KeyPath"
    exit 0
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
