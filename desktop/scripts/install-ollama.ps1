<#
.SYNOPSIS
    Install Ollama, but only if this machine does not already have it.

.DESCRIPTION
    Run by the installer's optional Ollama component. Ollama is the
    editor's DEFAULT AI provider and the only one that keeps a lab guide
    on the author's own machine: Review, Rewrite, Apply and the
    assistant all need a provider, and the alternatives send the text to
    a hosted service.

    Deliberately narrow:

      * It INSTALLS the runtime and stops. No model is pulled, because
        that is a multi-gigabyte decision and Settings shows the sizes
        and what the machine can run. An installer that quietly downloads
        five gigabytes is a bad guest.
      * If Ollama is already here - on PATH, in its usual per-user
        location, or answering on its port - it does nothing at all.
      * Every failure is non-fatal. No network, a blocked download, a
        declined elevation: the editor still installs, Settings still
        explains, and another provider can be chosen.

.NOTES
    Windows PowerShell 5.1+. ASCII-only on purpose.
#>
[CmdletBinding()]
param(
    [string]$Url = "https://ollama.com/download/OllamaSetup.exe"
)

# Never fail the install: a missing optional runtime is a message, not
# an error. Every exit below is 0 except a genuinely failed setup run,
# and even that only prints.
$ErrorActionPreference = "Continue"

function Say($m) { Write-Host "  $m" }

# 1. Already on PATH?
$onPath = Get-Command ollama -ErrorAction SilentlyContinue
if ($onPath) {
    Say "Ollama is already installed ($($onPath.Source)) - nothing to do."
    exit 0
}

# 2. The per-user location its own installer uses. A machine-wide check
#    that only looks at PATH misses it when the installing admin is not
#    the account that has it.
$localApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (Test-Path -LiteralPath $localApp) {
    Say "Ollama is already installed ($localApp) - nothing to do."
    exit 0
}

# 3. Running right now? Then it is installed somewhere we did not look.
try {
    $probe = New-Object Net.Sockets.TcpClient
    $probe.Connect("127.0.0.1", 11434)
    $probe.Close()
    Say "Ollama is already running on port 11434 - nothing to do."
    exit 0
} catch {
    # not running; carry on and install
}

$setup = Join-Path $env:TEMP "OllamaSetup.exe"
Say "downloading Ollama from $Url"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $setup -UseBasicParsing
} catch {
    Say "Could not download Ollama: $($_.Exception.Message)"
    Say "The editor is installed; pick a provider in Settings, or install Ollama later."
    exit 0
}

Say "running the Ollama installer silently"
try {
    $proc = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT", "/NORESTART" -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Say "Ollama setup exited with $($proc.ExitCode) - install it by hand if you want the local provider."
    } else {
        Say "Ollama installed. Pull a model from the editor's Settings when you are ready."
    }
} catch {
    Say "Could not run the Ollama installer: $($_.Exception.Message)"
} finally {
    Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
}

exit 0
