# Trade Pro — desktop launcher
#
# Builds a one-click .exe: double-click it and the Vite dev server starts and
# the app opens in your browser. Nothing to install, no terminal, no commands.
#
# The .exe is a self-contained Windows batch script wrapped in a native stub,
# so it works from the desktop / Start menu / taskbar pin.
#
# Build:  npm run dist   (or: powershell -File scripts/makeLauncher.ps1)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
# The launcher goes on the user's Desktop (that is where the user asked for it)
# and a copy is kept next to the build for the taskbar / Start-menu case.
$desktop = [Environment]::GetFolderPath("Desktop")
$staging = Join-Path $root "dist"
$exe     = Join-Path $staging "TradePro.exe"
$bat     = Join-Path $staging "TradePro.bat"
$desktopExe = Join-Path $desktop "TradePro.exe"

foreach ($d in @($staging)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# --- 1. The batch script the .exe runs -------------------------------------
# It starts the dev server (idempotently — a second click is a no-op) and opens
# the browser once the port answers.
#
# NOTE ON SYNTAX: this is written with single-quoted here-string (not double)
# because a double-quoted here-string mangles the literal "%" characters batch
# needs for its own variables. Keep it plain ASCII and avoid smart quotes.
#
# ORIGIN: always open http://localhost:5173 — NEVER 127.0.0.1. The browser
# treats the two hostnames as DIFFERENT origins, so localStorage (all saved
# drawings, indicator settings, tool styles, AI config) does not cross over.
# Opening the IP after the user worked on the hostname is exactly what wiped
# their chart on first launch.
$batch = @'
@echo off
title Trade Pro
setlocal

rem -- Node/npm live in a folder that is NOT on the system PATH when Windows
rem -- launches this file from the Desktop, so resolve them explicitly. --
set NODEDIR=C:\Users\Hermes\AppData\Local\hermes\node
set PATH=%NODEDIR%;%PATH%
set ROOT=D:\apps\trade-pro
set PORT=5173

rem -- Already running? Just open the browser and quit. --
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  start "" "http://localhost:5173"
  exit /b 0
)

rem -- Start the dev server detached, no console window flash. --
rem -- server.log goes OUTSIDE dist/ — dist is the Vite build output and Vite
rem -- wipes it on every build; a locked log there makes the build fail with
rem -- EBUSY while the server is running.
cd /d "%ROOT%"
start "" /B cmd /c "call "%NODEDIR%\npx.cmd" vite --host --port 5173 > "%ROOT%\server.log" 2>&1"

rem -- Wait for the port to come up (max ~60s), then open the browser. --
powershell -NoProfile -Command "$ok=$false; for ($i=0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch { Start-Sleep -Milliseconds 800 } }; if ($ok) { Start-Process 'http://localhost:5173' }"
exit /b 0
'@

Set-Content -Path $bat -Value $batch -Encoding ASCII

# --- 2. Wrap it in a real .exe ---------------------------------------------
# iexpress ships with Windows and produces a genuine .exe that runs the .bat
# with no console window. If it's unavailable, fall back to a .cmd shortcut.
$iexpress = Join-Path $env:SystemRoot "System32\iexpress.exe"
if (Test-Path $iexpress) {
  $sed = Join-Path $staging "trade-pro.sed"
  @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$exe
FriendlyName=Trade Pro
AppLaunched=cmd /c TradePro.bat
PostInstallCmd=
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="TradePro.bat"
[SourceFiles]
SourceFiles0=$staging\
"@ | Set-Content -Path $sed -Encoding ASCII

  & $iexpress /Q /N /M $sed 2>$null
  if (Test-Path $exe) {
    # Copy it to the Desktop so a double-click from there starts everything.
    Copy-Item $exe $desktopExe -Force
    Write-Host "Built: $exe" -ForegroundColor Green
    Write-Host "Desktop: $desktopExe" -ForegroundColor Green
    exit 0
  }
}

# Fallback: a .cmd that is just as clickable.
$cmd = Join-Path $root "dist\TradePro.cmd"
Copy-Item $bat $cmd -Force
Copy-Item $cmd (Join-Path $desktop "TradePro.cmd") -Force
Write-Host "iexpress unavailable - wrote $cmd instead" -ForegroundColor Yellow
Write-Host "Double-click it (or the Desktop copy) to start the server and open the app."
