@echo off
rem JedloKos - dvojklikom spusti aplikaciu a otvori ju v prehliadaci.
title JedloKos
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chyba Node.js. Nainstalujte verziu 24 alebo novsiu z https://nodejs.org a spustite tento subor znova.
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
