# render-tail.ps1 — Render the final 4 chunks (frames 3500-3899) of EnterpriseVideo
# in 100-frame slices to avoid Chrome OOM, then concatenate all segments.

param()

$ErrorActionPreference = 'Stop'
$base = "D:\Vasu\Accelerator\Videogenerator"
$pub  = "$base\out\localhost"
$comp = "EnterpriseVideo"

Set-Location $base

function CleanRemotionTemp {
  Get-ChildItem $env:TEMP -Filter "remotion-webpack-bundle-*" -Directory -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue
  Get-ChildItem $env:TEMP -Filter "react-motion-render*" -Directory -EA SilentlyContinue | Remove-Item -Recurse -Force -EA SilentlyContinue
}

$chunks = @(
  [PSCustomObject]@{ file = "_segment-014.mp4"; frames = "3500-3599" },
  [PSCustomObject]@{ file = "_segment-015.mp4"; frames = "3600-3699" },
  [PSCustomObject]@{ file = "_segment-016.mp4"; frames = "3700-3799" },
  [PSCustomObject]@{ file = "_segment-017.mp4"; frames = "3800-3899" }
)

foreach ($c in $chunks) {
  $outFile = Join-Path $pub $c.file
  if ((Test-Path $outFile) -and (Get-Item $outFile).Length -gt 10000) {
    Write-Host "SKIP $($c.file) (already exists)"
    continue
  }

  CleanRemotionTemp
  Write-Host ""
  Write-Host "=== Rendering $($c.file)  frames $($c.frames) ==="

  $outFwd = $outFile -replace '\\', '/'
  $pubFwd = $pub     -replace '\\', '/'

  $args = @(
    'remotion', 'render', $comp,
    "`"$outFwd`"",
    '--codec=h264',
    '--crf=23',
    "--public-dir=`"$pubFwd`"",
    '--concurrency=1',
    "--frames=$($c.frames)"
  )
  $cmd = "npx " + ($args -join ' ')
  Write-Host $cmd
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED on $($c.file)"
    exit 1
  }
  Write-Host "Done $($c.file)"
  CleanRemotionTemp
}

Write-Host ""
Write-Host "=== All tail chunks rendered. Running FFmpeg concat ==="

$segs = Get-ChildItem $pub -Filter "_segment-*.mp4" | Sort-Object Name
Write-Host "Segments to concat: $($segs.Count)"

$concatLines = $segs | ForEach-Object { "file '" + ($_.FullName -replace '\\', '/') + "'" }
$concatFile  = Join-Path $pub "_concat.txt"
[System.IO.File]::WriteAllLines($concatFile, $concatLines, [System.Text.Encoding]::ASCII)

$outVideo = Join-Path $pub "demo-video.mp4"
if (Test-Path $outVideo) { Remove-Item $outVideo }

$outFwd     = $outVideo   -replace '\\', '/'
$concatFwd  = $concatFile -replace '\\', '/'
$ffCmd = "ffmpeg -f concat -safe 0 -i `"$concatFwd`" -c copy -movflags +faststart `"$outFwd`""
Write-Host $ffCmd
cmd /c $ffCmd

if ($LASTEXITCODE -eq 0) {
  $size = [math]::Round((Get-Item $outVideo).Length / 1MB, 1)
  Write-Host ""
  Write-Host "=== SUCCESS ==="
  Write-Host "demo-video.mp4  $size MB"
  $segs | Remove-Item -Force
  Remove-Item $concatFile -Force
} else {
  Write-Host "FFmpeg concat FAILED"
  exit 1
}
