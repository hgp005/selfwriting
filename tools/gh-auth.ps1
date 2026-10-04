# selfwriting - publish to GitHub (step 1: get authorization)
# OAuth device flow: this script prints a short code, you enter it in the browser, we get a token.
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\gh-auth.ps1
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$tokenFile = Join-Path $ROOT 'tools\.gh-token'

# Public client_id of GitHub CLI (fine for the device flow; no app registration needed)
$clientId = '178c6fc778ccc68e1d6a'
$scope = 'repo'

$body = @{ client_id = $clientId; scope = $scope }
$code = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/device/code' -Body $body -Headers @{ Accept = 'application/json' } -TimeoutSec 60

Write-Output ''
Write-Output '===================================================='
Write-Output ('  1) open:  ' + $code.verification_uri)
Write-Output ('  2) code:  ' + $code.user_code)
Write-Output '  3) Continue -> Authorize github'
Write-Output '===================================================='
Write-Output ''
Write-Output 'AUTH_WAITING'

$interval = [int]$code.interval
if ($interval -lt 5) { $interval = 5 }
$deadline = (Get-Date).AddMinutes(15)
$token = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds $interval
  $poll = @{ client_id = $clientId; device_code = $code.device_code; grant_type = 'urn:ietf:params:oauth:grant-type:device_code' }
  try {
    $res = Invoke-RestMethod -Method Post -Uri 'https://github.com/login/oauth/access_token' -Body $poll -Headers @{ Accept = 'application/json' } -TimeoutSec 60
  } catch {
    Write-Output ('  poll error: ' + $_.Exception.Message)
    continue
  }
  if ($res.access_token) { $token = $res.access_token; break }
  if ($res.error -eq 'authorization_pending') { continue }
  if ($res.error -eq 'slow_down') { $interval += 5; continue }
  if ($res.error) { Write-Output ('  AUTH_FAILED: ' + $res.error + ' ' + $res.error_description); exit 1 }
}

if (-not $token) { Write-Output '  AUTH_TIMEOUT'; exit 1 }

New-Item -ItemType Directory -Force -Path (Split-Path $tokenFile) | Out-Null
Set-Content -LiteralPath $tokenFile -Value $token -NoNewline -Encoding ASCII

$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers @{ Authorization = "token $token"; 'User-Agent' = 'selfwriting-publish'; Accept = 'application/vnd.github+json' } -TimeoutSec 60
Write-Output ''
Write-Output ('AUTH_OK login=' + $me.login + ' name=' + $me.name)
Write-Output ('token saved to ' + $tokenFile + ' (gitignored)')
