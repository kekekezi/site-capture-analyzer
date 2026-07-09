Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Icon {
  param(
    [int]$Size,
    [string]$State,
    [string]$FileName
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 128.0
  function S([double]$v) { return [float]($v * $scale) }

  $rect = New-Object System.Drawing.RectangleF (S 8), (S 8), (S 112), (S 112)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $radius = S 28
  $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
  $path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
  $path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
  $path.CloseFigure()

  $bg2 = if ($State -eq "recording") { [System.Drawing.Color]::FromArgb(255, 52, 10, 20) } else { [System.Drawing.Color]::FromArgb(255, 18, 32, 48) }
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 3, 9, 18)), $bg2, 45
  $g.FillPath($bg, $path)
  $border = if ($State -eq "recording") { [System.Drawing.Color]::FromArgb(230, 255, 83, 98) } else { [System.Drawing.Color]::FromArgb(220, 31, 240, 225) }
  $borderPen = New-Object System.Drawing.Pen $border, (S 4)
  $g.DrawPath($borderPen, $path)

  $cyan = if ($State -eq "recording") { [System.Drawing.Color]::FromArgb(255, 255, 108, 120) } else { [System.Drawing.Color]::FromArgb(255, 24, 245, 226) }
  $blue = if ($State -eq "recording") { [System.Drawing.Color]::FromArgb(255, 255, 198, 87) } else { [System.Drawing.Color]::FromArgb(255, 114, 200, 255) }
  $amber = if ($State -eq "recording") { [System.Drawing.Color]::FromArgb(255, 255, 51, 72) } else { [System.Drawing.Color]::FromArgb(255, 255, 208, 88) }

  $penCyan = New-Object System.Drawing.Pen $cyan, (S 6)
  $penCyan.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penCyan.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penBlue = New-Object System.Drawing.Pen $blue, (S 3)

  $g.DrawLine($penCyan, (S 28), (S 37), (S 28), (S 24))
  $g.DrawLine($penCyan, (S 28), (S 24), (S 45), (S 24))
  $g.DrawLine($penCyan, (S 100), (S 37), (S 100), (S 24))
  $g.DrawLine($penCyan, (S 100), (S 24), (S 83), (S 24))
  $g.DrawLine($penCyan, (S 28), (S 91), (S 28), (S 104))
  $g.DrawLine($penCyan, (S 28), (S 104), (S 45), (S 104))
  $g.DrawLine($penCyan, (S 100), (S 91), (S 100), (S 104))
  $g.DrawLine($penCyan, (S 100), (S 104), (S 83), (S 104))

  if ($State -eq "recording") {
    $glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 51, 72))
    $g.FillEllipse($glow, (S 33), (S 33), (S 62), (S 62))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $amber), (S 43), (S 43), (S 42), (S 42))
    $g.DrawEllipse((New-Object System.Drawing.Pen $blue, (S 5)), (S 36), (S 36), (S 56), (S 56))
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 245, 225))), (S 56), (S 56), (S 16), (S 16))
  } else {
    $g.DrawEllipse($penBlue, (S 41), (S 41), (S 46), (S 46))
    $g.DrawLine($penBlue, (S 64), (S 38), (S 64), (S 90))
    $g.DrawLine($penBlue, (S 38), (S 64), (S 90), (S 64))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $amber), (S 57), (S 57), (S 14), (S 14))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(210, 24, 245, 226))), (S 80), (S 45), (S 9), (S 9))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(210, 114, 200, 255))), (S 39), (S 76), (S 8), (S 8))
  }

  $bmp.Save((Join-Path $outDir $FileName), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

16, 32, 48, 128 | ForEach-Object {
  New-Icon -Size $_ -State "idle" -FileName "icon-$_.png"
  New-Icon -Size $_ -State "idle" -FileName "icon-idle-$_.png"
  New-Icon -Size $_ -State "recording" -FileName "icon-recording-$_.png"
}
