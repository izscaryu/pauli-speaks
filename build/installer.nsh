; Pauli Speaks additions to the electron-builder NSIS uninstaller (nsis.include in package.json).
;
; electron-builder also runs the installed uninstaller during every update, and whenever a
; newer installer is run over an existing install, always silently and with --updated. So on
; ${isUpdated} nothing here may touch the user's data or the app's registration.

; Must match PROTOCOL in src/main/remote.js.
!define PAULI_PROTOCOL "pauli-speaks"

; Sets $R9 to "1" if the registry command line in $R8 starts this install's exe, else "".
; The dev checkout (`npm start`) registers the same names for electron.exe; leave those alone.
!macro pauliPointsHere
  StrCpy $R9 ""
  StrCpy $R7 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  StrLen $R6 $R7
  StrCpy $R6 $R8 $R6
  ${if} $R6 == $R7
    StrCpy $R9 "1"
  ${endIf}
!macroend

; Sets $R9 to the size in KB in $R7 as text, e.g. "2.1 GB" (GB rounded to one decimal).
!macro pauliFormatSize
  ${if} $R7 < 1024
    StrCpy $R9 "$R7 KB"
  ${elseIf} $R7 < 1048576
    IntOp $R7 $R7 / 1024
    StrCpy $R9 "$R7 MB"
  ${else}
    IntOp $R7 $R7 * 10
    IntOp $R7 $R7 + 524288
    IntOp $R7 $R7 / 1048576
    IntOp $R6 $R7 % 10
    IntOp $R7 $R7 / 10
    StrCpy $R9 "$R7.$R6 GB"
  ${endIf}
!macroend

; Sets $R9 to the size of the folder in $R8 as text.
!macro pauliFolderSize
  ${GetSize} "$R8" "/S=0K" $R7 $R6 $R5
  !insertmacro pauliFormatSize
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $R5
    Push $R6
    Push $R7
    Push $R8
    Push $R9

    ; Electron keeps app data and these registry entries per user, even for an all-users install.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}

    ; pauli-speaks:// links, registered by the app on every start.
    ReadRegStr $R8 HKCU "Software\Classes\${PAULI_PROTOCOL}\shell\open\command" ""
    !insertmacro pauliPointsHere
    ${if} $R9 == "1"
      DeleteRegKey HKCU "Software\Classes\${PAULI_PROTOCOL}"
    ${endIf}

    ; Start at login: app.setLoginItemSettings names the value after the AppUserModelId (the appId).
    ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    !insertmacro pauliPointsHere
    ${if} $R9 == "1"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"
    ${endIf}

    ; Installers downloaded by electron-updater; nothing of the user's.
    RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"

    ; Models (2-3 GB), settings, history and logs. Ask, and keep them unless the user says yes.
    ; A silent uninstall keeps them too (pass --delete-app-data to remove them).
    StrCpy $R8 "$APPDATA\${PRODUCT_NAME}"
    ${ifNot} ${Silent}
    ${andIf} ${FileExists} "$R8\*.*"
      !insertmacro pauliFolderSize
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Also delete your ${PRODUCT_NAME} data?$\n$\nThis removes the downloaded speech models, your settings, your dictation history and the logs ($R9) in:$\n$R8$\n$\nChoose No to keep them, for example if you plan to install ${PRODUCT_NAME} again." \
        /SD IDNO IDNO pauliKeepData
      ClearErrors
      RMDir /r "$R8"
      ${if} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Some files could not be deleted. You can remove this folder yourself:$\n$R8" /SD IDOK
      ${endIf}
      pauliKeepData:
    ${endIf}

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}

    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R6
    Pop $R5
  ${endIf}
!macroend
