# selfwriting - publish to GitHub (robust version: tolerant of git stderr)
# ASCII-only on purpose (Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\gh-publish2.ps1 [-Repo selfwriting]
param([string]$Repo = 'selfwriting')
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ErrorActionPreference = 'Continue'

$token = (Get-Content -LiteralPath (Join-Path $ROOT 'tools\.gh-token') -Raw).Trim()
if (-not $token) { Write-Output 'NO_TOKEN'; exit 1 }
$H = @{ Authorization = "token $token"; 'User-Agent' = 'selfwriting-publish'; Accept = 'application/vnd.github+json' }

$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $H -TimeoutSec 60
$owner = $me.login
Write-Output ("ACCOUNT: " + $owner)

# ensure repo exists
try {
  $null = Invoke-RestMethod -Uri ("https://api.github.com/repos/" + $owner + "/" + $Repo) -Headers $H -TimeoutSec 60
  Write-Output ("REPO_OK: " + $owner + "/" + $Repo)
} catch {
  $payload = @{ name = $Repo; description = 'Offline-first writing app (Android APK + PWA): novels, articles, diaries, outlines, reader, music, achievements'; private = $false } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $H -Body $payload -ContentType 'application/json' -TimeoutSec 60
  Write-Output ("REPO_CREATED: " + $owner + "/" + $Repo)
}

# ---- git: every call tolerated, exit codes checked manually ----
$git = Join-Path $ROOT 'tools\git-portable\cmd\git.exe'
function RunGit([string[]]$a) {
  $out = & $git -C $ROOT @a 2>&1
  $code = $LASTEXITCODE
  return @{ code = $code; out = ($out | Out-String).Trim() }
}

if (-not (Test-Path (Join-Path $ROOT '.git'))) { $null = RunGit @('init','-q'); $null = RunGit @('branch','-M','main'); Write-Output 'GIT_INIT' }
$null = RunGit @('config','user.name',$owner)
$null = RunGit @('config','user.email',($owner + '@users.noreply.github.com'))
$add = RunGit @('add','-A')
Write-Output ("GIT_ADD exit=" + $add.code)
$commit = RunGit @('commit','-q','-m','selfwriting 1.15.0')
Write-Output ("GIT_COMMIT exit=" + $commit.code + " " + ($commit.out -split "`n" | Select-Object -First 1))

$url = "https://" + $owner + ":" + $token + "@github.com/" + $owner + "/" + $Repo + ".git"
$setUrl = RunGit @('remote','set-url','origin',$url)
if ($setUrl.code -ne 0) { $null = RunGit @('remote','add','origin',$url) }
$push = RunGit @('push','-u','origin','main','--force')
Write-Output ("GIT_PUSH exit=" + $push.code)
Write-Output (($push.out -split "`n" | Select-Object -Last 3) -join ' | ')
Write-Output ("REPO_URL: https://github.com/" + $owner + "/" + $Repo)

# ---- release ----
$tag = 'v1.15.0'
$apk = Join-Path $ROOT 'dist\selfwriting-1.15.0.apk'
$notes = Join-Path $ROOT 'tools\release-notes.md'
$body = if (Test-Path $notes) { Get-Content -LiteralPath $notes -Raw } else { 'selfwriting 1.15.0' }

$rel = $null
try {
  $relPayload = @{ tag_name = $tag; name = 'selfwriting 1.15.0'; body = $body; draft = $false; prerelease = $false; target_commitish = 'main' } | ConvertTo-Json
  $rel = Invoke-RestMethod -Method Post -Uri ("https://api.github.com/repos/" + $owner + "/" + $Repo + "/releases") -Headers $H -Body $relPayload -ContentType 'application/json' -TimeoutSec 120
  Write-Output ("RELEASE: " + $rel.html_url)
} catch {
  Write-Output ("RELEASE_ERROR: " + $_.Exception.Message)
  try {
    $rel = Invoke-RestMethod -Uri ("https://api.github.com/repos/" + $owner + "/" + $Repo + "/releases/tags/" + $tag) -Headers $H -TimeoutSec 60
    Write-Output ("RELEASE_EXISTS: " + $rel.html_url)
  } catch { Write-Output 'RELEASE_MISSING' }
}

if ($rel -and (Test-Path $apk)) {
  $uploadUrl = ($rel.upload_url -replace '\{.*$','') + '?name=' + (Split-Path $apk -Leaf)
  try {
    $bytes = [System.IO.File]::ReadAllBytes($apk)
    $asset = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers @{ Authorization = "token $token"; 'User-Agent' = 'selfwriting-publish'; Accept = 'application/vnd.github+json' } -ContentType 'application/vnd.android.package-archive' -Body $bytes -TimeoutSec 900
    Write-Output ("ASSET: " + $asset.name + "  " + $asset.size + " bytes  " + $asset.browser_download_url)
  } catch {
    Write-Output ("ASSET_ERROR: " + $_.Exception.Message)
  }
}
Write-Output 'DONE'
