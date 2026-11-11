; NSIS hook: after the files are copied, install missing prerequisites (VC++ runtime, Git for Windows,
; Claude Code) in a visible PowerShell window with installer/bootstrap.ps1 — official sources only.
!macro customInstall
  DetailPrint "Checking and installing what ${PRODUCT_NAME} needs (Visual C++ runtime · Git for Windows · Claude Code)"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& $\"$INSTDIR\resources\installer\bootstrap.ps1$\"; Start-Sleep -Seconds 4"' $0
  DetailPrint "Prerequisites done (code $0)"
!macroend
