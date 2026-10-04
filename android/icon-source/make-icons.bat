@echo off
rem 生成 PWA 需要的 PNG 图标（用本机 Edge 渲染 assets 里的 SVG）
setlocal
set EDGE="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE% set EDGE="C:\Program Files\Microsoft\Edge\Application\msedge.exe"
set HERE=%~dp0
set FLAGS=--headless=new --no-sandbox --disable-gpu --disable-crashpad --no-first-run --hide-scrollbars --force-device-scale-factor=1

call :one icon.svg icon-192.png 192
call :one icon.svg icon-512.png 512
call :one icon-maskable.svg icon-maskable-512.png 512
echo done
exit /b 0

:one
set UDD=%TEMP%\edge-icon-%RANDOM%%RANDOM%
%EDGE% %FLAGS% --user-data-dir="%UDD%" --window-size=%3,%3 --virtual-time-budget=2500 --screenshot="%HERE%%2" "file:///%HERE:\=/%1"
exit /b 0
