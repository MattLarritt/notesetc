<#
================================================================================
 start-notesetc.ps1  -  Start (or stop) the Notes Etc dev servers.

 Runs the API (:4100) and web (:3100) each in their OWN terminal window, so they
 keep running independently of whatever launched them (Claude Code, VS Code, etc).

 Usage:
   ./start-notesetc.ps1          # free ports, start both, wait until healthy
   ./start-notesetc.ps1 -Stop    # stop both servers
   ./start-notesetc.ps1 -Api     # start only the API
   ./start-notesetc.ps1 -Web     # start only the web app

 Ports 3100 (web) and 4100 (API) are Notes Etc's dedicated dev ports.
================================================================================
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Api,
    [switch]$Web
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Ports = @{ API = 4100; Web = 3100 }

# Prefer PowerShell 7 (pwsh) for the child windows; fall back to Windows PowerShell.
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
$Shell = if ($pwsh) { $pwsh.Source } else { 'powershell.exe' }

function Stop-Port([int]$Port, [string]$Label) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { Write-Host "  $Label ($Port): already free" -ForegroundColor DarkGray; return }
    foreach ($procId in ($conns.OwningProcess | Select-Object -Unique)) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Host "  $Label ($Port): stopped PID $procId" -ForegroundColor Yellow
        } catch {
            Write-Host "  $Label ($Port): could not stop PID $procId ($($_.Exception.Message))" -ForegroundColor Red
        }
    }
    Start-Sleep -Milliseconds 800
}

function Start-Server([string]$NpmScript, [string]$Title) {
    # -NoExit keeps the window open so you can watch logs / it keeps serving.
    Start-Process -FilePath $Shell `
        -WorkingDirectory $Root `
        -ArgumentList @(
            '-NoExit',
            '-Command',
            "`$Host.UI.RawUI.WindowTitle = '$Title'; npm run $NpmScript"
        ) | Out-Null
    Write-Host "  launched: $Title  (npm run $NpmScript)" -ForegroundColor Cyan
}

function Wait-Until([string]$Url, [string]$Label, [int]$TimeoutSec = 90) {
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        try {
            $code = (Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop).StatusCode
            if ($code -eq 200) { Write-Host "  $Label ready ($Url) after ${i}s" -ForegroundColor Green; return $true }
        } catch { Start-Sleep -Seconds 1 }
    }
    Write-Host "  $Label did NOT become ready within ${TimeoutSec}s ($Url)" -ForegroundColor Red
    return $false
}

function Ensure-Database {
    # The database is the 'db' service in docker-compose. The API assumes it is
    # already up, so make sure Docker is running and the container is healthy
    # before we launch anything (this is what breaks after a reboot).
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "  docker CLI not found - start your database manually (expected on localhost:5432)." -ForegroundColor Yellow
        return
    }

    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Docker engine not running - starting Docker Desktop..." -ForegroundColor Yellow
        $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if (Test-Path $dd) { Start-Process $dd } else { Write-Host "  Could not find Docker Desktop.exe - please start Docker manually." -ForegroundColor Red }
        $up = $false
        for ($i = 0; $i -lt 90; $i++) {
            docker info *> $null
            if ($LASTEXITCODE -eq 0) { $up = $true; break }
            Start-Sleep -Seconds 2
        }
        if (-not $up) { Write-Host "  Docker engine did not start in time - check Docker Desktop." -ForegroundColor Red; return }
        Write-Host "  Docker engine is up." -ForegroundColor Green
    }

    Write-Host "  Bringing up the database container..." -ForegroundColor Cyan
    docker compose --project-directory $Root up -d db *> $null
    $cid = (docker compose --project-directory $Root ps -q db 2>$null | Select-Object -First 1)
    if (-not $cid) { Write-Host "  Could not resolve the db container - check 'docker compose ps'." -ForegroundColor Red; return }
    for ($i = 0; $i -lt 30; $i++) {
        $status = (docker inspect -f '{{.State.Health.Status}}' $cid 2>$null)
        if ($status -eq 'healthy') { Write-Host "  Database ready (healthy)." -ForegroundColor Green; return }
        Start-Sleep -Seconds 2
    }
    Write-Host "  Database container is up but not reporting healthy yet - the API may retry on connect." -ForegroundColor Yellow
}

# --- stop mode ---------------------------------------------------------------
if ($Stop) {
    Write-Host "Stopping Notes Etc servers..." -ForegroundColor White
    Stop-Port $Ports.Web 'web'
    Stop-Port $Ports.API 'api'
    Write-Host "Done." -ForegroundColor White
    return
}

# --- start mode --------------------------------------------------------------
# Default: both. If -Api or -Web is given, start only those.
$startApi = $Api -or (-not $Api -and -not $Web)
$startWeb = $Web -or (-not $Api -and -not $Web)

Write-Host "Freeing ports..." -ForegroundColor White
if ($startApi) { Stop-Port $Ports.API 'api' }
if ($startWeb) { Stop-Port $Ports.Web 'web' }

# The API needs the database. Make sure it's up before launching servers.
if ($startApi) {
    Write-Host "Ensuring database is up..." -ForegroundColor White
    Ensure-Database
}

Write-Host "Starting servers (each in its own window)..." -ForegroundColor White
if ($startApi) { Start-Server 'dev:api' 'Notes Etc API :4100' }
if ($startWeb) { Start-Server 'dev:web' 'Notes Etc Web :3100' }

Write-Host "Waiting for health checks..." -ForegroundColor White
$ok = $true
if ($startApi) { $ok = (Wait-Until "http://localhost:$($Ports.API)/readyz" 'API') -and $ok }
if ($startWeb) { $ok = (Wait-Until "http://localhost:$($Ports.Web)/login" 'Web') -and $ok }

Write-Host ""
if ($ok) {
    Write-Host "Notes Etc is up:" -ForegroundColor Green
    if ($startWeb) { Write-Host "  Web     http://localhost:$($Ports.Web)" }
    if ($startApi) { Write-Host "  API     http://localhost:$($Ports.API)   (docs: /docs, MCP: /api/v1/mcp)" }
    Write-Host "  Stop with:  ./start-notesetc.ps1 -Stop"
} else {
    Write-Host "One or more servers failed to start - check their windows for errors." -ForegroundColor Red
}
