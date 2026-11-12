' LinkHub 桌面版启动入口（无控制台窗口）
' 由 wscript.exe 执行，转调 launcher\launcher.ps1
Option Explicit

Dim shell, scriptDir, ps1Path, cmd
Set shell = CreateObject("WScript.Shell")

scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
ps1Path = scriptDir & "launcher\launcher.ps1"

cmd = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
shell.Run cmd, 0, False