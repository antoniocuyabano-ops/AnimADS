@echo off
chcp 65001 >nul
title AnimADS
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto semnode

if exist "node_modules\sharp" goto iniciar
echo.
echo  Primeira vez: instalando o AnimADS. Isso leva alguns minutos...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
call npx playwright install chromium
if errorlevel 1 goto erro

:iniciar
node server.js --abrir
echo.
echo  O AnimADS foi encerrado.
pause
exit /b

:semnode
echo.
echo  O Node.js nao esta instalado.
echo  Vou abrir o site: baixe a versao LTS, instale e abra este arquivo de novo.
start "" https://nodejs.org/pt
pause
exit /b

:erro
echo.
echo  A instalacao falhou. Verifique a internet e tente de novo.
echo  Se continuar, envie esta janela para quem cuida do AnimADS.
pause
