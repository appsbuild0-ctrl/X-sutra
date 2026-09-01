@echo off
setlocal
set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

if not exist "node_modules" (
  call npm ci
)
call npm run build
call npx cap sync android

cd /d "%ROOT_DIR%android"
call gradlew.bat %*
