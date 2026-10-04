@echo off
rem ============================================================
rem  selfwriting - build an installable APK without Android SDK / Gradle.
rem  Uses the same official tools Gradle would call internally:
rem    aapt2   resource + manifest compiler   tools\android\aapt2
rem    javac   java compiler                  tools\android\jdk17
rem    d8      bytecode -> dex                tools\android\r8.jar
rem    apksig  signing + verification         tools\android\apksig.jar
rem  Usage : android\build.bat
rem  Output: dist\selfwriting-1.15.0.apk
rem ============================================================
setlocal enabledelayedexpansion
set HERE=%~dp0
set ROOT=%HERE%..
set TOOLS=%ROOT%\tools\android

rem ---- locate JDK ----
set JVMDIR=%TOOLS%\jdk17
if not exist "%JVMDIR%\bin\javac.exe" if not "%JAVA_HOME%"=="" set JVMDIR=%JAVA_HOME%
if not exist "%JVMDIR%\bin\javac.exe" (
  echo [x] JDK 17 with javac not found. Run tools\android\get-tools.bat first.
  exit /b 1
)
set JAVA=%JVMDIR%\bin\java.exe
set JAVAC=%JVMDIR%\bin\javac.exe
set AAPT2=%TOOLS%\aapt2\aapt2.exe
set R8JAR=%TOOLS%\r8.jar
set APKSIG=%TOOLS%\apksig.jar

rem ---- locate platform android.jar (needed by aapt2 -I) ----
set PLATFORM=%TOOLS%\android28.jar
if not exist "%PLATFORM%" set PLATFORM=%TOOLS%\android.jar
if not exist "%PLATFORM%" (
  echo [x] missing platform android.jar. Run tools\android\get-tools.bat first.
  exit /b 1
)

echo.
echo === selfwriting APK build ===
echo   JDK      : %JVMDIR%
echo   platform : %PLATFORM%

set WORK=%ROOT%\build
set OUT=%ROOT%\dist
if exist "%WORK%" rd /s /q "%WORK%"
mkdir "%WORK%\gen" 2>nul
mkdir "%WORK%\classes" 2>nul
mkdir "%WORK%\dex" 2>nul
mkdir "%WORK%\www" 2>nul
if not exist "%OUT%" mkdir "%OUT%"

rem ---- 1. web assets (note: pkgassets.bat flattens backslashes, Android needs /) ----
echo [1/8] copying web assets to assets\www ...
"%AAPT2%" compile --dir "%HERE%res" -o "%WORK%\res.zip"
if errorlevel 1 ( echo [x] resource compile failed & exit /b 1 )
call "%HERE%pkgassets.bat" "%ROOT%" "%WORK%\www"
if errorlevel 1 ( echo [x] asset packaging failed & exit /b 1 )

rem ---- 3. link (binary manifest + resource table + R.java) ----
rem  Assets: aapt2 copies the CONTENTS of -A dir into assets/.
rem  So pass %WORK%\assets (which contains www\) to end up with assets/www/... -
rem  the shell requests assets/www/index.html, so a flattened layout would break the app.
rem  Using a dedicated dir also keeps build intermediates (base.apk, res.zip) out of the APK.
mkdir "%WORK%\assets" 2>nul
if exist "%WORK%\assets\www" rd /s /q "%WORK%\assets\www"
move "%WORK%\www" "%WORK%\assets\www" >nul
echo [3/8] aapt2 link ...
"%AAPT2%" link -o "%WORK%\base.apk" -I "%PLATFORM%" --manifest "%HERE%AndroidManifest.xml" "%WORK%\res.zip" --java "%WORK%\gen" -A "%WORK%\assets" --min-sdk-version 24 --target-sdk-version 34 --version-code 11 --version-name 1.15.0 --no-version-vectors
if errorlevel 1 ( echo [x] link failed & exit /b 1 )

rem ---- 4. compile java ----
echo [4/8] javac ...
"%JAVAC%" -nowarn -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath "%PLATFORM%" -classpath "%PLATFORM%" -d "%WORK%\classes" "%HERE%src\com\selfwriting\app\MainActivity.java" "%HERE%src\com\selfwriting\app\LocalServer.java" "%WORK%\gen\com\selfwriting\app\R.java"
if errorlevel 1 ( echo [x] java compile failed & exit /b 1 )

rem ---- 4b. compile the apk signer helper (uses apksig) ----
echo [4b/8] javac signing helper ...
mkdir "%WORK%\toolclasses" 2>nul
"%JAVAC%" -nowarn -encoding UTF-8 -classpath "%APKSIG%" -d "%WORK%\toolclasses" "%HERE%toolsrc\com\selfwriting\build\SignApk.java" "%HERE%toolsrc\com\selfwriting\build\VerifyApk.java"
if errorlevel 1 ( echo [x] signer helper compile failed & exit /b 1 )

rem ---- 5. dex ----
echo [5/8] d8 ...
powershell -NoProfile -Command "Get-ChildItem -Path '%WORK%\classes' -Recurse -Filter *.class | ForEach-Object { $_.FullName } | Set-Content -Encoding ASCII '%WORK%\dexargs.txt'"
"%JAVA%" -cp "%R8JAR%" com.android.tools.r8.D8 --release --min-api 24 --lib "%PLATFORM%" --output "%WORK%\dex" "@%WORK%\dexargs.txt"
if errorlevel 1 ( echo [x] dex failed & exit /b 1 )
if not exist "%WORK%\dex\classes.dex" ( echo [x] classes.dex not produced & exit /b 1 )

rem ---- 6. assemble ----
echo [6/8] assembling apk ...
copy /y "%WORK%\base.apk" "%WORK%\unsigned.apk" >nul
powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('%WORK%\unsigned.apk','Update'); $ex=$z.GetEntry('classes.dex'); if($ex){$ex.Delete()}; [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,'%WORK%\dex\classes.dex','classes.dex') | Out-Null; $z.Dispose()"
if errorlevel 1 ( echo [x] assemble failed & exit /b 1 )

rem ---- 7. sign ----
echo [7/8] fixing entry paths + signing (v1+v2+v3) ...
rem Windows aapt2 writes backslashes into APK entry names; Android's AssetManager
rem does not normalize them, so assets would be unreadable on device. Must fix
rem BEFORE signing, otherwise the signature covers the wrong names.
if exist "%ROOT%\tools\fix-apk-paths.js" (
  node "%ROOT%\tools\fix-apk-paths.js" "%WORK%\unsigned.apk"
  if errorlevel 1 ( echo [x] entry path fix failed & exit /b 1 )
)
if not exist "%HERE%keystore\selfwriting.jks" (
  call "%HERE%make-keystore.bat"
  if errorlevel 1 ( echo [x] keystore failed & exit /b 1 )
)
"%JAVA%" -cp "%APKSIG%;%WORK%\toolclasses" com.selfwriting.build.SignApk "%WORK%\unsigned.apk" "%OUT%\selfwriting-1.15.0.apk" "%HERE%keystore\selfwriting.jks" selfwriting selfwriting 24
if errorlevel 1 ( echo [x] sign failed & exit /b 1 )

rem ---- 8. verify ----
echo [8/8] verifying ...
"%JAVA%" -cp "%APKSIG%;%WORK%\toolclasses" com.selfwriting.build.VerifyApk "%OUT%\selfwriting-1.15.0.apk"
if errorlevel 1 ( echo [x] verification failed & exit /b 1 )

echo.
echo === done ===
for %%A in ("%OUT%\selfwriting-1.15.0.apk") do echo   output: %%~fA  (%%~zA bytes)
echo   install: copy to phone and tap, or: adb install -r dist\selfwriting-1.15.0.apk
exit /b 0
