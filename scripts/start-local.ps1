$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
$frontendPort = 3000
$backendPort = 4000

function Test-TcpPort {
  param(
    [string]$HostName = '127.0.0.1',
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(250)
    if (-not $connected) {
      return $false
    }
    $client.EndConnect($async) | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Ensure-NodeModules {
  param([string]$TargetDir)

  $modulesDir = Join-Path $TargetDir 'node_modules'
  if (Test-Path $modulesDir) {
    return
  }

  Write-Host "Instalando dependencias em $TargetDir..."
  Push-Location $TargetDir
  try {
    npm.cmd install | Out-Host
  } finally {
    Pop-Location
  }
}

function Test-Http {
  param(
    [string]$Url,
    [int]$TimeoutSec = 3
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Start-ServiceWindow {
  param(
    [string]$Name,
    [string]$WorkingDir,
    [string]$Command
  )

  $launch = "$host.UI.RawUI.WindowTitle = '$Name'; Set-Location '$WorkingDir'; $Command"
  Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $launch
  ) | Out-Null
}

Ensure-NodeModules -TargetDir $rootDir
Ensure-NodeModules -TargetDir (Join-Path $rootDir 'backend')
Ensure-NodeModules -TargetDir (Join-Path $rootDir 'frontend')

$backendUp = (Test-TcpPort -Port $backendPort) -and (Test-Http -Url 'http://localhost:4000/api/media/jobs')
$frontendUp = (Test-TcpPort -Port $frontendPort) -and (Test-Http -Url 'http://localhost:3000')

if (-not $backendUp) {
  Write-Host 'Iniciando backend em nova janela...'
  Start-ServiceWindow -Name 'OpenDownloader Backend' -WorkingDir (Join-Path $rootDir 'backend') -Command 'npm.cmd run dev'
}

if (-not $frontendUp) {
  Write-Host 'Iniciando frontend em nova janela...'
  Start-ServiceWindow -Name 'OpenDownloader Frontend' -WorkingDir (Join-Path $rootDir 'frontend') -Command 'npm.cmd run dev'
}

if ($backendUp -and $frontendUp) {
  Write-Host 'Backend e frontend ja estao ativos.'
}

Write-Host 'Aguardando backend/frontend ficarem prontos...'
for ($i = 0; $i -lt 90; $i++) {
  $backendReady = (Test-TcpPort -Port $backendPort) -and (Test-Http -Url 'http://localhost:4000/api/media/jobs')
  $frontendReady = (Test-TcpPort -Port $frontendPort) -and (Test-Http -Url 'http://localhost:3000')
  if ($backendReady -and $frontendReady) {
    Start-Process 'http://localhost:3000'
    Write-Host 'Aplicativo aberto no navegador.'
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Warning 'Nao foi possivel confirmar backend/frontend a tempo. Verifique as janelas OpenDownloader Backend/Frontend.'
