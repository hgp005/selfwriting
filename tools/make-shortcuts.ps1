# ============================================================================
#  make-shortcuts.ps1 — 在桌面创建 selfwriting 快捷方式
#    1) 图标：用 tools\make-icons.js 从 assets\icon-512.png 生成 assets\icon.ico
#       （纯 Node，不依赖浏览器；Edge 在受限权限下无法无头渲染）
#    2) 快捷方式：启动应用 / 手机安装 / 停止服务
#  用法： powershell -ExecutionPolicy Bypass -File tools\make-shortcuts.ps1
# ============================================================================
param(
  [string]$Desktop,
  [switch]$NoIcon
)

$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Desktop) { $Desktop = [Environment]::GetFolderPath('Desktop') }

Write-Host '=== selfwriting 桌面快捷方式 ==='
Write-Host "  项目目录 : $ROOT"
Write-Host "  桌面     : $Desktop"

# ---- 1. 图标 ----
$iconPath = Join-Path $ROOT 'assets\icon.ico'
if (-not $NoIcon) {
  if (-not (Test-Path $iconPath)) {
    & node (Join-Path $ROOT 'tools\make-icons.js')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $iconPath)) {
      Write-Host '  [!] 生成 ICO 失败，将使用默认图标'
      $iconPath = $null
    }
  } else {
    Write-Host "  [=] 图标已存在：$iconPath"
  }
} else { $iconPath = $null }

# ---- 2. 生成 .cmd 包装（双击即用） ----
$cmdPath = Join-Path $ROOT 'selfwriting.cmd'
@"
@echo off
chcp 65001 >nul
title selfwriting
cd /d "%~dp0"
node launcher.js %*
if errorlevel 1 pause
"@ | Set-Content -LiteralPath $cmdPath -Encoding ASCII

$cmdPhone = Join-Path $ROOT 'selfwriting-phone.cmd'
@"
@echo off
chcp 65001 >nul
title selfwriting - 手机安装
cd /d "%~dp0"
node launcher.js phone
"@ | Set-Content -LiteralPath $cmdPhone -Encoding ASCII

$cmdStop = Join-Path $ROOT 'selfwriting-stop.cmd'
@"
@echo off
chcp 65001 >nul
title selfwriting - 停止服务
cd /d "%~dp0"
node launcher.js stop
timeout /t 2 >nul
"@ | Set-Content -LiteralPath $cmdStop -Encoding ASCII

# ---- 3. 创建快捷方式 ----
$ws = New-Object -ComObject WScript.Shell
function New-Lnk {
  param([string]$Name, [string]$Target, [string]$Arguments, [string]$Desc, [string]$Icon)
  $lnkPath = Join-Path $Desktop ($Name + '.lnk')
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $Target
  $lnk.Arguments = $Arguments
  $lnk.WorkingDirectory = $ROOT
  $lnk.Description = $Desc
  if ($Icon -and (Test-Path $Icon)) { $lnk.IconLocation = ($Icon + ',0') }
  $lnk.Save()
  Write-Host "  [ok] $Name.lnk"
}

New-Lnk -Name 'selfwriting 创作'     -Target $cmdPath      -Arguments '' -Desc 'selfwriting · 离线创作（启动本地服务并打开应用）' -Icon $iconPath
New-Lnk -Name 'selfwriting 手机安装' -Target $cmdPhone     -Arguments '' -Desc '显示手机访问地址，用于安装 APK / 添加到主屏幕' -Icon $iconPath
New-Lnk -Name 'selfwriting 停止服务' -Target $cmdStop      -Arguments '' -Desc '停止 selfwriting 本地服务' -Icon $iconPath

Write-Host ''
Write-Host '完成。桌面现在有 3 个快捷方式：'
Write-Host '  selfwriting 创作      双击启动并打开应用'
Write-Host '  selfwriting 手机安装  显示手机端地址（装 APK 用）'
Write-Host '  selfwriting 停止服务  关闭后台服务'
if ($iconPath) { Write-Host "图标：$iconPath" }
exit 0
