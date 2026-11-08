param(
  [Parameter(Mandatory=$true)][string]$FolderPath,
  [Parameter(Mandatory=$true)][int]$OwnerProcessId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativePickerWindow {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string className, string windowTitle);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr window, int command);
}
'@

$deadline = [DateTime]::UtcNow.AddSeconds(30)
$dialog = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $deadline) {
  $candidate = [NativePickerWindow]::FindWindow($null, 'Choose Wonderdraft user data directory')
  if ($candidate -ne [IntPtr]::Zero) {
    [uint32]$pidValue = 0
    [void][NativePickerWindow]::GetWindowThreadProcessId($candidate, [ref]$pidValue)
    if ([int]$pidValue -eq $OwnerProcessId) { $dialog = $candidate; break }
  }
  Start-Sleep -Milliseconds 100
}
if ($dialog -eq [IntPtr]::Zero) { throw 'Native folder-picker window did not appear on the interactive desktop' }

[void][NativePickerWindow]::ShowWindow($dialog, 9)
if (-not [NativePickerWindow]::SetForegroundWindow($dialog)) {
  throw 'Native folder-picker window could not become foreground'
}
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait($FolderPath)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Output 'Native Windows folder-picker keyboard path submitted.'
