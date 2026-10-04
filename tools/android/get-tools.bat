@echo off
rem ============================================================
rem  Download the portable build toolchain into tools\android
rem  (no Android SDK / Gradle required):
rem    jdk17      portable Temurin JDK 17 (javac + keytool + java)
rem    aapt2      resource compiler (Google)
rem    r8.jar     d8 dexer (Google)
rem    apksig.jar apk signing library (Google)
rem    android.jar  platform resource table used by aapt2 -I
rem  Usage: tools\android\get-tools.bat
rem ============================================================
setlocal
set HERE=%~dp0
if not exist "%HERE%" mkdir "%HERE%"
echo Downloading build tools into %HERE% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%get-tools.ps1" -Target "%HERE%"
if errorlevel 1 (
  echo [x] failed
  exit /b 1
)
echo [ok] done
exit /b 0
