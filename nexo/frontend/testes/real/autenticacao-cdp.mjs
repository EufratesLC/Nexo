// Teste da aplicação REAL no navegador (Etapa 3), pelo Chrome DevTools Protocol.
//
// Percorre, como um utilizador: criar empresa (conta pendente, sem sessão) → login recusado antes
// da confirmação → reenviar o link (o anterior deixa de valer) → confirmar (conta activada; o link
// não volta a servir) → entrar → criar uma conta de operador → auditoria → sair → entrar como operador (menu reduzido, página
// do proprietário recusada) → o proprietário desactiva a conta (pela API) → a sessão do operador
// termina no navegador → login "desactivada" → recuperação do acesso do proprietário pelo link →
// login com o código novo → largura de telemóvel → nada secreto no armazenamento do navegador.
//
// Precisa de (ver docs/Nexo_Ambientes.md, secção 8):
//   - API com base de dados de DESENVOLVIMENTO e EMAIL_TRANSPORTE=ficheiro (caixa de saída local);
//   - frontend em modo api (VITE_NEXO_MODO=api) com o proxy para essa API.
// Cria uma empresa de teste "e2e-…" na base (não a apaga: a auditoria é imutável; ver o guia).
//
// Uso (na pasta frontend):
//   node testes/real/autenticacao-cdp.mjs --base http://localhost:5373/ --api http://localhost:3201 --correio <pasta EMAIL_PASTA>
//   [--capturas <pasta>]   guarda imagens PNG de alguns ecrãs

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const arg = (n, omissao) => {
  const i = process.argv.indexOf(`--${n}`)
  return i !== -1 ? process.argv[i + 1] : omissao
}
const BASE = arg('base', 'http://localhost:5173/').replace(/\/?$/, '/')
const API = arg('api', 'http://localhost:3001').replace(/\/$/, '')
const CORREIO = arg('correio')
if (!CORREIO || !existsSync(CORREIO)) {
  console.error('Indique --correio <pasta> (EMAIL_PASTA da API, com EMAIL_TRANSPORTE=ficheiro).')
  process.exit(2)
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

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
const perfil = mkdtempSync(join(tmpdir(), 'nexo-real-perfil-'))
const PORTA = 9700 + Math.floor(Math.random() * 200)
const proc = spawn(navegador, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORTA}`, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' })
let alvo
for (let i = 0; i < 50 && !alvo; i++) {
  await esperar(300)
  alvo = await fetch(`http://127.0.0.1:${PORTA}/json/list`).then((r) => r.json(), () => []).then((l) => l.find((t) => t.type === 'page'))
}
const ws = new WebSocket(alvo.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let proximo = 1
const pendentes = new Map()
const errosConsola = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pendentes.has(m.id)) {
    pendentes.get(m.id)(m)
    pendentes.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') errosConsola.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errosConsola.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
})
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = proximo++
    pendentes.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const avaliar = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
await cdp('Runtime.enable')
await cdp('Page.enable')

const texto = () => avaliar('document.body.innerText')
async function esperarTexto(re, ms = 10000) {
  const fim = Date.now() + ms
  let t = ''
  while (Date.now() < fim) {
    t = await texto().catch(() => '')
    if (re.test(t)) return t
    await esperar(150)
  }
  throw new Error(`não apareceu ${re} (página: ${t.slice(0, 300).replace(/\s+/g, ' ')})`)
}
const ir = async (hash) => {
  await avaliar(`(location.hash = ${JSON.stringify(hash)}, true)`)
  await esperar(250)
}
async function abrir(url) {
  await cdp('Page.navigate', { url })
  await esperar(600)
}
/** Preenche um campo pelo rótulo (inputs controlados pelo React). */
async function preencher(rotulo, valor) {
  const ok = await avaliar(`(() => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === ${JSON.stringify(rotulo)})
    const el = l && (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector('input'))
    if (!el) return false
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(valor)})
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    return true
  })()`)
  if (!ok) throw new Error(`campo não encontrado: ${rotulo}`)
}
async function carregar(textoBotao) {
  const ok = await avaliar(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(textoBotao)} && !x.disabled); if (!b) return false; b.click(); return true })()`)
  if (!ok) throw new Error(`botão não encontrado: ${textoBotao}`)
}
/** Link do e-mail mais recente com esta finalidade (o envio é assíncrono: espera até 10 s). */
async function ultimoEmail(finalidade, depoisDe) {
  const fim = Date.now() + 10_000
  while (Date.now() < fim) {
    const f = readdirSync(CORREIO)
      .filter((n) => n.includes(finalidade))
      .map((n) => ({ n, t: statSync(join(CORREIO, n)).mtimeMs }))
      .filter((x) => x.t >= depoisDe)
      .sort((a, b) => b.t - a.t)[0]
    const link = f && /(http\S+#\/[a-z-]+\?token=ne_[A-Za-z0-9_-]{43})/.exec(readFileSync(join(CORREIO, f.n), 'utf8'))?.[1]
    if (link) return link
    await esperar(200)
  }
  throw new Error(`sem e-mail ${finalidade} na caixa de saída`)
}
async function api(metodo, caminho, corpo, cookie) {
  const r = await fetch(`${API}/api/v1${caminho}`, {
    method: metodo,
    headers: { 'X-Nexo-Cliente': 'web', ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return { estado: r.status, corpo: await r.json().catch(() => null), cookie: r.headers.get('set-cookie')?.split(';')[0] }
}

const CAPTURAS = arg('capturas')
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true })
async function capturar(nome) {
  if (!CAPTURAS) return
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  writeFileSync(join(CAPTURAS, `${nome}.png`), Buffer.from(r.data, 'base64'))
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

const empresa = `e2e-${randomBytes(4).toString('hex')}`
const CODIGO_DONO = 'Caju verde na feira 2026'
const CODIGO_ANA = 'Balcão norte, porta 7'
const CODIGO_NOVO = 'Novo código recuperado 1'
const inicio = Date.now()

await abrir(BASE)

await passo('Sem sessão: abre no ecrã de entrada (sem perfis fictícios)', async () => {
  const t = await esperarTexto(/Entrar/)
  exigir(/Código da empresa/.test(t) && /Nome de utilizador/.test(t) && /Código secreto/.test(t), 'campos do login')
  exigir(!/Ana Chissano|perfil fictício/i.test(t), 'não pode mostrar a demonstração')
  await capturar('01-entrar')
})

await passo('Criar empresa: validação no formulário; registo sem sessão, com o ecrã "Confirme o seu e-mail"', async () => {
  await ir('#/criar-empresa')
  await esperarTexto(/Criar empresa/)
  await carregar('Criar empresa')
  await esperarTexto(/Indique o nome da empresa/)
  await capturar('02-criar-empresa-validacao')
  await preencher('Nome comercial', 'Loja E2E')
  await preencher('Código da empresa', empresa)
  await preencher('O seu nome', 'Dona Teste')
  await preencher('Nome de utilizador', 'dona')
  await preencher('E-mail de recuperação', 'dona@exemplo.co.mz')
  await preencher('Código secreto', CODIGO_DONO)
  await preencher('Repetir o código secreto', CODIGO_DONO)
  await carregar('Criar empresa')
  const t = await esperarTexto(/Confirme o seu e-mail/, 20000)
  exigir(/dona@exemplo\.co\.mz/.test(t) && new RegExp(empresa).test(t), 'instruções com o e-mail e o código da empresa')
  const sessao = await avaliar(`fetch('/api/v1/autenticacao/sessao').then((r) => r.status)`)
  exigir(sessao === 401, `não devia haver sessão depois do registo (HTTP ${sessao})`)
  await capturar('03-registo-pendente')
  return empresa
})

let primeiroLink = ''
await passo('Antes da confirmação: o login com o código certo é recusado ("ainda não está activa")', async () => {
  primeiroLink = await ultimoEmail('confirmar_email', inicio)
  await ir('#/entrar')
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'dona')
  await preencher('Código secreto', CODIGO_DONO)
  await carregar('Entrar')
  await esperarTexto(/A conta ainda não está activa/)
  exigir((await avaliar(`fetch('/api/v1/autenticacao/sessao').then((r) => r.status)`)) === 401, 'sessão criada antes da activação')
})

await passo('Reenviar a confirmação: resposta neutra; o link anterior deixa de valer', async () => {
  const antes = Date.now()
  await avaliar(`(() => { [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Reenviar o e-mail de confirmação')).click(); return true })()`)
  await esperarTexto(/Confirme o seu e-mail/)
  await carregar('Reenviar o e-mail')
  await esperarTexto(/Se existir um registo à espera de confirmação/)
  const novoLink = await ultimoEmail('confirmar_email', antes)
  exigir(novoLink !== primeiroLink, 'devia chegar um link novo')
  await abrir(primeiroLink)
  await esperarTexto(/Não foi possível confirmar/)
  primeiroLink = novoLink
})

await passo('Confirmação válida: "Conta activada", token retirado do endereço; repetir o link é recusado', async () => {
  await abrir(primeiroLink)
  await esperarTexto(/Conta activada/)
  const hash = await avaliar('location.hash')
  exigir(!hash.includes('token'), `o token ficou no endereço: ${hash}`)
  // Abrir o mesmo link outra vez, como a partir do e-mail (carregamento novo da página).
  await abrir('about:blank')
  await abrir(primeiroLink)
  await esperarTexto(/Não foi possível confirmar/)
})

await passo('Depois da confirmação: login normal do proprietário', async () => {
  await ir('#/entrar')
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'dona')
  await preencher('Código secreto', CODIGO_DONO)
  await carregar('Entrar')
  const t = await esperarTexto(/Olá, Dona Teste/)
  exigir(!/Confirme o e-mail de recuperação/.test(t), 'o e-mail já está confirmado')
  exigir(new RegExp(empresa).test(t), 'código da empresa visível')
  await capturar('04-inicio-proprietario')
})

await passo('Funcionários: criar a conta de um operador (o código não volta a aparecer)', async () => {
  await ir('#/funcionarios')
  await esperarTexto(/Ainda não há funcionários/)
  await ir('#/funcionarios/novo')
  await esperarTexto(/Nova conta/)
  await preencher('Nome', 'Ana Operadora')
  await preencher('Nome de utilizador', 'ana')
  await preencher('Código secreto', CODIGO_ANA)
  await preencher('Repetir o código secreto', CODIGO_ANA)
  await carregar('Criar conta')
  const t = await esperarTexto(/Ana Operadora pode entrar/)
  exigir(!t.includes(CODIGO_ANA), 'o código aparece no ecrã')
  await ir('#/funcionarios')
  await esperarTexto(/Ana Operadora/)
  await capturar('05-funcionarios')
})

await passo('Auditoria: regista a criação da empresa e da conta, com a conta usada', async () => {
  await ir('#/auditoria')
  const t = await esperarTexto(/Conta criada/)
  exigir(/Empresa criada/.test(t) && /Dona Teste \(dona\)/.test(t), 'linhas esperadas')
  exigir(/não prova qual pessoa/.test(t), 'aviso sobre a conta vs pessoa')
  await capturar('06-auditoria')
})

await passo('Nada secreto no navegador: sem cookie legível, sem códigos nem tokens no armazenamento', async () => {
  const r = await avaliar(`({ cookie: document.cookie, local: JSON.stringify({ ...localStorage }), sessao: JSON.stringify({ ...sessionStorage }) })`)
  exigir(r.cookie === '', `cookie legível pelo JavaScript: ${r.cookie}`)
  for (const s of [CODIGO_DONO, CODIGO_ANA, 'ns_', 'ne_']) exigir(!r.local.includes(s) && !r.sessao.includes(s), `armazenamento contém ${s.slice(0, 4)}`)
})

await passo('Sair: volta ao login com a mensagem de saída', async () => {
  await carregar('Sair')
  await esperarTexto(/Saiu da sua conta/)
})

await passo('Login com código errado: mensagem que não revela a conta', async () => {
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'ana')
  await preencher('Código secreto', 'código errado mesmo')
  await carregar('Entrar')
  await esperarTexto(/Código da empresa, nome de utilizador ou código secreto incorrectos/)
})

await passo('Operador: menu sem funções do proprietário; página do proprietário recusada', async () => {
  await preencher('Código secreto', CODIGO_ANA)
  await carregar('Entrar')
  const t = await esperarTexto(/Olá, Ana Operadora/)
  exigir(!/Funcionários/.test(t) && !/Auditoria/.test(t), 'menu do operador')
  await ir('#/funcionarios')
  await esperarTexto(/Sem acesso a esta página/)
  await capturar('07-operador-acesso-negado')
})

await passo('O proprietário desactiva a conta (pela API): a sessão aberta do operador termina no navegador', async () => {
  const dono = await api('POST', '/autenticacao/entrar', { codigoEmpresa: empresa, nomeUtilizador: 'dona', codigoSecreto: CODIGO_DONO })
  exigir(dono.estado === 200, `login do proprietário: ${dono.estado}`)
  const ana = (await api('GET', '/utilizadores', undefined, dono.cookie)).corpo.utilizadores.find((u) => u.nomeUtilizador === 'ana')
  exigir((await api('POST', `/utilizadores/${ana.id}/desactivar`, undefined, dono.cookie)).estado === 200, 'desactivar')
  await ir('#/empresa')
  await esperarTexto(/A sua sessão terminou/)
  await capturar('08-sessao-terminada')
})

await passo('Conta desactivada: login com o código certo diz que está desactivada', async () => {
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'ana')
  await preencher('Código secreto', CODIGO_ANA)
  await carregar('Entrar')
  await esperarTexto(/Esta conta está desactivada/)
})

await passo('Recuperação do proprietário: pedido com resposta neutra, link por e-mail, novo código', async () => {
  const antes = Date.now()
  await ir('#/recuperar')
  await esperarTexto(/Recuperar o acesso/)
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'dona')
  await carregar('Enviar link de recuperação')
  await esperarTexto(/Se existir uma conta de proprietário/)
  await abrir(await ultimoEmail('recuperar_acesso', antes - 1000))
  await esperarTexto(/Definir um novo código de acesso/)
  exigir(!(await avaliar('location.hash')).includes('token'), 'o token ficou no endereço')
  await preencher('Código novo', CODIGO_NOVO)
  await preencher('Repetir o código novo', CODIGO_NOVO)
  await carregar('Guardar o código novo')
  await esperarTexto(/Código redefinido/)
})

await passo('Login com o código novo; o antigo deixou de servir', async () => {
  exigir((await api('POST', '/autenticacao/entrar', { codigoEmpresa: empresa, nomeUtilizador: 'dona', codigoSecreto: CODIGO_DONO })).estado === 401, 'o código antigo ainda entra')
  await ir('#/entrar')
  await preencher('Código da empresa', empresa)
  await preencher('Nome de utilizador', 'dona')
  await preencher('Código secreto', CODIGO_NOVO)
  await carregar('Entrar')
  await esperarTexto(/Olá, Dona Teste/)
})

await passo('Telemóvel (390 px): sem deslocamento horizontal no início, funcionários e o meu acesso', async () => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const larguras = []
  for (const h of ['#/inicio', '#/funcionarios', '#/meu-acesso', '#/empresa']) {
    await ir(h)
    await esperar(400)
    const r = await avaliar('({ w: document.documentElement.scrollWidth, v: innerWidth })')
    larguras.push(`${h} ${r.w}/${r.v}`)
    await capturar(`09-telemovel-${h.slice(2)}`)
    exigir(r.w <= r.v, `deslocamento horizontal em ${h}: ${r.w} > ${r.v}`)
  }
  await cdp('Emulation.clearDeviceMetricsOverride')
  return larguras.join('; ')
})

await passo('Sem erros na consola durante o fluxo', async () => {
  // Os 401/403 esperados aparecem como recursos falhados, não como erros de JavaScript.
  const reais = errosConsola.filter((e) => !/Failed to load resource/.test(e))
  exigir(reais.length === 0, reais.join(' | '))
})

ws.close()
proc.kill()
await esperar(300)
try {
  rmSync(perfil, { recursive: true, force: true })
} catch {
  // o Windows pode manter o perfil bloqueado por instantes
}
for (const r of resultados) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`)
const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passos OK (empresa de teste: ${empresa})`)
process.exit(falhas ? 1 : 0)
