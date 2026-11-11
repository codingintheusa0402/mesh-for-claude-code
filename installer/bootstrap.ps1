# Windows prerequisites. Installs only what the app needs, from official sources, and says what it does:
#   1. Microsoft Visual C++ Redistributable (x64)   — runtime for the built-in terminal (node-pty / ConPTY)
#   2. Git for Windows                              — Claude Code on Windows runs its shell through Git Bash
#   3. Claude Code                                  — the official native installer (claude.ai/install.ps1)
# Anything already installed is skipped. Run by the app's installer, or by the app on first launch.
# $env:APP_NAME: the app's name for the messages (defaults to Mesh for Claude Code).
param([switch]$CheckOnly)
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$AppName = if ($env:APP_NAME) { $env:APP_NAME } else { 'Mesh for Claude Code' }
try { $Host.UI.RawUI.WindowTitle = "$AppName - installing prerequisites" } catch { }
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

function Has-VCRedist {
  foreach ($k in 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64') {
    $v = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue
    if ($v -and $v.Installed -eq 1) { return $true }
  }
  return $false
}
function Git-Path {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in "$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe") { if (Test-Path $p) { return $p } }
  return $null
}
function Claude-Path {
  foreach ($p in "$env:USERPROFILE\.local\bin\claude.exe", "$env:APPDATA\npm\claude.cmd") { if (Test-Path $p) { return $p } }
  $c = Get-Command claude -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

$need = @()
if (-not (Has-VCRedist)) { $need += 'vc' }
if (-not (Git-Path)) { $need += 'git' }
if (-not (Claude-Path)) { $need += 'claude' }
if ($CheckOnly) { if ($need.Count) { Write-Output ('missing: ' + ($need -join ',')) } else { Write-Output 'ok' }; exit 0 }

Say ''
Say "  Checking what $AppName needs." 'White'
Say ''
Say ('  [{0}] Visual C++ runtime (Microsoft)' -f $(if ($need -contains 'vc') { 'needed' } else { 'found' }))
Say ('  [{0}] Git for Windows (git-scm.com)' -f $(if ($need -contains 'git') { 'needed' } else { 'found' }))
Say ('  [{0}] Claude Code (claude.ai)' -f $(if ($need -contains 'claude') { 'needed' } else { 'found' }))
Say ''
if (-not $need.Count) { Say '  Everything is ready.' 'Green'; exit 0 }

$tmp = Join-Path $env:TEMP 'mesh-setup'; New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$failed = @()

if ($need -contains 'vc') {
  Say '  ▶ Installing the Visual C++ runtime… (https://aka.ms/vs/17/release/vc_redist.x64.exe)' 'Cyan'
  try {
    $f = Join-Path $tmp 'vc_redist.x64.exe'
    Invoke-WebRequest -UseBasicParsing 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $f
    $p = Start-Process $f -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru -Verb RunAs
    if ($p.ExitCode -in 0, 1638, 3010) { Say '    done' 'Green' } else { $failed += "Visual C++ (code $($p.ExitCode))" }
  } catch { $failed += "Visual C++ ($($_.Exception.Message))" }
}

if ($need -contains 'git') {
  Say '  ▶ Installing Git for Windows…' 'Cyan'
  $ok = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say '    winget install Git.Git (official Microsoft winget repository)'
    winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements | Out-Host
    $ok = [bool](Git-Path)
  }
  if (-not $ok) {
    try {
      Say '    downloading the latest installer from github.com/git-for-windows…'
      $rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest' -Headers @{ 'User-Agent' = 'mesh-setup' }
      $asset = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1
      $f = Join-Path $tmp $asset.name
      Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $f
      $p = Start-Process $f -ArgumentList '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/SP-' -Wait -PassThru -Verb RunAs
      $ok = [bool](Git-Path)
    } catch { }
  }
  if ($ok) { Say '    done' 'Green' } else { $failed += 'Git for Windows' }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

if ($need -contains 'claude') {
  Say '  ▶ Installing Claude Code… (official installer https://claude.ai/install.ps1)' 'Cyan'
  try {
    $g = Git-Path
    if ($g) { $env:CLAUDE_CODE_GIT_BASH_PATH = (Join-Path (Split-Path (Split-Path $g)) 'bin\bash.exe') }
    Invoke-Expression (Invoke-RestMethod -UseBasicParsing 'https://claude.ai/install.ps1')
  } catch { }
  # put ~/.local/bin on the user PATH so `claude` also works in any new terminal
  $bin = "$env:USERPROFILE\.local\bin"
  $up = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Test-Path "$bin\claude.exe") -and ($up -notlike "*$bin*")) { [Environment]::SetEnvironmentVariable('Path', ($up.TrimEnd(';') + ';' + $bin), 'User') }
  if (Claude-Path) { Say '    done' 'Green' } else { $failed += 'Claude Code' }
}

Say ''
if ($failed.Count) {
  Say ('  Some installs failed: ' + ($failed -join ', ')) 'Yellow'
  Say "  Check your internet connection or admin rights; opening $AppName again retries the install." 'Yellow'
} else {
  Say '  Done.' 'Green'
  if ($need -contains 'claude') { Say "  The first time, open a session in $AppName with + New and sign in to your Claude account." 'White' }
}
Say ''
