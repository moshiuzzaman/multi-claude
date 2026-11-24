; Extra uninstall steps for the Windows installer (electron-builder nsis.include).
;
; "Start Multi-Claude when Windows starts" writes a Run entry named after the
; app's AppUserModelId (main.js, loginItem). Uninstalling takes it out, so an
; uninstalled Multi-Claude never tries to start at sign-in. An update also runs
; the old uninstaller; it is skipped then, so the setting survives updates.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.multiclaude.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "dev.multiclaude.app"
  ${endIf}
!macroend
