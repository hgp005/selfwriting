@echo off
rem ============================================================
rem  Generate the APK signing key (run once).
rem  Output: android\keystore\selfwriting.jks  (password: selfwriting)
rem ============================================================
setlocal
set HERE=%~dp0
set KEYTOOL=%HERE%..\tools\android\jdk17\bin\keytool.exe

if not exist "%KEYTOOL%" (
  echo [x] keytool not found: %KEYTOOL%
  echo     Run tools\android\get-tools.bat first.
  exit /b 1
)
if exist "%HERE%keystore\selfwriting.jks" (
  echo [=] keystore already exists, nothing to do
  exit /b 0
)
if not exist "%HERE%keystore" mkdir "%HERE%keystore"

"%KEYTOOL%" -genkeypair -v -keystore "%HERE%keystore\selfwriting.jks" -alias selfwriting -keyalg RSA -keysize 2048 -validity 10950 -storetype PKCS12 -storepass selfwriting -keypass selfwriting -dname "CN=selfwriting, O=selfwriting, C=CN"
if errorlevel 1 (
  echo [x] keytool failed
  exit /b 1
)
echo [ok] keystore created: android\keystore\selfwriting.jks
exit /b 0
