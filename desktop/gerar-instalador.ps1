# Gera o instalador do ZapHub para Windows: compila o programa (release) e monta o instalador com o NSIS.
# Requisitos: Rust (rustup, alvo x86_64-pc-windows-msvc) e NSIS 3 (makensis.exe). Uso:
#   powershell -ExecutionPolicy Bypass -File desktop\gerar-instalador.ps1 [-Makensis C:\caminho\makensis.exe]
param([string]$Makensis = "")
$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $aqui

$versao = (Select-String -Path Cargo.toml -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
Write-Host "ZapHub $($versao) - compilando..."
cargo build --release
if ($LASTEXITCODE -ne 0) { throw "a compilacao falhou" }

if (-not $Makensis) {
    $candidatos = @(
        (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source,
        "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
        "$env:ProgramFiles\NSIS\makensis.exe",
        "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }
    $Makensis = $candidatos | Select-Object -First 1
}
if (-not $Makensis) { throw "makensis.exe nao encontrado. Instale o NSIS 3 (https://nsis.sourceforge.io) ou passe -Makensis." }

& $Makensis "/DVERSAO=$versao" "instalador\zaphub.nsi"
if ($LASTEXITCODE -ne 0) { throw "o makensis falhou" }
$saida = Join-Path $aqui "target\release\ZapHub-$versao-instalador.exe"
Write-Host "Pronto: $saida"
(Get-FileHash $saida -Algorithm SHA256).Hash | ForEach-Object { Write-Host "SHA-256: $_" }
