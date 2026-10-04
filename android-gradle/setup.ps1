# ============================================================================
#  selfwriting · 一键搭建标准 Gradle 安卓工程
#  作用：把仓库里的源码 / 资源 / 网页应用组装成 android-gradle\ 下的标准工程，
#        并自动探测 JDK、Gradle、Android SDK 路径，写出 local.properties。
#  用法： powershell -ExecutionPolicy Bypass -File android-gradle\setup.ps1
# ============================================================================
param(
  [string]$Sdk,
  [string]$Jdk,
  [string]$Gradle
)

$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
$ROOT = Split-Path -Parent $HERE

function Find-First($candidates, $probe) {
  foreach ($c in $candidates) {
    if ([string]::IsNullOrWhiteSpace($c)) { continue }
    if (Test-Path (Join-Path $c $probe)) { return $c }
  }
  return $null
}

Write-Host '=== selfwriting Gradle 工程配置 ==='

# ---- JDK ----
$jdk = $Jdk
if (-not $jdk) {
  $jdk = Find-First @($env:JAVA_HOME, "$ROOT\tools\android\jdk17", 'D:\swbuild\tools\android\jdk17', 'C:\Program Files\Android\Android Studio\jbr', 'C:\Program Files\Eclipse Adoptium\jdk-17*') 'bin\javac.exe'
}
if (-not $jdk) { throw '找不到 JDK 17。请设置 JAVA_HOME，或运行 tools\android\get-tools.bat 下载便携 JDK。' }
Write-Host "  JDK    : $jdk"

# ---- Gradle ----
$gradleBin = $null
if ($Gradle) {
  $g = $Gradle
  if (Test-Path (Join-Path $Gradle 'bin\gradle.bat')) { $g = Join-Path $Gradle 'bin\gradle.bat' }
  if (Test-Path $g) { $gradleBin = $g }
}
if (-not $gradleBin) {
  $cand = Find-First @("$ROOT\tools\gradle\gradle-8.9", 'D:\Gradle\gradle-8.9', $env:GRADLE_HOME, 'C:\Gradle\gradle-8.9') 'bin\gradle.bat'
  if ($cand) { $gradleBin = Join-Path $cand 'bin\gradle.bat' }
}
if (-not $gradleBin) {
  $cmd = Get-Command gradle.bat -ErrorAction SilentlyContinue
  if ($cmd) { $gradleBin = $cmd.Source }
}
if ($gradleBin) { Write-Host "  Gradle : $gradleBin" } else { Write-Host '  Gradle : 未找到（PATH 里有 gradle 也可以）' }

# ---- Android SDK ----
$sdkRoot = $Sdk
if (-not $sdkRoot) {
  $sdkRoot = Find-First @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, 'D:\Android\sdk', "$env:LOCALAPPDATA\Android\Sdk") 'platform-tools'
}
if (-not $sdkRoot) { throw '找不到 Android SDK。请安装 SDK 后设置 ANDROID_HOME，或用 -Sdk 指定路径。' }
Write-Host "  SDK    : $sdkRoot"

$platforms = Join-Path $sdkRoot 'platforms'
$buildTools = Join-Path $sdkRoot 'build-tools'
$hasPlatform = (Test-Path $platforms) -and ((Get-ChildItem $platforms -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'android-3*' }).Count -gt 0)
$hasBuildTools = (Test-Path $buildTools) -and ((Get-ChildItem $buildTools -Directory -ErrorAction SilentlyContinue).Count -gt 0)
if (-not $hasPlatform -or -not $hasBuildTools) {
  Write-Host '  [!] SDK 里缺少 platforms / build-tools，正在用 sdkmanager 安装 ...'
  $sm = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (Test-Path $sm) {
    $env:JAVA_HOME = $jdk
    & $sm --sdk_root=$sdkRoot 'platform-tools' 'platforms;android-34' 'build-tools;34.0.0'
  } else {
    Write-Host '  [!] 找不到 sdkmanager，请手动安装 platforms;android-34 与 build-tools;34.0.0'
  }
}

# ---- 生成工程结构 ----
$appDir = Join-Path $HERE 'app'
$javaDir = Join-Path $appDir 'src\main\java\com\selfwriting\app'
$resDir = Join-Path $appDir 'src\main\res'
New-Item -ItemType Directory -Force $javaDir | Out-Null
Copy-Item "$ROOT\android\src\com\selfwriting\app\*.java" $javaDir -Force
Copy-Item "$HERE\app\build.gradle" (Join-Path $appDir 'build.gradle') -Force -ErrorAction SilentlyContinue
if (Test-Path $resDir) { Remove-Item -Recurse -Force $resDir }
Copy-Item "$ROOT\android\res" $resDir -Recurse -Force
Copy-Item "$ROOT\android\AndroidManifest.xml" (Join-Path $appDir 'src\main\AndroidManifest.xml') -Force

# local.properties：Gradle 用它定位 SDK
$localProps = Join-Path $HERE 'local.properties'
$sdkEscaped = $sdkRoot.Replace('\', '\\')
Set-Content -LiteralPath $localProps -Value "sdk.dir=$sdkEscaped" -Encoding ASCII
Write-Host "  已写入 : local.properties"

# gradle.properties：钉住 JDK，避免用到系统里的旧 JDK
$gp = Join-Path $HERE 'gradle.properties'
$lines = Get-Content -LiteralPath $gp -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^org\.gradle\.java\.home=' }
$jdkEscaped = $jdk.Replace('\', '\\')
$lines += "org.gradle.java.home=$jdkEscaped"
Set-Content -LiteralPath $gp -Value $lines -Encoding UTF8
Write-Host "  已写入 : gradle.properties (org.gradle.java.home)"

Write-Host ''
Write-Host '工程就绪。构建：'
Write-Host "  cd `"$HERE`""
if ($gradleBin) { Write-Host "  `"$gradleBin`" assembleDebug" } else { Write-Host '  gradle assembleDebug' }
Write-Host '或直接运行 android-gradle\build-gradle.bat'
exit 0
