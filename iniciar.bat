@echo off
echo ========================================
echo  DGCICD - Servidor de Presupuesto
echo  EF 2026 - Backend Node.js
echo ========================================
echo.
echo Iniciando servidor...
echo.
cd /d "%~dp0backend"
node server.js
echo.
pause