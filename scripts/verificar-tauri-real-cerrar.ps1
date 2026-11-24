param([int]$ProcessId, [string]$Title = "ZEROTOUCH")
# Envía WM_CLOSE (equivale al botón de cerrar) SOLO a la ventana con ese título del proceso indicado.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class C {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
$sent = 0
$callback = [C+EnumProc]{
  param($h, $l)
  $windowPid = 0
  [void][C]::GetWindowThreadProcessId($h, [ref]$windowPid)
  if ($windowPid -eq $ProcessId) {
    $text = New-Object System.Text.StringBuilder 256
    [void][C]::GetWindowText($h, $text, 256)
    if ($text.ToString() -eq $Title) { [void][C]::PostMessage($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero); $script:sent++ }
  }
  return $true
}
[void][C]::EnumWindows($callback, [IntPtr]::Zero)
"WM_CLOSE enviado a $sent ventana(s) '$Title'"
