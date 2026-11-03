param([int]$Port = 3001)
# One-command end-to-end: start server -> wait for /api/health -> run smoke.py -> stop server.
# Usage: pnpm e2e
#        powershell -ExecutionPolicy Bypass -File scripts\e2e.ps1 [-Port 3101]
# NOTE: kept ASCII-only so Windows PowerShell 5.1 parses it correctly (no encoding issues).

$ErrorActionPreference = "Stop"
# smoke.py 输出 UTF-8 中文；PowerShell 5.1 默认按 GBK 解码会乱码，这里统一成 UTF-8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:PYTHONIOENCODING = "utf-8"
$root = Split-Path -Parent $PSScriptRoot
$base = "http://127.0.0.1:$Port"
$log = Join-Path $root "scripts\e2e-server.log"
$err = "$log.err"

Write-Host "[e2e] root: $root"
Set-Location $root

# Windows may expose both HTTPS_PROXY and https_proxy; Start-Process rejects the duplicate
# case-insensitive keys. Normalize proxy vars (localhost tests do not need a proxy anyway).
foreach ($n in @('http_proxy','https_proxy','all_proxy','no_proxy')) {
  try { Remove-Item "Env:$n" -ErrorAction SilentlyContinue } catch {}
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[e2e] port $Port is already in use. Close it or use -Port <other>." -ForegroundColor Yellow
  exit 1
}

$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }

Write-Host "[e2e] starting server on port $Port (forced mock mode, isolated from real .env credentials) ..."
$env:SERVER_PORT = "$Port"
# e2e 必须完全离线可复现：强制四个平台 mock，不连真实平台/邮箱，也不受 .env 真实凭据影响
$env:FEISHU_MODE = "mock"
$env:DINGTALK_MODE = "mock"
$env:WECOM_MODE = "mock"
$env:MAIL_MODE = "mock"
$env:DINGTALK_STREAM = "false"
$env:MAIL_ENABLED = "false"
# 入口令牌也固定，避免用户改了 .env 的 API_TOKEN 后 smoke.py 401
$env:API_TOKEN = "dev-token"
$env:LINKHUB_API_TOKEN = "dev-token"
$proc = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "pnpm --filter @unimsg/server start" `
  -WorkingDirectory $root -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError $err

function Stop-Server {
  if ($proc -and -not $proc.HasExited) {
    & taskkill /PID $proc.Id /T /F 2>$null | Out-Null
  }
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $listeners) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
}

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-RestMethod "$base/api/health" -TimeoutSec 2
    if ($r.ok) { $ready = $true; break }
  } catch {}
}

if (-not $ready) {
  Write-Host "[e2e] server not ready within 20s. Log:" -ForegroundColor Red
  if (Test-Path $log) { Get-Content $log -Tail 20 }
  if (Test-Path $err) { Get-Content $err -Tail 20 }
  Stop-Server
  exit 1
}

Write-Host "[e2e] server ready, running smoke ..." -ForegroundColor Cyan
& $python "scripts\smoke.py" $base
$code = $LASTEXITCODE

Write-Host "[e2e] stopping server ..."
Stop-Server

if ($code -eq 0) {
  Write-Host "[e2e] PASS" -ForegroundColor Green
} else {
  Write-Host "[e2e] FAIL (exit $code)" -ForegroundColor Red
}
exit $code
