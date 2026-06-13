@echo off
cd /d "%~dp0"
echo Vite開発サーバーを起動中...
start "Vite Server" cmd /k "npx vite"
timeout /t 3 /nobreak >nul
echo Electronを起動中...
set NODE_ENV=development
npx electron .
