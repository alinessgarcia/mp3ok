@echo off
setlocal

set ROOT=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\start-local.ps1"

endlocal
