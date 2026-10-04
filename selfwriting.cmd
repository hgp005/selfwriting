@echo off
chcp 65001 >nul
title selfwriting
cd /d "%~dp0"
node launcher.js %*
if errorlevel 1 pause
