<#
.SYNOPSIS
  Builds Vision Simulator and packs it as a zip for IIS.

.DESCRIPTION
  Runs the production build, then creates release\VisionSimulator-iis-<version>.zip with:
    site\            the built app (dist\) plus deploy\iis\web.config
    install-iis.ps1  installs or updates the app on an IIS server
    README.txt       how to install, by script or by hand
  Works in Windows PowerShell 5.1 and PowerShell 7. Run from anywhere in the repository:
    npm run package:iis
    powershell -ExecutionPolicy Bypass -File scripts\package-iis.ps1 [-CleanInstall] [-SkipBuild]

.PARAMETER CleanInstall
  Runs "npm ci" first (a clean install of the dependencies).

.PARAMETER SkipBuild
  Packs the existing dist\ without building again.
#>
param(
  [switch]$CleanInstall,
  [switch]$SkipBuild,
  [string]$OutDir = 'release'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $version = (Get-Content -Raw 'package.json' | ConvertFrom-Json).version
  $name = "VisionSimulator-iis-$version"

  if (-not $SkipBuild) {
    if ($CleanInstall) {
      Write-Host '> npm ci'
      npm ci
      if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }
    Write-Host '> npm run build'
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
  }
  if (-not (Test-Path 'dist\index.html')) { throw 'dist\index.html not found: build the app first.' }

  # Stage: <name>\site (app + web.config), install script and readme at the top.
  $out = Join-Path $root $OutDir
  $stage = Join-Path $out $name
  $zip = Join-Path $out "$name.zip"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  if (Test-Path $zip) { Remove-Item $zip -Force }
  New-Item -ItemType Directory -Path (Join-Path $stage 'site') -Force | Out-Null
  Copy-Item -Path 'dist\*' -Destination (Join-Path $stage 'site') -Recurse -Force
  Copy-Item -Path 'deploy\iis\web.config' -Destination (Join-Path $stage 'site\web.config') -Force
  Copy-Item -Path 'deploy\iis\install-iis.ps1', 'deploy\iis\README.txt' -Destination $stage -Force

  # Entries are added one by one with '/' separators: Windows PowerShell 5.1's Compress-Archive and
  # ZipFile.CreateFromDirectory write '\', which is not standard zip.
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File) {
      $entry = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally {
    $archive.Dispose()
  }
  Remove-Item $stage -Recurse -Force

  $sizeMb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host ''
  Write-Host "IIS package: $zip ($sizeMb MB)"
  Write-Host 'On the server: extract it, then run install-iis.ps1 from an elevated PowerShell (see README.txt).'
} finally {
  Pop-Location
}
