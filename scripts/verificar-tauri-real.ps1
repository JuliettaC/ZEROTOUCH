param([int]$ProcessId)
# Solo LECTURA de ventanas de un proceso: título, estilos, rectángulo físico, DPI y cuál tiene el foco. No envía entradas.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
[void][W]::SetProcessDPIAware()
$foreground = [W]::GetForegroundWindow()
$rows = New-Object System.Collections.ArrayList
$callback = [W+EnumProc]{
  param($h, $l)
  $windowPid = 0
  [void][W]::GetWindowThreadProcessId($h, [ref]$windowPid)
  if ($windowPid -eq $ProcessId) {
    $title = New-Object System.Text.StringBuilder 256
    $class = New-Object System.Text.StringBuilder 256
    [void][W]::GetWindowText($h, $title, 256)
    [void][W]::GetClassName($h, $class, 256)
    $r = New-Object W+RECT
    [void][W]::GetWindowRect($h, [ref]$r)
    $ex = [W]::GetWindowLongPtr($h, -20).ToInt64()
    $st = [W]::GetWindowLongPtr($h, -16).ToInt64()
    $c = New-Object W+RECT
    [void][W]::GetClientRect($h, [ref]$c)
    $p = New-Object W+POINT
    [void][W]::ClientToScreen($h, [ref]$p)
    [void]$rows.Add([pscustomobject]@{
      title = $title.ToString(); class = $class.ToString(); visible = [W]::IsWindowVisible($h)
      x = $r.L; y = $r.T; width = $r.R - $r.L; height = $r.B - $r.T
      noActivate = (($ex -band 0x08000000) -ne 0); topmost = (($ex -band 0x8) -ne 0); toolWindow = (($ex -band 0x80) -ne 0); clickThrough = (($ex -band 0x20) -ne 0)
      caption = (($st -band 0x00C00000) -ne 0); styleHex = ("0x{0:X}" -f $st); exStyleHex = ("0x{0:X}" -f $ex); clientX = $p.X; clientY = $p.Y; clientWidth = $c.R - $c.L; clientHeight = $c.B - $c.T; dpi = [W]::GetDpiForWindow($h); foreground = ($h -eq $foreground)
    })
  }
  return $true
}
[void][W]::EnumWindows($callback, [IntPtr]::Zero)
$virtual = [pscustomobject]@{ left = [W]::GetSystemMetrics(76); top = [W]::GetSystemMetrics(77); width = [W]::GetSystemMetrics(78); height = [W]::GetSystemMetrics(79) }
$foregroundTitle = New-Object System.Text.StringBuilder 256
[void][W]::GetWindowText($foreground, $foregroundTitle, 256)
[pscustomobject]@{ windows = @($rows); virtualScreen = $virtual; foregroundTitle = $foregroundTitle.ToString() } | ConvertTo-Json -Depth 4 -Compress
