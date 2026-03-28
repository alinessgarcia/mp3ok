$ErrorActionPreference = 'Stop'

$ports = @(3000, 4000)
$stopped = @()

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  try {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
  } catch {
    # ignore processes that already exited
  }
}

foreach ($port in $ports) {
  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $connections) {
    if ($stopped -contains $conn.OwningProcess) {
      continue
    }
    try {
      Stop-ProcessTree -ProcessId $conn.OwningProcess
      $stopped += $conn.OwningProcess
      Write-Host "Processo $($conn.OwningProcess) encerrado (porta $port)."
    } catch {
      Write-Warning "Nao foi possivel encerrar processo $($conn.OwningProcess) da porta $port."
    }
  }
}

if ($stopped.Count -eq 0) {
  Write-Host 'Nenhum processo ouvindo nas portas 3000/4000.'
} else {
  Write-Host 'Servicos locais encerrados.'
}
