// Teste automático da preparação da PWA (Etapa 2), pelo Chrome DevTools Protocol.
//
// 1. Serve a build de produção (vite preview, porta 4174) — corra antes "npm run build".
// 2. Abre Edge/Chrome sem interface com um perfil temporário.
// 3. Verifica: manifesto, service worker activo, cache só com a aplicação (nunca /api/).
// 4. DESLIGA o servidor e recarrega: a aplicação tem de abrir a partir da cache.
//
// Uso: npm run teste:pwa   (ou: node testes/pwa/pwa-cdp.mjs [--navegador <caminho>])
// Não testa: a instalação no telemóvel, o aviso de actualização com uma versão nova real,
// nem vendas offline (Etapa 7).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORTA_APP = 4174
const BASE = `http://localhost:${PORTA_APP}/`
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

function navegador() {
  const i = process.argv.indexOf('--navegador')
  if (i !== -1) return process.argv[i + 1]
  if (process.env.NEXO_NAVEGADOR) return process.env.NEXO_NAVEGADOR
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((c) => existsSync(c))
}

if (!existsSync('dist/index.html') || !existsSync('dist/sw.js')) {
  console.error('Falta a build. Corra primeiro: npm run build')
  process.exit(2)
}

// Servidor de pré-visualização da build (sem proxy activo: a API não é necessária).
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORTA_APP), '--strictPort'], { stdio: 'ignore' })
let pronto = false
for (let i = 0; i < 40 && !pronto; i++) {
  await esperar(250)
  pronto = await fetch(BASE).then((r) => r.ok, () => false)
}
if (!pronto) {
  preview.kill()
  throw new Error('vite preview não arrancou')
}

const caminhoNavegador = navegador()
if (!caminhoNavegador) throw new Error('Navegador Chromium não encontrado (use --navegador)')
const perfil = mkdtempSync(join(tmpdir(), 'nexo-pwa-perfil-'))
const PORTA_CDP = 9800 + Math.floor(Math.random() * 100)
const proc = spawn(caminhoNavegador, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
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
await esperar(2500)

await passo('Manifesto ligado e válido', async () => {
  const m = await avaliar(`fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json())`)
  exigir(m.name === 'Nexo' && m.start_url === '/' && m.display === 'standalone' && m.icons?.length, 'manifesto incompleto')
})

await passo('Service worker registado e activo', async () => {
  const estado = await avaliar(`navigator.serviceWorker.ready.then((r) => r.active && r.active.state)`)
  exigir(estado === 'activated', 'estado do service worker: ' + estado)
})

await passo('Depois de recarregar, a página é controlada pelo service worker', async () => {
  await cdp('Page.reload')
  await esperar(2000)
  exigir(await avaliar(`navigator.serviceWorker.controller !== null`), 'a página não está controlada')
})

await passo('A cache tem a aplicação (index.html e /assets/) e nenhum pedido à API', async () => {
  const chaves = await avaliar(`(async () => {
    const nomes = await caches.keys()
    const urls = []
    for (const n of nomes) for (const p of await (await caches.open(n)).keys()) urls.push(new URL(p.url).pathname)
    return { nomes, urls }
  })()`)
  exigir(chaves.nomes.length === 1 && /^nexo-app-[0-9a-f]{12}$/.test(chaves.nomes[0]), 'caches: ' + chaves.nomes.join(','))
  exigir(chaves.urls.includes('/index.html'), 'falta /index.html')
  exigir(chaves.urls.some((u) => u.startsWith('/assets/') && u.endsWith('.js')), 'falta o JavaScript da aplicação')
  exigir(!chaves.urls.some((u) => u.startsWith('/api/')), 'a cache não pode ter pedidos à API')
  return `${chaves.urls.length} ficheiros na cache`
})

// Desligar o servidor: a partir daqui não há rede para a aplicação.
preview.kill()
await esperar(800)

await passo('Sem servidor, a aplicação abre a partir da cache (protótipo em modo de demonstração)', async () => {
  exigir(!(await fetch(BASE).then(() => true, () => false)), 'o servidor ainda responde')
  await cdp('Page.reload')
  await esperar(2500)
  const texto = await avaliar(`document.body.innerText`)
  exigir(texto.includes('Login demonstrativo') || texto.includes('Protótipo com dados fictícios'), 'a aplicação não abriu sem rede')
})

await passo('Sem servidor, pedidos à API falham (não vêm da cache)', async () => {
  const r = await avaliar(`fetch('/api/v1/saude').then((x) => 'resposta ' + x.status, () => 'falhou')`)
  exigir(r === 'falhou', 'a API não podia responder a partir da cache: ' + r)
})

ws.close()
proc.kill()
await esperar(500)
try {
  rmSync(perfil, { recursive: true, force: true })
} catch {
  // perfil temporário; o Windows pode mantê-lo bloqueado por instantes
}
for (const r of resultados) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`)
const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passos OK`)
process.exit(falhas ? 1 : 0)
