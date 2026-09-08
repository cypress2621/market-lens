param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$siteRoot = $PSScriptRoot
$siteUrl = 'http://127.0.0.1:3000'
$existing = $false
try { $health = Invoke-RestMethod -Uri "$siteUrl/api/health" -TimeoutSec 2; $existing = $health.app -eq 'market-lens' } catch {}
if (-not $existing) {
  $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
  $cliPath = Join-Path $siteRoot 'node_modules\vinext\dist\cli.js'
  if (-not (Test-Path -LiteralPath $cliPath)) { throw 'Missing local dependencies. Please run npm install in this project.' }
  $siteProcess = Start-Process -FilePath $nodeCommand -ArgumentList @(('"' + $cliPath + '"'), 'dev', '--hostname', '127.0.0.1', '--port', '3000') -WorkingDirectory $siteRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $siteRoot 'local-server.log') -RedirectStandardError (Join-Path $siteRoot 'local-server-error.log') -PassThru
  $siteProcess.Id | Set-Content -LiteralPath (Join-Path $siteRoot '.local-server.pid')
  for ($attempt=0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 1
    if ($siteProcess.HasExited) { throw 'The local server exited. See local-server-error.log.' }
    try { $health = Invoke-RestMethod -Uri "$siteUrl/api/health" -TimeoutSec 2; if ($health.app -eq 'market-lens') { $existing=$true; break } } catch {}
  }
}
if ($existing) { if (-not $NoOpen) { Start-Process $siteUrl } } else { throw 'The website did not become ready. See local-server-error.log.' }
