; Installer hooks - clean install, clean uninstall.
;
; NSIS uninstalls by deleting the exact list of files it installed. That
; is not enough for this app, twice over:
;
;   * The UI's filenames are CONTENT-HASHED. Upgrade from one version to
;     the next and index-DWB_9JOS.js is replaced by index-C9VsGPa6.js -
;     the old one is not in the new installer's list, so it survives the
;     next uninstall, and a directory with a file in it cannot be
;     removed. The install directory then lingers forever, one stale
;     bundle at a time.
;   * The vendored Python writes __pycache__ as it runs. Bytecode the
;     installer never shipped is bytecode the uninstaller never deletes.
;
; So the resource trees are removed WHOLESALE, after the generated
; per-file deletes have run. Everything under python\ and app\ came from
; this installer or from the app's own execution; nothing of the user's
; is in there, which is the point of keeping state in %APPDATA% (see
; api/paths.py).
;
; The same experiment that found this on three PDC-Demo apps found it
; here: install, plant markers in the state folder, uninstall, and check
; that the install directory is COMPLETELY gone and the markers are
; untouched.

!macro NSIS_HOOK_PREINSTALL
  ; Upgrading in place. Clearing the old trees first is what stops a
  ; hashed asset from a previous build living on beside the new one -
  ; dead weight that also blocks the eventual uninstall.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\python"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\provisioning"
  ; Only if empty: never take a directory the user has put something in.
  RMDir "$INSTDIR"

  ; The machine-wide hint the "Find my Content Manager courses" component
  ; wrote. It is the installer's own footprint, so it leaves with the
  ; installer - unlike the author's settings in %APPDATA%, which survive
  ; deliberately so a reinstall comes back configured.
  ;
  ; Both views: a 32-bit installer's HKLM\SOFTWARE writes are redirected
  ; into WOW6432Node, and an earlier build left its hint there.
  SetRegView 64
  DeleteRegKey HKLM "SOFTWARE\Pentaho\ContentEditor"
  DeleteRegKey /ifempty HKLM "SOFTWARE\Pentaho"
  SetRegView 32
  DeleteRegKey HKLM "SOFTWARE\Pentaho\ContentEditor"
  DeleteRegKey /ifempty HKLM "SOFTWARE\Pentaho"
  SetRegView default
!macroend
