param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$OutputAssembly)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $OutputAssembly){ throw 'media_assembly_exists' }
Add-Type -Path $Source -ReferencedAssemblies System.Drawing -OutputAssembly $OutputAssembly -OutputType Library
if(!(Test-Path -LiteralPath $OutputAssembly)){ throw 'media_assembly_missing' }
