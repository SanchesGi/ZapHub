; ZapHub para Windows: instalador (NSIS puro, sem plugins de terceiros).
; - dois modos: para todos os usuarios (pede administrador, em Arquivos de Programas) ou so para este
;   usuario (sem administrador, em %LOCALAPPDATA%\Programs);
; - tela de aceite dos termos, detalhes da instalacao na tela e copia em instalacao.log;
; - no fim: abrir o ZapHub e/ou a pagina do projeto no GitHub.
; Gerar: desktop\gerar-instalador.ps1 (compila o programa e chama o makensis).

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!ifndef VERSAO
  !define VERSAO "0.0.0"
!endif
!define NOME "ZapHub"
!define EXE "zaphub.exe"
!define EDITOR "Ailan Sanches"
!define URL_PROJETO "https://github.com/SanchesGi/ZapHub"
!define CHAVE_DESINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZapHub"

Name "${NOME}"
OutFile "..\target\release\ZapHub-${VERSAO}-instalador.exe"
BrandingText "${NOME} ${VERSAO}"
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel user

VIProductVersion "${VERSAO}.0"
VIAddVersionKey /LANG=1046 "ProductName" "${NOME}"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do ZapHub para Windows"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSAO}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSAO}"
VIAddVersionKey /LANG=1046 "CompanyName" "${EDITOR}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "AGPL-3.0-only"

; ---- todos os usuarios x so eu ----
!define MULTIUSER_EXECUTIONLEVEL Highest
!define MULTIUSER_MUI
!define MULTIUSER_INSTALLMODE_COMMANDLINE
!define MULTIUSER_USE_PROGRAMFILES64
!define MULTIUSER_INSTALLMODE_DEFAULT_CURRENTUSER
!define MULTIUSER_INSTALLMODE_INSTDIR "${NOME}"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_KEY "${CHAVE_DESINST}"
!define MULTIUSER_INSTALLMODE_INSTDIR_REGISTRY_VALUENAME "InstallLocation"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${CHAVE_DESINST}"
!define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "ModoInstalacao"
!include "MultiUser.nsh"
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!define MUI_ICON "zaphub.ico"
!define MUI_UNICON "zaphub.ico"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Instalar o ZapHub ${VERSAO}"
!define MUI_WELCOMEPAGE_TEXT "O ZapHub para Windows conecta no servidor ZapHub da sua empresa para atender pelo WhatsApp, com notificações do Windows.$\r$\n$\r$\nVocê vai escolher se instala só para você (sem administrador) ou para todos os usuários deste computador."
!insertmacro MUI_PAGE_WELCOME
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "Li e aceito os termos de uso, privacidade e a licença"
!insertmacro MUI_PAGE_LICENSE "termos.txt"
!insertmacro MULTIUSER_PAGE_INSTALLMODE
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "ZapHub instalado"
!define MUI_FINISHPAGE_TEXT "O registro desta instalação ficou em instalacao.log, na pasta do programa.$\r$\n$\r$\nO ZapHub também fica no ícone perto do relógio e inicia junto com o Windows (dá para desligar no menu desse ícone)."
; o instalador pode estar elevado (modo todos os usuarios): abre o programa e o navegador pelo Explorer, sem herdar
; o administrador (senao o ZapHub e os arquivos abertos por ele rodariam como administrador)
!define MUI_FINISHPAGE_RUN ""
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ZapHub agora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirZapHub
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Abrir a página do projeto no GitHub"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION AbrirProjeto
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

Function AbrirZapHub
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXE}"'
FunctionEnd

Function AbrirProjeto
  Exec '"$WINDIR\explorer.exe" "${URL_PROJETO}"'
FunctionEnd

; modo todos os usuarios: so dentro de Arquivos de Programas (pasta que usuario comum nao altera)
Function .onVerifyInstDir
  StrCmp $MultiUser.InstallMode "AllUsers" 0 fim
  StrLen $1 "$PROGRAMFILES64"
  StrCpy $0 "$INSTDIR" $1
  StrCmp $0 "$PROGRAMFILES64" fim
  Abort
  fim:
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "O ZapHub para Windows precisa do Windows de 64 bits."
    Abort
  ${EndIf}
  !insertmacro MULTIUSER_INIT
FunctionEnd

Function un.onInit
  !insertmacro MULTIUSER_UNINIT
FunctionEnd

; fecha o ZapHub deste usuario (se estiver aberto) para poder trocar o arquivo
!macro FecharZapHub
  ReadEnvStr $9 USERNAME
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM ${EXE} /FI "USERNAME eq $9"'
  Pop $8
  Sleep 800
!macroend

Section "ZapHub" SecPrincipal
  SectionIn RO
  SetDetailsView show
  ${GetTime} "" "L" $1 $2 $3 $4 $5 $6 $7
  DetailPrint "ZapHub ${VERSAO}"
  DetailPrint "Modo: $MultiUser.InstallMode (AllUsers = todos os usuários; CurrentUser = só este usuário)"
  DetailPrint "Pasta: $INSTDIR"
  DetailPrint "Fechando o ZapHub, se estiver aberto..."
  !insertmacro FecharZapHub

  SetOutPath "$INSTDIR"
  DetailPrint "Copiando o programa..."
  File "..\target\release\${EXE}"
  File "termos.txt"
  WriteUninstaller "$INSTDIR\desinstalar.exe"

  DetailPrint "Criando atalhos..."
  CreateShortCut "$SMPROGRAMS\${NOME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$DESKTOP\${NOME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  DetailPrint "Registrando em Aplicativos instalados..."
  WriteRegStr SHCTX "${CHAVE_DESINST}" "DisplayName" "${NOME}"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "DisplayVersion" "${VERSAO}"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "Publisher" "${EDITOR}"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "URLInfoAbout" "${URL_PROJETO}"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "ModoInstalacao" "$MultiUser.InstallMode"
  WriteRegStr SHCTX "${CHAVE_DESINST}" "UninstallString" '"$INSTDIR\desinstalar.exe" /$MultiUser.InstallMode'
  WriteRegStr SHCTX "${CHAVE_DESINST}" "QuietUninstallString" '"$INSTDIR\desinstalar.exe" /$MultiUser.InstallMode /S'
  WriteRegDWORD SHCTX "${CHAVE_DESINST}" "NoModify" 1
  WriteRegDWORD SHCTX "${CHAVE_DESINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $8 $9
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${CHAVE_DESINST}" "EstimatedSize" "$0"

  FileOpen $0 "$INSTDIR\instalacao.log" w
  FileWrite $0 "ZapHub para Windows ${VERSAO}$\r$\n"
  FileWrite $0 "Data: $1/$2/$3 $5:$6:$7$\r$\n"
  FileWrite $0 "Modo: $MultiUser.InstallMode$\r$\n"
  FileWrite $0 "Pasta: $INSTDIR$\r$\n"
  FileWrite $0 "Atalhos: menu Iniciar e área de trabalho$\r$\n"
  FileWrite $0 "Resultado: instalação concluída$\r$\n"
  FileClose $0
  DetailPrint "Registro salvo em: $INSTDIR\instalacao.log"
  DetailPrint "Instalação concluída."
SectionEnd

Section "Uninstall"
  SetDetailsView show
  DetailPrint "Fechando o ZapHub, se estiver aberto..."
  !insertmacro FecharZapHub
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\termos.txt"
  Delete "$INSTDIR\instalacao.log"
  Delete "$INSTDIR\desinstalar.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${NOME}.lnk"
  Delete "$DESKTOP\${NOME}.lnk"
  DeleteRegKey SHCTX "${CHAVE_DESINST}"
  ; deste usuario: iniciar com o Windows e o registro das notificacoes
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ZapHub"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\ZapHub.Desktop"
  ReadEnvStr $0 APPDATA
  IfFileExists "$0\ZapHub\*.*" 0 fim
    MessageBox MB_YESNO|MB_ICONQUESTION "Apagar também o login e as preferências do ZapHub deste usuário?$\r$\n($0\ZapHub)" /SD IDNO IDNO fim
    RMDir /r "$0\ZapHub"
    DetailPrint "Login e preferências apagados."
  fim:
  DetailPrint "ZapHub removido."
SectionEnd
