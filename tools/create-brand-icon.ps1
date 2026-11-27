$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'assets\brand'
New-Item -ItemType Directory -Force $out | Out-Null
$svg = @'
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect x="16" y="16" width="480" height="480" rx="106" fill="#002537"/>
<path d="M256 86 404 170 404 342 256 426 108 342 108 170Z" fill="#08658c"/>
<path d="M256 86 404 170 256 256 108 170Z" fill="#ffb900"/>
<path d="M108 170 256 256 256 426 108 342Z" fill="#003d56"/>
<path d="M108 170 256 86 404 170 404 342 256 426 108 342Z M108 170 256 256 404 170 M256 256 256 426" fill="none" stroke="#ffb900" stroke-width="16" stroke-linejoin="round"/>
<path d="M300 300 359 266 M300 344 338 322" fill="none" stroke="#ffb900" stroke-width="17" stroke-linecap="square"/>
</svg>
'@
[IO.File]::WriteAllText((Join-Path $out 'form-night.svg'),$svg,[Text.UTF8Encoding]::new($false))
$bitmap = [Drawing.Bitmap]::new(1024,1024)
$g = [Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.ScaleTransform(2,2)
$g.Clear([Drawing.Color]::Transparent)
function Brush($hex) { [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($hex)) }
function Polygon($coords,$hex) {
  $points = [Drawing.PointF[]]@($(for($i=0;$i -lt $coords.Length;$i+=2){[Drawing.PointF]::new($coords[$i],$coords[$i+1])}))
  $b = Brush $hex
  $g.FillPolygon($b,$points)
  $b.Dispose()
}
$bg = Brush '#002537'
$p = [Drawing.Drawing2D.GraphicsPath]::new()
$p.AddArc(16,16,212,212,180,90);$p.AddArc(284,16,212,212,270,90)
$p.AddArc(284,284,212,212,0,90);$p.AddArc(16,284,212,212,90,90);$p.CloseFigure()
$g.FillPath($bg,$p)
Polygon @(256,86,404,170,404,342,256,426,108,342,108,170) '#08658c'
Polygon @(256,86,404,170,256,256,108,170) '#ffb900'
Polygon @(108,170,256,256,256,426,108,342) '#003d56'
$pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#ffb900'),16)
$pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
$g.DrawPolygon($pen,[Drawing.PointF[]]@([Drawing.PointF]::new(108,170),[Drawing.PointF]::new(256,86),[Drawing.PointF]::new(404,170),[Drawing.PointF]::new(404,342),[Drawing.PointF]::new(256,426),[Drawing.PointF]::new(108,342)))
$g.DrawLines($pen,[Drawing.PointF[]]@([Drawing.PointF]::new(108,170),[Drawing.PointF]::new(256,256),[Drawing.PointF]::new(404,170)))
$g.DrawLine($pen,256,256,256,426)
$g.DrawLine($pen,300,300,359,266);$g.DrawLine($pen,300,344,338,322)
$bitmap.Save((Join-Path $out 'form-night.png'),[Drawing.Imaging.ImageFormat]::Png)
$frames = @()
foreach($size in @(16,24,32,48,64,128,256)) {
  $small = [Drawing.Bitmap]::new($size,$size)
  $sg = [Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.DrawImage($bitmap,0,0,$size,$size)
  $ms = [IO.MemoryStream]::new();$small.Save($ms,[Drawing.Imaging.ImageFormat]::Png)
  $frames += @{Size=$size;Bytes=$ms.ToArray()}
  $sg.Dispose();$small.Dispose();$ms.Dispose()
}
$stream = [IO.File]::Create((Join-Path $out 'form-night.ico'))
$writer = [IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$frames.Count)
$offset = 6+16*$frames.Count
foreach($frame in $frames){
  $dim = if($frame.Size -eq 256){0}else{$frame.Size}
  $writer.Write([byte]$dim);$writer.Write([byte]$dim);$writer.Write([byte]0);$writer.Write([byte]0)
  $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$frame.Bytes.Length);$writer.Write([uint32]$offset)
  $offset += $frame.Bytes.Length
}
foreach($frame in $frames){$writer.Write([byte[]]$frame.Bytes)}
$writer.Dispose();$stream.Dispose();$g.Dispose();$bitmap.Dispose();$bg.Dispose();$p.Dispose();$pen.Dispose()
Write-Output "Created SVG, PNG and 7-size ICO in $out"
