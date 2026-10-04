# selfwriting - publish to GitHub (step 2: create repo, push source, create Release)
# Kept ASCII-only on purpose (Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\gh-publish.ps1 [-Repo selfwriting] [-Private]
param(
  [string]$Repo = 'selfwriting',
  [switch]$PrivateRepo
)
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$token = (Get-Content -LiteralPath (Join-Path $ROOT 'tools\.gh-token') -Raw).Trim()
if (-not $token) { Write-Output 'NO_TOKEN: run tools\gh-auth.ps1 first'; exit 1 }

$H = @{ Authorization = "token $token"; 'User-Agent' = 'selfwriting-publish'; Accept = 'application/vnd.github+json' }
$me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $H -TimeoutSec 60
$owner = $me.login
Write-Output ("ACCOUNT: " + $owner)

# 1) create repo (ignore 422 = already exists)
$payload = @{ name = $Repo; description = 'Offline-first writing app for Android PWA + APK: novels, articles, diaries, outlines, reader, music, achievements'; private = [bool]$PrivateRepo; has_issues = $true; has_wiki = $false } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' -Headers $H -Body $payload -ContentType 'application/json' -TimeoutSec 60
  Write-Output ("REPO_CREATED: " + $r.full_name + "  private=" + $r.private)
} catch {
  Write-Output ("REPO_EXISTS_OR_ERROR: " + $_.Exception.Message)
}

# 2) git init / commit / push
$git = Join-Path $ROOT 'tools\git-portable\cmd\git.exe'
$gi = @('-C', $ROOT)
if (-not (Test-Path (Join-Path $ROOT '.git'))) {
  & $git @gi init -q
  & $git @gi branch -M main
  Write-Output 'GIT_INIT ok'
}
& $git @gi config user.name $owner
& $git @gi config user.email ($owner + '@users.noreply.github.com')
& $git @gi add -A
$staged = (& $git @gi diff --cached --name-only | Measure-Object -Line).Lines
Write-Output ("STAGED_FILES: " + $staged)
& $git @gi -c core.quotepath=false commit -q -m 'selfwriting 1.15.0' 2>&1 | Out-Null
& $git @gi remote remove origin 2>$null | Out-Null
& $git @gi remote add origin ("https://" + $owner + ":" + $token + "@github.com/" + $owner + "/" + $Repo + ".git")
Write-Output 'PUSHING...'
& $git @gi push -u origin main --force 2>&1 | Select-Object -Last 4
Write-Output ("REPO_URL: https://github.com/" + $owner + "/" + $Repo)

# 3) Release with the APK asset
$tag = 'v1.15.0'
$apk = Join-Path $ROOT 'dist\selfwriting-1.15.0.apk'
$body = @'
## selfwriting 1.15.0

Offline-first writing app (Android APK + PWA): novels / articles / diaries / outlines / reader / music / achievements.
All data stays on the device. No account server, no telemetry, no ads, no cloud sync.

### Offline (works in airplane mode)
- **Novels**: per-chapter writing, chapter word goals, outline two-way sync, local heuristic continuation aid, export TXT / Markdown
- **Articles**, **Outlines** (colour branches + highlights), **Diaries**
- **Diary calendar**: lunar calendar / solar terms / festivals / statutory holidays (workday = yellow, rest day = green), circular day cells with per-day entry count badges, tap a date to write, **double-tap to favourite**, **long-press opens a "pick these days" panel** for one multi-day entry, weekly / monthly / custom-interval summaries, mood + weather tags, images
- **Reader**: import TXT / Markdown / HTML / EPUB / MOBI / AZW3 / PRC / PDF, progressive rendering (300-chapter book opens in ~10 ms of sync work), **realistic page-curl turning** (finger-following crease, back of the sheet, spring-back), 4 page modes (scroll / cover / slide / curl), 1-2 column shelves with adjustable cover width, bookmarks with ribbons + TOC hits, favourite hearts, word counts in 万
- **Music**: real sampled instruments (piano / e-piano / guitar / bass, FluidR3_GM CC BY 3.0) + synthesised drums, sound lab, **selectable demo tune library**, **import and play** (paste numbered notation, or import MIDI / app-exported tunes), 16-step composer, lyrics
- **Accounts & status**: local-only profile (nickname / avatar / personal code), WeChat-like status text with expiry, close-friends list, multi-author marking on any work
- **Collaboration**: same-Wi-Fi rooms, paragraph-level merge without overwriting, in-room chat, share packs
- **Achievements, statistics** (time / words / speed / idle gaps / heatmap), full-library JSON backup, games (tetris / snake), calculator, notes, privacy lock, brightness + dark + warm themes, 3 UI languages (zh-CN / English / zh-TW)

### Online (all manually triggered, nothing in the background)
- **Reader -> download from URL**: fetches a book URL you paste
- **Collaboration room**: LAN only, never leaves your local network
- **Installing the APK / adding the PWA**: served from your own machine

### Known limitations
- Continuation aid is a **local heuristic**, not a language model (the app is offline)
- Collaboration merges at paragraph level; same-millisecond edits in the same paragraph have no unique order
- Privacy lock is an **in-app lock, not encryption** (password is salted-hashed)
- PDF: text layer only (scanned PDFs yield nothing); HUFF/CDIC-compressed MOBI unsupported
- Lunar table covers 1900-2100; **solar terms are a formula with +-1 day error**; statutory holidays are exact for 2024-2026, rule-based (and possibly inaccurate on make-up workdays) outside that range
- Piano / e-piano / guitar / bass use real samples; **drums are still synthesised** (no clearly licensed percussion set found)
- Page-curl uses DOM + clip-path; heavy shadows may drop frames on low-end devices
- The SVG desktop-pet cat was **removed** (visual quality was not good enough)
- Android 7.0+ / desktop browsers; iOS untested; DRM-protected e-books cannot be imported

### Privacy
Profiles live only on each user's own device and are never uploaded; the repository and the APK contain no personal data of anyone. Data is stored in IndexedDB + localStorage and survives re-opening the app; use Settings -> export/import backup to move between devices.

### Verification
`tools/verify.js` 100/100 (99/99 against the packaged APK assets), `tools/test-diary.js` 42/42, `tools/test-reader.js` 60/60, `tools/test-music.js` 72/72, `tools/test-collab.js` 31/31, `tools/test-calc.js` 42/42, `tools/verify-apk.js` 31/31.
'@

$relPayload = @{ tag_name = $tag; name = 'selfwriting 1.15.0'; body = $body; draft = $false; prerelease = $false; target_commitish = 'main' } | ConvertTo-Json
try {
  $rel = Invoke-RestMethod -Method Post -Uri ("https://api.github.com/repos/" + $owner + "/" + $Repo + "/releases") -Headers $H -Body $relPayload -ContentType 'application/json' -TimeoutSec 60
  Write-Output ("RELEASE: " + $rel.html_url)
} catch {
  Write-Output ("RELEASE_ERROR: " + $_.Exception.Message)
  $rel = $null
}

if ($rel -and (Test-Path $apk)) {
  $uploadUrl = $rel.upload_url -replace '\{.*$', ''
  $name = Split-Path $apk -Leaf
  $assetApi = $uploadUrl + '?name=' + $name
  $bytes = [System.IO.File]::ReadAllBytes($apk)
  try {
    $asset = Invoke-RestMethod -Method Post -Uri $assetApi -Headers @{ Authorization = "token $token"; 'User-Agent' = 'selfwriting-publish'; Accept = 'application/vnd.github+json' } -ContentType 'application/vnd.android.package-archive' -Body $bytes -TimeoutSec 900
    Write-Output ("ASSET: " + $asset.name + "  " + $asset.size + " bytes  " + $asset.browser_download_url)
  } catch {
    Write-Output ("ASSET_ERROR: " + $_.Exception.Message)
  }
}
Write-Output 'DONE'
