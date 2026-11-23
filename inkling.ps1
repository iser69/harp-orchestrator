param([switch]$Setup, [string]$Device = 'Vulkan0', [switch]$Cpu)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.runtime'
$backend = Join-Path $runtime 'llama'
$server = Join-Path $backend 'llama-server.exe'
$weights = Join-Path $runtime 'Inkling-2-Mini-UD-IQ2_XXS.gguf'
$weightBytes = 8486236352

if ($Setup) {
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    if (!(Test-Path -LiteralPath $server)) {
        $tag = 'b12588-mix-c0c3de8'
        $archive = Join-Path $runtime 'llama.zip'
        $url = "https://github.com/unslothai/llama.cpp/releases/download/$tag/app-$tag-windows-x64-vulkan.zip"
        curl.exe --fail --location --retry 2 --output $archive $url
        if ($LASTEXITCODE -ne 0) { throw 'Не удалось скачать llama.cpp.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $backend -Force
    }
    if (!(Test-Path -LiteralPath $weights) -or (Get-Item -LiteralPath $weights).Length -ne $weightBytes) {
        $partial = "$weights.part"
        $url = 'https://huggingface.co/unsloth/Inkling-2-Mini-GGUF/resolve/main/Inkling-2-Mini-UD-IQ2_XXS.gguf?download=true'
        curl.exe --fail --location --retry 2 --continue-at - --output $partial $url
        if ($LASTEXITCODE -ne 0 -or (Get-Item -LiteralPath $partial).Length -ne $weightBytes) {
            throw 'Файл весов скачан не полностью. Повтори запуск с -Setup.'
        }
        Move-Item -LiteralPath $partial -Destination $weights -Force
    }
}

if (!(Test-Path -LiteralPath $server) -or !(Test-Path -LiteralPath $weights)) {
    throw 'Сначала выполни .\inkling.ps1 -Setup.'
}

$placement = @('--device', $Device, '--n-gpu-layers', '99', '--n-cpu-moe', '16')
if ($Cpu) { $placement = @('--device', 'none', '--n-gpu-layers', '0') }
& $server -m $weights --alias inkling-2-mini --host 127.0.0.1 --port 8001 `
    --cors-origins 'http://127.0.0.1:8001' --no-webui `
    --ctx-size 4096 --parallel 1 --jinja --reasoning off --reasoning-effort none `
    --temp 1 --top-p 1 --top-k 0 --min-p 0 @placement
exit $LASTEXITCODE
