# 下载构建 APK 所需的全部工具到 tools\android（无需 Android SDK / Gradle）。
# 用法： powershell -File get-tools.ps1 -Target <tools\android 目录>
param([Parameter(Mandatory = $true)][string]$Target)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-File($url, $out, $minMB) {
  if (Test-Path $out) {
    $mb = (Get-Item $out).Length / 1MB
    if ($mb -ge $minMB) { Write-Host ("  [=] {0} 已存在 ({1:N1} MB)" -f (Split-Path $out -Leaf), $mb); return }
  }
  Write-Host ("  [>] 下载 {0}" -f (Split-Path $out -Leaf))
  $tmp = "$out.part"
  Invoke-WebRequest -Uri $url -OutFile $tmp -TimeoutSec 1800 -UseBasicParsing
  Move-Item $tmp $out -Force
  Write-Host ("  [ok] {0:N1} MB" -f ((Get-Item $out).Length / 1MB))
}

$mirror = 'https://gh-proxy.com/'
$jdkUrl = $mirror + 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_windows_hotspot_17.0.20.1_1.zip'

# ---- JDK ----
$jdkDir = Join-Path $Target 'jdk17'
if (Test-Path (Join-Path $jdkDir 'bin\javac.exe')) {
  Write-Host '  [=] JDK 17 已存在'
} else {
  $zip = Join-Path $Target 'jdk17.zip'
  Get-File $jdkUrl $zip 100
  Write-Host '  [>] 解压 JDK ...'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $tmpDir = Join-Path $Target 'jdk17tmp'
  if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmpDir)
  $inner = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
  if (Test-Path $jdkDir) { Remove-Item -Recurse -Force $jdkDir }
  Move-Item $inner.FullName $jdkDir
  Remove-Item -Recurse -Force $tmpDir
  if (-not (Test-Path (Join-Path $jdkDir 'bin\javac.exe'))) { throw 'JDK 解压后找不到 javac.exe' }
  Write-Host '  [ok] JDK 17 就绪'
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

# ---- aapt2 ----
$aapt2Dir = Join-Path $Target 'aapt2'
if (-not (Test-Path (Join-Path $aapt2Dir 'aapt2.exe'))) {
  $jar = Join-Path $Target 'aapt2.jar'
  Get-File 'https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/8.7.3-12006047/aapt2-8.7.3-12006047-windows.jar' $jar 1
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $aapt2Dir) { Remove-Item -Recurse -Force $aapt2Dir }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($jar, $aapt2Dir)
  Write-Host '  [ok] aapt2 就绪'
} else { Write-Host '  [=] aapt2 已存在' }

# ---- r8 / apksig ----
Get-File 'https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.7.18/r8-8.7.18.jar' (Join-Path $Target 'r8.jar') 10
Get-File 'https://dl.google.com/dl/android/maven2/com/android/tools/build/apksig/8.7.3/apksig-8.7.3.jar' (Join-Path $Target 'apksig.jar') 0.3

# ---- 平台资源表（aapt2 -I 需要）----
$plat = Join-Path $Target 'android28.jar'
if (-not (Test-Path $plat)) {
  $ok = $false
  foreach ($u in @(
      ($mirror + 'https://raw.githubusercontent.com/Sable/android-platforms/master/android-28/android.jar'),
      'https://ghproxy.net/https://raw.githubusercontent.com/Sable/android-platforms/master/android-28/android.jar',
      'https://raw.githubusercontent.com/Sable/android-platforms/master/android-28/android.jar')) {
    try { Get-File $u $plat 10; $ok = $true; break } catch { Write-Host "  [!] 该源失败，换下一个" }
  }
  if (-not $ok) { throw 'android.jar 下载失败，请手动放到 tools\android\android28.jar' }
} else { Write-Host '  [=] android28.jar 已存在' }

Write-Host ''
Write-Host '工具就绪：'
Get-ChildItem $Target | Where-Object { -not $_.PSIsContainer } | ForEach-Object { Write-Host ("  {0,-16} {1,8:N2} MB" -f $_.Name, ($_.Length / 1MB)) }
Get-ChildItem $Target -Directory | ForEach-Object { Write-Host ("  {0,-16} <dir>" -f $_.Name) }
exit 0
