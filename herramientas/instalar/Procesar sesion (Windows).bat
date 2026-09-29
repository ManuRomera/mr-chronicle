@echo off
rem MR Chronicle - procesa una sesion (doble clic, o arrastra la carpeta encima de este archivo)
chcp 65001 >nul
set "NODE=%USERPROFILE%\.cache\mr-chronicle\bin\node\node.exe"
if not exist "%NODE%" set "NODE=node"
set "CARPETA=%~1"
if "%CARPETA%"=="" set /p "CARPETA=Arrastra aqui la carpeta de la sesion y pulsa Intro: "
set "CARPETA=%CARPETA:"=%"
"%NODE%" "%~dp0..\post\mr-chronicle-post.mjs" "%CARPETA%"
pause
