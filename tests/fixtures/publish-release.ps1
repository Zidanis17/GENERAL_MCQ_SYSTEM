param([string]$Workspace, [string]$PublisherScript, [string]$Journal, [switch]$OmitMetadata)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Workspace
$global:TestReleaseJournal = $Journal
$global:TestOmitMetadata = $OmitMetadata
function global:gh {
    Add-Content -LiteralPath $global:TestReleaseJournal -Value ($args -join '|')
    $global:LASTEXITCODE = 0
    if ($args[1] -eq 'list') { return '[]' }
    if ($args[1] -eq 'view') {
        $assets = @(Get-ChildItem -LiteralPath 'release' -File | Where-Object { -not ($global:TestOmitMetadata -and $_.Name -eq 'latest.yml') } | ForEach-Object { @{ name=$_.Name; size=$_.Length } })
        return (@{ isDraft=$true; assets=$assets } | ConvertTo-Json -Depth 4 -Compress)
    }
}
try { & $PublisherScript -Publish } catch { Write-Output $_.Exception.Message; exit 1 }
