@echo off
rem ============================================================
rem  Package the web assets into <targetDir> for the APK.
rem  Usage: pkgassets.bat <projectRoot> <targetDir>
rem
rem  IMPORTANT: this script must NEVER rewrite the contents of the web app.
rem  An earlier version replaced backslashes with slashes inside the copied
rem  files, which destroyed JavaScript escape sequences (\uXXXX, \n, \')
rem  and silently produced a broken APK. Path separators inside the APK are
rem  handled separately and safely by tools\fix-apk-paths.js (entry names only).
rem ============================================================
setlocal
set ROOT=%~1
set TGT=%~2
if "%ROOT%"=="" exit /b 1
if "%TGT%"=="" exit /b 1

if exist "%TGT%" rd /s /q "%TGT%"
mkdir "%TGT%" 2>nul

for %%F in (index.html manifest.webmanifest sw.js) do (
  copy /y "%ROOT%\%%F" "%TGT%\%%F" >nul
)
xcopy /e /i /q /y "%ROOT%\css" "%TGT%\css\" >nul
xcopy /e /i /q /y "%ROOT%\js" "%TGT%\js\" >nul
if exist "%ROOT%\assets" mkdir "%TGT%\assets" 2>nul
rem  ---- 采样音色：assets/samples 是子目录，上面那条 for 只拷一层，这里递归补上 ----
if exist "%ROOT%\assets\samples" xcopy /e /i /q /y "%ROOT%\assets\samples" "%TGT%\assets\samples\" >nul
for %%F in ("%ROOT%\assets\*") do (
  if not "%%~xF"==".bat" copy /y "%%~fF" "%TGT%\assets\%%~nxF" >nul
)

rem ---- integrity guard: the payload must be copied byte-for-byte ----
rem  A corrupted payload shows up as "/uXXXX" where the source has "\uXXXX".
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t='%TGT%'; $bad=0; Get-ChildItem -LiteralPath $t -Recurse -File | ForEach-Object { $map=@{ 'js'='\u3400'; 'html'='\u'; }; $x=[System.IO.File]::ReadAllText($_.FullName); if(($x.Contains('[/u3400-') -or $x.Contains('[/u4e00-')) -and -not $x.Contains('\u3400')){ Write-Host ('    [x] corrupted: ' + $_.Name); $bad++ } }; if($bad -gt 0){ exit 1 }; Write-Host '    payload integrity: ok'; exit 0"
if errorlevel 1 ( echo [x] web payload integrity check failed & exit /b 1 )
exit /b 0
