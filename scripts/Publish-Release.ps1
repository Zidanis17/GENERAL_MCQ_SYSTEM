param(
    [string]$ArtifactDirectory = 'release',
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Publish a stable numeric version from package.json.' }
$publisher = $manifest.build.publish
if ($publisher.provider -ne 'github' -or -not $publisher.owner -or -not $publisher.repo) { throw 'Configure a GitHub update repository before publishing.' }
$repository = "$($publisher.owner)/$($publisher.repo)"
$tag = "v$version"
$artifactRoot = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$names = @("MCQ-Studio-Setup-$version.exe", "MCQ-Studio-Portable-$version.exe", "MCQ-Studio-Setup-$version.exe.blockmap", 'latest.yml')
foreach ($name in $names) {
    $file = Get-Item -LiteralPath (Join-Path $artifactRoot $name)
    if ($file.Length -le 0) { throw "Release file is empty: $name" }
}
$metadata = Get-Content -LiteralPath (Join-Path $artifactRoot 'latest.yml') -Raw
$hasher = [Security.Cryptography.SHA512]::Create()
$installerStream = [IO.File]::OpenRead((Join-Path $artifactRoot $names[0]))
try {
    $checksum = [Convert]::ToBase64String($hasher.ComputeHash($installerStream))
} finally {
    $installerStream.Dispose()
    $hasher.Dispose()
}
if ($metadata -notmatch "(?m)^version:\s*$([regex]::Escape($version))\s*$" -or $metadata -notmatch "(?m)^path:\s*$([regex]::Escape($names[0]))\s*$" -or $metadata -notmatch "(?m)^sha512:\s*$([regex]::Escape($checksum))\s*$") {
    throw 'latest.yml does not match the release version and installer checksum.'
}

# Create exactly one draft before uploading anything. Parallel publisher tasks
# can otherwise create separate drafts for the same tag.
$existingJSON = & gh release list --repo $repository --limit 100 --json tagName
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing releases.' }
$existing = @($existingJSON | ConvertFrom-Json | Where-Object tagName -eq $tag)
if ($existing.Count -eq 0) {
    & gh release create $tag --repo $repository --draft --verify-tag --title "MCQ Studio $tag" --notes 'Offline practice and exams with automatic updates for the installed Windows edition.'
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the draft release.' }
}
foreach ($name in $names) {
    & gh release upload $tag (Join-Path $artifactRoot $name) --repo $repository --clobber
    if ($LASTEXITCODE -ne 0) { throw "Could not upload $name. The release has not been published." }
}
$remoteJSON = & gh release view $tag --repo $repository --json assets,isDraft
if ($LASTEXITCODE -ne 0) { throw 'Could not verify uploaded release files.' }
$remote = $remoteJSON | ConvertFrom-Json
foreach ($name in $names) {
    $asset = @($remote.assets | Where-Object name -eq $name)
    if ($asset.Count -ne 1 -or $asset[0].size -ne (Get-Item -LiteralPath (Join-Path $artifactRoot $name)).Length) { throw "The uploaded asset is missing or incomplete: $name" }
}
$downloadRoot = "https://github.com/$repository/releases/download/$tag"
$notes = @"
## Download MCQ Studio for Windows

- **[Download the installer (.exe)]($downloadRoot/$($names[0]))** - Recommended. Installs the app and supports automatic updates.
- **[Download the portable app (.exe)]($downloadRoot/$($names[1]))** - Run without installing. Download new versions manually.

Windows 10/11, 64-bit. Practice and exams work offline; no Node.js or development server is needed.
"@
$changelogPath = Join-Path $PSScriptRoot '../CHANGELOG.md'
if (Test-Path -LiteralPath $changelogPath) {
    $changelog = Get-Content -LiteralPath $changelogPath -Raw -Encoding UTF8
    $section = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($version))\][^\r\n]*\r?\n(.*?)(?=^## \[|\z)")
    if ($section.Success) { $notes += "`n`n## What's new`n`n" + $section.Groups[1].Value.Trim() }
}
$notesFile = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($notesFile, $notes, [Text.UTF8Encoding]::new($false))
    if ($Publish) {
        & gh release edit $tag --repo $repository --notes-file $notesFile --draft=false --latest
        if ($LASTEXITCODE -ne 0) { throw 'Could not publish the verified release.' }
        Write-Output "Published $tag with all four verified release files and executable download links."
    } else {
        & gh release edit $tag --repo $repository --notes-file $notesFile
        if ($LASTEXITCODE -ne 0) { throw 'Could not add executable download links to the draft release.' }
        Write-Output "Uploaded all four verified release files. Publish the $tag draft when ready."
    }
} finally {
    Remove-Item -LiteralPath $notesFile -Force
}
