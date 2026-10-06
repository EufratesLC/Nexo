<#
  Nexo — arranque numa pasta limpa (Etapa 2).

  Simula o que outro programador faria a partir do repositório, seguindo docs/Nexo_Ambientes.md:
  1. copia para uma pasta nova SÓ os ficheiros do repositório (git ls-files: incluídos e não
     ignorados). Não copia node_modules, dist, .env, .env.local nem certificados;
  2. instala as dependências com "npm ci" (exactamente o package-lock.json);
  3. cria uma configuração NOVA a partir dos .env.example (portas próprias, sem base de dados);
  4. corre lint, tipos, builds e testes;
  5. arranca a API e a web e corre o teste do fluxo no navegador;
  6. com -ComBase: confirma a base nexo-dev (estado, verificação, test:base) com as ligações que
     estiverem na SESSÃO do terminal (nunca escritas em ficheiros). Não aplica migrações nem apaga nada.

  NÃO prova o critério do roteiro "outro programador consegue…": corre no mesmo computador, com o
  mesmo Node, a mesma cache do npm e o mesmo navegador. É uma verificação prévia.

  Uso (PowerShell, na pasta nexo):
    powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1
    powershell -ExecutionPolicy Bypass -File scripts\arranque-limpo.ps1 -ComBase
#>
param(
  # Por omissão na pasta do utilizador (caminho longo, com espaços). O %TEMP% pode ter um nome curto
  # (8.3, ex.: X1CARB~1) que o servidor do Vite recusa servir (HTTP 403).
  [string]$Destino = (Join-Path $env:USERPROFILE ('nexo-arranque-limpo-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
  [int]$PortaApi = 3101,
  [int]$PortaWeb = 5273,
  [switch]$ComBase,
  [switch]$SemNavegador
)

$ErrorActionPreference = 'Stop'
$origem = Split-Path -Parent $PSScriptRoot          # pasta nexo
$resultados = New-Object System.Collections.Generic.List[object]

function Registar([string]$passo, [bool]$ok, [string]$detalhe = '') {
  $resultados.Add([pscustomobject]@{ Passo = $passo; Resultado = $(if ($ok) { 'OK' } else { 'FALHOU' }); Detalhe = $detalhe })
  $cor = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("{0,-7} {1} {2}" -f $(if ($ok) { 'OK' } else { 'FALHOU' }), $passo, $detalhe) -ForegroundColor $cor
}

function Correr([string]$passo, [string]$pasta, [string]$comando) {
  Push-Location $pasta
  try {
    $saida = cmd /c "$comando 2>&1"
    $ok = ($LASTEXITCODE -eq 0)
    $ultima = ($saida | Where-Object { $_ -match '\S' } | Select-Object -Last 1)
    Registar $passo $ok $ultima
    if (-not $ok) { $saida | Select-Object -Last 25 | ForEach-Object { Write-Host "    $_" } }
    return $ok
  } finally { Pop-Location }
}

function EsperarUrl([string]$url, [int]$segundos) {
  $fim = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fim) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; return $r } catch { Start-Sleep -Milliseconds 500 }
  }
  return $null
}

Write-Host "Origem:  $origem"
Write-Host "Destino: $Destino"
Write-Host ("Node {0}, npm {1}" -f (node -v), (npm -v))

# 1. Cópia só dos ficheiros do repositório
$raizGit = (git -C $origem rev-parse --show-toplevel).Trim()
$prefixo = (git -C $origem rev-parse --show-prefix).Trim()
$ficheiros = git -C $raizGit ls-files --cached --others --exclude-standard -- $prefixo
New-Item -ItemType Directory -Force $Destino | Out-Null
$copiados = 0
foreach ($f in $ficheiros) {
  if (-not (Test-Path (Join-Path $raizGit $f))) { continue }   # apagado no disco, ainda no índice
  $relativo = $f.Substring($prefixo.Length)
  $alvo = Join-Path $Destino $relativo
  New-Item -ItemType Directory -Force (Split-Path -Parent $alvo) | Out-Null
  Copy-Item -LiteralPath (Join-Path $raizGit $f) -Destination $alvo
  $copiados++
}
$proibidos = Get-ChildItem -Recurse -Force $Destino | Where-Object {
  $_.FullName -match '\\node_modules\\|\\dist\\' -or
  ($_.Name -match '^\.env' -and $_.Name -notmatch '\.example$') -or
  $_.Extension -in '.pem', '.key', '.crt', '.p12'
}
Registar 'Cópia sem node_modules, dist, .env nem certificados' ($null -eq $proibidos) "$copiados ficheiros"
if ($proibidos) { $proibidos | ForEach-Object { Write-Host "    proibido: $($_.FullName)" }; exit 1 }

# 2. Dependências pelo lockfile
$okFront = Correr 'npm ci (frontend)' (Join-Path $Destino 'frontend') 'npm ci --no-audit --no-fund'
$okBack = Correr 'npm ci (backend)' (Join-Path $Destino 'backend') 'npm ci --no-audit --no-fund'
if (-not ($okFront -and $okBack)) { exit 1 }

# 3. Configuração nova a partir dos exemplos (sem base de dados, portas próprias)
$envBack = Join-Path $Destino 'backend\.env'
(Get-Content (Join-Path $Destino 'backend\.env.example')) `
  -replace '^PORT=.*', "PORT=$PortaApi" `
  -replace '^CORS_ORIGENS=.*', "CORS_ORIGENS=http://localhost:$PortaWeb" | Set-Content -Encoding utf8 $envBack
$envFront = Join-Path $Destino 'frontend\.env.local'
(Get-Content (Join-Path $Destino 'frontend\.env.example')) `
  -replace '^NEXO_API_PROXY=.*', "NEXO_API_PROXY=http://localhost:$PortaApi" | Set-Content -Encoding utf8 $envFront
Registar 'Configuração nova a partir dos .env.example' $true "API $PortaApi, web $PortaWeb, sem DATABASE_URL"

# 4. Verificações
$back = Join-Path $Destino 'backend'
$front = Join-Path $Destino 'frontend'
Correr 'Backend: lint' $back 'npm run lint' | Out-Null
Correr 'Backend: tipos' $back 'npm run typecheck' | Out-Null
Correr 'Backend: build' $back 'npm run build' | Out-Null
Correr 'Backend: testes' $back 'npm test' | Out-Null
Correr 'Frontend: lint' $front 'npm run lint' | Out-Null
Correr 'Frontend: build' $front 'npm run build' | Out-Null

# 5. Arranque da API e da web
$api = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx tsx src/server.ts' -WorkingDirectory $back -WindowStyle Hidden -PassThru
$web = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npx vite --port $PortaWeb --strictPort" -WorkingDirectory $front -WindowStyle Hidden -PassThru
try {
  $saude = EsperarUrl "http://localhost:$PortaApi/api/v1/saude" 40
  Registar 'API: /api/v1/saude' ($null -ne $saude -and $saude.Content -match '"estado":"ok"') $(if ($saude) { $saude.Content } else { 'sem resposta' })
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$PortaApi/api/v1/saude/base" -TimeoutSec 15 | Out-Null; $base = 'ok' }
  catch { $base = $_.ErrorDetails.Message }
  $esperadoBase = if ($ComBase) { 'ok' } else { 'nao_configurada' }
  Registar "API: /api/v1/saude/base ($esperadoBase esperado)" ($base -match $esperadoBase) $base
  $webOk = EsperarUrl "http://localhost:$PortaWeb/" 40
  Registar 'Web: página inicial' ($null -ne $webOk) "http://localhost:$PortaWeb/"
  if (-not $SemNavegador) {
    Correr 'Teste do fluxo no navegador' $front "node testes/fluxo/fluxo-cdp.mjs --base http://localhost:$PortaWeb/" | Out-Null
  }
} finally {
  foreach ($p in @($api, $web)) {
    if ($p -and -not $p.HasExited) { taskkill /PID $p.Id /T /F | Out-Null }
  }
}

# 6. Base de dados nexo-dev (opcional; ligações só na sessão do terminal)
if ($ComBase) {
  foreach ($v in 'DATABASE_ADMIN_URL', 'DB_CA_CERT_FICHEIRO', 'NEXO_TESTE_API_URL', 'NEXO_TESTE_ADMIN_URL', 'NEXO_TESTE_CONFIRMO') {
    if (-not (Test-Path "Env:$v")) { Registar "Variável $v na sessão" $false 'em falta'; exit 1 }
  }
  Correr 'Base: estado das migrações' $back 'npx tsx src/base/migracoes/cli.ts estado' | Out-Null
  Correr 'Base: verificação do catálogo' $back 'npx tsx src/base/migracoes/cli.ts verificar' | Out-Null
  Correr 'Base: test:base' $back 'npm run test:base' | Out-Null
}

Write-Host ''
$resultados | Format-Table -AutoSize -Wrap
$falhas = @($resultados | Where-Object { $_.Resultado -ne 'OK' }).Count
Write-Host ("{0}/{1} passos OK. Pasta: {2}" -f ($resultados.Count - $falhas), $resultados.Count, $Destino)
Write-Host 'A pasta fica para inspecção; apague-a quando quiser (não contém segredos).'
if ($falhas) { exit 1 }
