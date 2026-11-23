@echo off
setlocal
cd /d "%~dp0"
call npm.cmd --prefix desktop run build
if errorlevel 1 exit /b 1
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /reference:System.Windows.Forms.dll /out:"Harp Orchestrator.exe" desktop\Launcher.cs
exit /b %errorlevel%
