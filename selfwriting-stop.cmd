@echo off
chcp 65001 >nul
title selfwriting - ????
cd /d "%~dp0"
node launcher.js stop
timeout /t 2 >nul
