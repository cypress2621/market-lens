$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.local-server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No managed website process found.'; exit }
$siteProcessId = [int](Get-Content -LiteralPath $pidFile)
$siteProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $siteProcessId"
$expectedCli = Join-Path $PSScriptRoot 'node_modules\vinext\dist\cli.js'
if ($siteProcessInfo -and $siteProcessInfo.Name -eq 'node.exe' -and $siteProcessInfo.CommandLine.IndexOf($expectedCli, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
  Stop-Process -Id $siteProcessId
  Remove-Item -LiteralPath $pidFile
  Write-Output 'Website stopped.'
} else { Write-Output 'The recorded process is no longer the website. Nothing stopped.' }
