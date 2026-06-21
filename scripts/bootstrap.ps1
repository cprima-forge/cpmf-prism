#Requires -Version 7
<# Bootstrap repo dependencies — safe to run repeatedly. #>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot | Split-Path

Push-Location $root

# Python tooling
Write-Host 'uv sync ...'
uv sync

# Node: vsce + eslint + markdownlint-cli2
if (-not (Test-Path 'node_modules/@vscode/vsce') -or
    -not (Test-Path 'node_modules/eslint') -or
    -not (Test-Path 'node_modules/markdownlint-cli2')) {
    Write-Host 'npm install ...'
    npm install
} else {
    Write-Host 'node_modules up to date, skipping npm install'
}

Pop-Location

Write-Host 'Bootstrap complete.'
