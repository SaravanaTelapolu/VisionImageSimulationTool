Vision Simulator - IIS package
==============================

Contents
  site\             The app: static files plus web.config (MIME types and cache rules).
  install-iis.ps1   Installs or updates the app on this IIS server.
  README.txt        This file.

The app is plain static files: no .NET, no database, no URL Rewrite module.
Everything runs in the user's browser; the server only hands out files.

Requirements
  - Windows with IIS and its "Static Content" feature
    (Windows Features > Internet Information Services > World Wide Web Services >
     Common HTTP Features > Static Content).
  - HTTPS for real use: installing the app and working offline only work over
    HTTPS (or on localhost). Use a certificate from your internal CA, or a free
    one (for example with win-acme).

Option A - install with the script (elevated Windows PowerShell)
  1. Extract the zip, for example to C:\Temp\VisionSimulator-iis.
  2. Open Windows PowerShell as Administrator in that folder.
  3. Allow the script for this session only:
       Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  4. Preview what it will do (changes nothing; still needs Administrator, because
     only administrators can read the IIS settings):
       .\install-iis.ps1 -WhatIf
  5. Install one of these ways:
       New website on port 8080 (http://localhost:8080/):
         .\install-iis.ps1
       Under an existing website (http://localhost/VisionSim/):
         .\install-iis.ps1 -ParentSite "Default Web Site" -AppPath /VisionSim
       Website with HTTPS (certificate in LocalMachine\My):
         .\install-iis.ps1 -HostName vision.example.org -Port 80 -CertificateThumbprint <thumbprint>
     Other options: -SiteName, -PhysicalPath (default C:\inetpub\VisionSimulator),
     -AppPoolName, -HttpsPort. Run "Get-Help .\install-iis.ps1 -Full" for details.

Option B - by hand in IIS Manager
  1. Copy everything inside "site" to a folder, e.g. C:\inetpub\VisionSimulator.
  2. Application Pools > Add Application Pool: .NET CLR version "No Managed Code".
  3. Sites > Add Website (or right-click a site > Add Application), physical path =
     that folder, application pool = the one from step 2.
  4. Add an https binding with your certificate.

Updating to a new version
  Run install-iis.ps1 again with the same options (or copy the new "site" files
  over the old ones). Open copies of the app offer to reload with the new version.

My own approximation - not a clinical measurement.
