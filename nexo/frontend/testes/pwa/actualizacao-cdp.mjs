// Teste REAL de actualização da PWA (Etapa 2): duas builds diferentes, servidas no MESMO endereço
// e abertas no MESMO perfil do navegador.
//
// 1. Constrói a versão A e a versão B (VITE_NEXO_VERSAO=teste-A / teste-B) em pastas temporárias.
// 2. Serve A em http://localhost:4176 e abre o navegador: o service worker de A fica a controlar.
// 3. Passa o MESMO endereço a servir B e recarrega: B instala-se e fica à espera; a página continua
//    em A e mostra "Há uma versão nova…". Recarregar outra vez NÃO muda de versão.
// 4. Carrega em "Actualizar agora": B é activada, a página recarrega em B, o aviso desaparece e a
//    cache de A é apagada.
//
// Uso (na pasta frontend): npm run teste:pwa-actualizacao
// Requisitos: Node.js 22.4+, Edge ou Chrome. Não usa a API nem dados reais.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'

const PORTA = 4176
const BASE = `http://localhost:${PORTA}/`
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const temp = mkdtempSync(join(tmpdir(), 'nexo-pwa-actualizacao-'))
const pastaA = join(temp, 'a')
const pastaB = join(temp, 'b')

function construir(pasta, versao) {
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', pasta, '--emptyOutDir', '--logLevel', 'error'], {
    env: { ...process.env, VITE_NEXO_VERSAO: versao },
    stdio: 'inherit',
  })
  const sw = readFileSync(join(pasta, 'sw.js'), 'utf8').match(/const VERSAO = '([^']+)'/)[1]
  return sw
}
const swA = construir(pastaA, 'teste-A')
const swB = construir(pastaB, 'teste-B')
console.log(`Builds: A (sw ${swA}), B (sw ${swB})`)

// Servidor estático mínimo, com a pasta servida trocável (o mesmo endereço para A e B).
let raiz = pastaA
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const servidor = createServer((req, res) => {
  const caminho = decodeURIComponent(new URL(req.url, BASE).pathname)
  let ficheiro = normalize(join(raiz, caminho === '/' ? 'index.html' : caminho))
  if (!ficheiro.startsWith(raiz) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(raiz, 'index.html')
  res.setHeader('Content-Type', TIPOS[extname(ficheiro)] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', /\/assets\//.test(caminho) ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.end(readFileSync(ficheiro))
})
await new Promise((r) => servidor.listen(PORTA, '127.0.0.1', r))

const navegador = [
  process.env.NEXO_NAVEGADOR,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((c) => c && existsSync(c))
if (!navegador) throw new Error('Navegador Chromium não encontrado (defina NEXO_NAVEGADOR)')
const perfil = join(temp, 'perfil')
const PORTA_CDP = 9900 + Math.floor(Math.random() * 90)
const proc = spawn(navegador, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
let alvo
for (let i = 0; i < 50 && !alvo; i++) {
  await esperar(300)
  alvo = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/list`).then((r) => r.json(), () => []).then((l) => l.find((t) => t.type === 'page'))
}
const ws = new WebSocket(alvo.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let proximo = 1
const pendentes = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m)
    pendentes.delete(m.id)
  }
})
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = proximo++
    pendentes.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const avaliar = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const estado = () =>
  avaliar(`(async () => ({
    versao: document.documentElement.dataset.nexoVersao,
    aviso: !!document.querySelector('.faixa-actualizacao'),
    controlador: !!navigator.serviceWorker.controller,
    caches: await caches.keys(),
  }))()`)
async function esperarAte(cond, ms, descricao) {
  const fim = Date.now() + ms
  let ultimo
  while (Date.now() < fim) {
    ultimo = await estado().catch(() => undefined)
    if (ultimo && cond(ultimo)) return ultimo
    await esperar(300)
  }
  throw new Error(`${descricao} (último estado: ${JSON.stringify(ultimo)})`)
}

const resultados = []
async function passo(nome, fn) {
  try {
    resultados.push({ nome, ok: true, detalhe: (await fn()) ?? '' })
  } catch (e) {
    resultados.push({ nome, ok: false, detalhe: e.message })
  }
}
const exigir = (c, m) => {
  if (!c) throw new Error(m)
}

await cdp('Page.enable')
await cdp('Page.navigate', { url: BASE })

await passo('Versão A instalada e a controlar a página', async () => {
  await avaliar(`navigator.serviceWorker.ready.then(() => true)`)
  await cdp('Page.reload')
  const e = await esperarAte((x) => x.controlador && x.versao === 'teste-A', 15000, 'A não ficou a controlar')
  exigir(!e.aviso, 'não devia haver aviso de actualização')
  exigir(e.caches.length === 1 && e.caches[0] === swA, 'cache de A: ' + e.caches.join(','))
  return `cache ${e.caches[0]}`
})

// Publicar B no mesmo endereço.
raiz = pastaB

await passo('Com B publicada: B instala-se e fica à espera; a página continua em A e mostra o aviso', async () => {
  await cdp('Page.reload')
  const e = await esperarAte((x) => x.aviso, 20000, 'o aviso de actualização não apareceu')
  exigir(e.versao === 'teste-A', 'a página devia continuar em A, está em ' + e.versao)
  const espera = await avaliar(`navigator.serviceWorker.getRegistration().then((r) => !!r.waiting)`)
  exigir(espera, 'devia existir um service worker à espera')
  exigir(e.caches.includes(swA) && e.caches.includes(swB), 'deviam existir as caches de A e de B: ' + e.caches.join(','))
})

await passo('Recarregar sem aceitar não muda de versão (a activação é escolha do utilizador)', async () => {
  await cdp('Page.reload')
  await esperar(1500)
  const e = await esperarAte((x) => x.aviso, 15000, 'o aviso devia continuar')
  exigir(e.versao === 'teste-A', 'depois de recarregar devia continuar em A, está em ' + e.versao)
})

await passo('"Actualizar agora": B é activada, a página recarrega em B, sem aviso, e a cache de A é apagada', async () => {
  await avaliar(`(() => { [...document.querySelectorAll('.faixa-actualizacao button')].find((b) => b.textContent.includes('Actualizar agora')).click(); return true })()`)
  const e = await esperarAte((x) => x.versao === 'teste-B' && !x.aviso && x.caches.length === 1, 20000, 'a versão B não ficou activa')
  exigir(e.caches[0] === swB, 'devia restar só a cache de B: ' + e.caches.join(','))
  exigir(e.controlador, 'B devia controlar a página')
  return `cache ${e.caches[0]}`
})

ws.close()
proc.kill()
servidor.close()
await esperar(500)
try {
  rmSync(temp, { recursive: true, force: true })
} catch {
  // pasta temporária; o Windows pode mantê-la bloqueada por instantes
}
for (const r of resultados) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`)
const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passos OK`)
process.exit(falhas ? 1 : 0)
