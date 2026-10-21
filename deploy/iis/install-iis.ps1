<#
.SYNOPSIS
  Installs or updates Vision Simulator on this IIS server.

.DESCRIPTION
  Copies the files in .\site to the target folder, creates an application pool with no .NET
  ("No Managed Code"), and creates a website (or an application under an existing website).
  Running it again updates the files and leaves the IIS settings as they are.
  Run from an elevated (Administrator) Windows PowerShell, in the folder this zip was extracted to.
  Use -WhatIf to see what it would do without changing anything (also needs Administrator,
  because IIS settings can only be read by administrators).

.EXAMPLE
  .\install-iis.ps1
  New website "VisionSimulator" on http://localhost:8080/, files in C:\inetpub\VisionSimulator.

.EXAMPLE
  .\install-iis.ps1 -ParentSite "Default Web Site" -AppPath /VisionSim
  Application under an existing site: http://localhost/VisionSim/

.EXAMPLE
  .\install-iis.ps1 -HostName vision.example.org -Port 80 -CertificateThumbprint 0123ABCD...
  Website with an HTTP and an HTTPS (443) binding, using a certificate from LocalMachine\My.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$SiteName = 'VisionSimulator',
  [string]$PhysicalPath = 'C:\inetpub\VisionSimulator',
  [string]$AppPoolName = 'VisionSimulator',
  [int]$Port = 8080,
  [string]$HostName = '',
  # Install as an application under this existing site instead of creating a new site.
  [string]$ParentSite = '',
  [string]$AppPath = '/VisionSim',
  # Thumbprint of a certificate in LocalMachine\My: adds an HTTPS binding (needed for install/offline use).
  [string]$CertificateThumbprint = '',
  [int]$HttpsPort = 443
)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'site'
if (-not (Test-Path (Join-Path $source 'index.html'))) {
  throw "Cannot find $source\index.html. Run this script from the extracted package folder."
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Please run this script from an elevated (Run as Administrator) PowerShell; IIS settings are only readable by administrators.'
}

$mwa = Join-Path $env:windir 'System32\inetsrv\Microsoft.Web.Administration.dll'
if (-not (Test-Path $mwa)) {
  throw 'IIS is not installed. Turn on "Internet Information Services" (with Static Content) in Windows Features first.'
}
Add-Type -Path $mwa

# 1. Files: replace the folder's contents (old builds leave hashed files behind otherwise).
if ($PSCmdlet.ShouldProcess($PhysicalPath, 'Copy site files')) {
  if (Test-Path $PhysicalPath) {
    Get-ChildItem -LiteralPath $PhysicalPath -Force | Remove-Item -Recurse -Force
  } else {
    New-Item -ItemType Directory -Path $PhysicalPath | Out-Null
  }
  Copy-Item -Path (Join-Path $source '*') -Destination $PhysicalPath -Recurse -Force
  Write-Host "Copied site files to $PhysicalPath"
}

$sm = New-Object Microsoft.Web.Administration.ServerManager
if ($null -eq $sm.ApplicationPools -or $null -eq $sm.Sites) {
  throw 'Cannot read the IIS settings (applicationHost.config). Run as Administrator.'
}
$changed = $false

# 2. Application pool: static files only, so no .NET runtime.
$pool = $sm.ApplicationPools[$AppPoolName]
if (-not $pool) {
  if ($PSCmdlet.ShouldProcess($AppPoolName, 'Create application pool (No Managed Code)')) {
    $pool = $sm.ApplicationPools.Add($AppPoolName)
    $pool.ManagedRuntimeVersion = ''
    $changed = $true
  }
}

# 3. Website, or an application under an existing website.
if ($ParentSite) {
  $site = $sm.Sites[$ParentSite]
  if (-not $site) { throw "Website '$ParentSite' was not found." }
  if (-not $AppPath.StartsWith('/')) { $AppPath = "/$AppPath" }
  $app = $site.Applications[$AppPath]
  if (-not $app) {
    if ($PSCmdlet.ShouldProcess("$ParentSite$AppPath", 'Create application')) {
      $app = $site.Applications.Add($AppPath, $PhysicalPath)
      $app.ApplicationPoolName = $AppPoolName
      $changed = $true
    }
  }
  $url = "http://localhost$AppPath/"
} else {
  $site = $sm.Sites[$SiteName]
  if (-not $site) {
    if ($PSCmdlet.ShouldProcess($SiteName, "Create website on port $Port")) {
      $site = $sm.Sites.Add($SiteName, 'http', "*:${Port}:$HostName", $PhysicalPath)
      $site.Applications['/'].ApplicationPoolName = $AppPoolName
      $changed = $true
    }
  }
  if ($site -and $CertificateThumbprint) {
    $info = "*:${HttpsPort}:$HostName"
    if (-not ($site.Bindings | Where-Object { $_.Protocol -eq 'https' -and $_.BindingInformation -eq $info })) {
      if ($PSCmdlet.ShouldProcess($SiteName, "Add HTTPS binding $info")) {
        $thumb = $CertificateThumbprint -replace '[^0-9A-Fa-f]', ''
        $hash = [byte[]]::new($thumb.Length / 2)
        for ($i = 0; $i -lt $hash.Length; $i++) { $hash[$i] = [Convert]::ToByte($thumb.Substring($i * 2, 2), 16) }
        $binding = $site.Bindings.Add($info, $hash, 'My')
        if ($HostName) { $binding.SslFlags = [Microsoft.Web.Administration.SslFlags]::Sni }
        $changed = $true
      }
    }
  }
  $hostPart = if ($HostName) { $HostName } else { 'localhost' }
  $url = if ($CertificateThumbprint) { "https://${hostPart}:$HttpsPort/" } else { "http://${hostPart}:$Port/" }
}

if ($changed) {
  $sm.CommitChanges()
  Write-Host 'IIS settings saved.'
} else {
  Write-Host 'IIS settings unchanged (site, application and pool already exist, or -WhatIf).'
}
Write-Host "Vision Simulator: $url"
Write-Host 'Note: installing the app and offline use need HTTPS (or localhost).'
