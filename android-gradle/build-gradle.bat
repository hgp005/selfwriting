@echo off
rem ============================================================
rem  selfwriting - build the APK with the standard Android toolchain
rem  (Android SDK + Gradle). Optional: android\build.bat already
rem  produces the same APK without them.
rem
rem  Requirements (see ANDROID.md):
rem    Android SDK  - build-tools;34.0.0 + platforms;android-34
rem    Gradle       - gradle 8.9 (PATH, GRADLE_HOME, or D:\Gradle\gradle-8.9)
rem    JDK 17       - JAVA_HOME or ..\tools\android\jdk17
rem
rem  Usage: android-gradle\build-gradle.bat [task]   (default: assembleDebug)
rem ============================================================
setlocal enabledelayedexpansion
set HERE=%~dp0
set ROOT=%HERE%..
set TASK=%1
if "%TASK%"=="" set TASK=assembleDebug

rem ---- JDK ----
if not "%JAVA_HOME%"=="" if exist "%JAVA_HOME%\bin\javac.exe" goto :jdk_ok
set JAVA_HOME=%ROOT%\tools\android\jdk17
:jdk_ok
if not exist "%JAVA_HOME%\bin\javac.exe" (
  echo [x] JDK 17 not found. Set JAVA_HOME or run tools\android\get-tools.bat
  exit /b 1
)

rem ---- Gradle ----
set GRADLE=
if exist "%ROOT%\tools\gradle\gradle-8.9\bin\gradle.bat" set GRADLE=%ROOT%\tools\gradle\gradle-8.9\bin\gradle.bat
if "%GRADLE%"=="" if exist "D:\Gradle\gradle-8.9\bin\gradle.bat" set GRADLE=D:\Gradle\gradle-8.9\bin\gradle.bat
if "%GRADLE%"=="" if not "%GRADLE_HOME%"=="" if exist "%GRADLE_HOME%\bin\gradle.bat" set GRADLE=%GRADLE_HOME%\bin\gradle.bat
if "%GRADLE%"=="" (
  where gradle.bat >nul 2>nul && set GRADLE=gradle.bat
)
if "%GRADLE%"=="" (
  echo [x] Gradle not found. Install Gradle 8.9 or set GRADLE_HOME.
  exit /b 1
)

echo.
echo === selfwriting Gradle build ===
echo   JAVA_HOME : %JAVA_HOME%
echo   Gradle    : %GRADLE%
echo   Task      : %TASK%
echo.

cd /d "%HERE%"
call "%GRADLE%" -q --console=plain %TASK%
if errorlevel 1 (
  echo [x] gradle %TASK% failed
  exit /b 1
)

echo.
echo === done ===
for %%F in ("%HERE%app\build\outputs\apk\debug\app-debug.apk" "%HERE%app\build\outputs\apk\release\app-release.apk") do (
  if exist %%F echo   output: %%~fF  (%%~zF bytes)
)
exit /b 0
