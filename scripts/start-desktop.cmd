@echo off
setlocal
cd /d "%~dp0.."

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
)

if not exist "dist\index.html" (
  echo Building web app into dist\...
  call npm run build
)

echo Starting Leap reader (desktop)...
call npm run desktop:start
