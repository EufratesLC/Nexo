// Teste automático do fluxo do protótipo (Etapa 1), pelo Chrome DevTools Protocol.
//
// Abre Edge ou Chrome sem interface, com um perfil temporário, e percorre o protótipo como um
// utilizador: login demonstrativo, caixa, venda com autorização, offline simulado, conflito,
// fecho com contagem cega, relatórios, compras, pausa de contagem e largura de telemóvel.
//
// Não usa dependências: só Node.js (>= 22.4, com WebSocket global) e um navegador Chromium.
// Precisa do protótipo a correr em http://localhost:5173 (npm run dev).
//
// Uso (na pasta frontend):
//   npm run teste:fluxo
//   node testes/fluxo/fluxo-cdp.mjs [--navegador <caminho>] [--base <url>] [--capturas <pasta>]
// Variáveis alternativas: NEXO_NAVEGADOR, NEXO_BASE, NEXO_CAPTURAS.
//
// Origem: script usado na verificação da Etapa 1, recuperado e alargado na revisão (v0.2).

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function argumento(nome, variavel) {
  const i = process.argv.indexOf(`--${nome}`)
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1]
  return process.env[variavel]
}

function encontrarNavegador() {
  const indicado = argumento('navegador', 'NEXO_NAVEGADOR')
  if (indicado) return indicado
  const candidatos = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ]
  const encontrado = candidatos.find((c) => existsSync(c))
  if (!encontrado) {
    console.error('Navegador Chromium não encontrado. Indique-o com --navegador <caminho> ou NEXO_NAVEGADOR.')
    process.exit(2)
  }
  return encontrado
}

const navegador = encontrarNavegador()
const BASE = (argumento('base', 'NEXO_BASE') ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const capturas = argumento('capturas', 'NEXO_CAPTURAS') ?? join(tmpdir(), 'nexo-fluxo-capturas')
mkdirSync(capturas, { recursive: true })
const perfil = mkdtempSync(join(tmpdir(), 'nexo-fluxo-perfil-'))
const PORTA = 9333 + Math.floor(Math.random() * 500)

// O protótipo tem de estar a correr.
try {
  const r = await fetch(BASE)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
} catch (e) {
  console.error(`O protótipo não responde em ${BASE} (${e.message}). Arranque-o com "npm run dev" na pasta frontend.`)
  process.exit(2)
}

const proc = spawn(
  navegador,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORTA}`,
    `--user-data-dir=${perfil}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let alvo
for (let i = 0; i < 50 && !alvo; i++) {
  await esperar(300)
  try {
    const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()
    alvo = lista.find((t) => t.type === 'page')
  } catch {
    // o navegador ainda está a arrancar
  }
}
if (!alvo) {
  proc.kill()
  throw new Error('O navegador não abriu a porta de depuração')
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

await cdp('Runtime.enable')
await cdp('Page.enable')

// Funções auxiliares injectadas na página.
const AJUDA = `
window.__t = {
  botao(texto, dentro = document) {
    const b = [...dentro.querySelectorAll('button')].find((x) => x.textContent.trim().includes(texto) && !x.disabled)
    if (!b) throw new Error('Botão não encontrado ou inactivo: ' + texto)
    b.click(); return true
  },
  campo(rotulo) {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(rotulo))
    if (!l) throw new Error('Campo não encontrado: ' + rotulo)
    return document.getElementById(l.htmlFor)
  },
  escrever(rotulo, valor) {
    const el = this.campo(rotulo)
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    return true
  },
  // O protótipo separa os milhares com U+202F; os testes comparam com espaços normais.
  texto() { return document.body.innerText.replace(/[\u202f\u00a0]/g, ' ') },
  // Todo o texto do documento, incluindo o que está por trás de uma janela modal.
  textoTotal() { return document.body.textContent.replace(/[\u202f\u00a0]/g, ' ') },
  modal() { return document.querySelector('.modal') },
}`

async function avaliar(expr) {
  const r = await cdp('Runtime.evaluate', { expression: `(() => { ${AJUDA}; return (${expr}) })()`, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
async function ir(hash) {
  await avaliar(`(location.hash = '${hash}', true)`)
  await esperar(350)
}
async function captura(nome) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(join(capturas, `${nome}.png`), Buffer.from(data, 'base64'))
}
async function entrarComo(nome) {
  if ((await avaliar('location.hash')) !== '#/login') {
    await avaliar(`__t.botao('Sair')`)
    await esperar(400)
  }
  await avaliar(`__t.botao('${nome}')`)
  await esperar(400)
}

const resultados = []
async function passo(nome, fn) {
  try {
    const detalhe = await fn()
    resultados.push({ passo: nome, ok: true, detalhe: detalhe ?? '' })
  } catch (e) {
    resultados.push({ passo: nome, ok: false, detalhe: e.message })
  }
}
const exigir = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// Dados fictícios limpos: apaga o estado guardado e recarrega (a app volta aos dados iniciais).
await cdp('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url: `${BASE}#/login` })
await esperar(1500)
await avaliar(`(localStorage.clear(), true)`)
await cdp('Page.reload')
await esperar(1500)

await passo('Login demonstrativo mostra o aviso e os 3 perfis', async () => {
  const t = await avaliar('__t.texto()')
  exigir(t.includes('Login demonstrativo') && t.includes('Não é autenticação real'), 'aviso em falta')
  exigir(t.includes('Ana Chissano') && t.includes('Carlos Mabunda') && t.includes('Marta Sitoe'), 'perfis em falta')
  await captura('01-login')
})

await passo('Entrar como operadora (Ana) abre o painel', async () => {
  await avaliar(`__t.botao('Ana Chissano')`)
  await esperar(500)
  const t = await avaliar('location.hash + " | " + __t.texto()')
  exigir(t.startsWith('#/painel'), 'não foi para o painel: ' + t.slice(0, 40))
  exigir(!t.includes('Relatórios'), 'operadora não devia ver Relatórios no menu')
})

await passo('Operadora não acede a relatórios nem compras (Sem permissão)', async () => {
  await ir('#/relatorios')
  exigir((await avaliar('__t.texto()')).includes('Sem permissão'), 'relatórios deviam mostrar Sem permissão')
  await ir('#/compras/cp-1')
  exigir((await avaliar('__t.texto()')).includes('Sem permissão'), 'detalhe da compra devia mostrar Sem permissão')
})

await passo('Operadora não vê custos nem margens na interface (produtos e painel)', async () => {
  await ir('#/produtos')
  const p = await avaliar('__t.textoTotal()')
  exigir(!/custo/i.test(p), 'a lista de produtos da operadora mostra "custo"')
  await ir('#/painel')
  const t = await avaliar('__t.textoTotal()')
  exigir(!/margem/i.test(t), 'o painel da operadora mostra margem')
  return 'só interface; a protecção real é na API e na base (arquitectura 3.7)'
})

await passo('Balcão com caixa fechada pede para abrir caixa', async () => {
  await ir('#/balcao')
  exigir((await avaliar('__t.texto()')).includes('A caixa está fechada'), 'devia pedir abertura')
})

await passo('Abrir caixa: validação de valor inválido e abertura com 2 000,00', async () => {
  await ir('#/caixa')
  await avaliar(`__t.escrever('Fundo de maneio', 'abc')`)
  await avaliar(`__t.botao('Abrir caixa')`)
  await esperar(200)
  exigir((await avaliar('__t.texto()')).includes('Indique o fundo contado'), 'sem mensagem de erro')
  await avaliar(`__t.escrever('Fundo de maneio', '2 000,00')`)
  await avaliar(`__t.botao('Abrir caixa')`)
  await esperar(300)
  exigir((await avaliar('__t.texto()')).includes('Sessão aberta'), 'sessão não abriu')
  exigir((await avaliar('__t.texto()')).includes('contagem cega'), 'operadora não devia ver o esperado')
})

await passo('Painel da operadora não mostra o numerário esperado', async () => {
  await ir('#/painel')
  const t = await avaliar('__t.textoTotal()')
  exigir(!t.includes('2 000,00 MZN'), 'o painel mostra o esperado (2 000,00) à operadora')
  exigir(t.includes('O esperado aparece no fecho'), 'falta a indicação da contagem cega no painel')
})

let numeroVenda = ''
await passo('Venda online com desconto de 5% autorizado pelo gestor e troco', async () => {
  await ir('#/balcao')
  await avaliar(`__t.botao('Arroz 5 kg')`)
  await avaliar(`__t.botao('Arroz 5 kg')`)
  await avaliar(`__t.botao('Óleo alimentar 1 L')`)
  await avaliar(`__t.escrever('Desconto sobre o total', '5')`)
  await esperar(200)
  const t = await avaliar('__t.texto()')
  exigir(t.includes('1 026,00 MZN'), 'total esperado 1 026,00 MZN')
  exigir(t.includes('vai pedir autorização'), 'devia avisar que precisa de autorização')
  await captura('02-balcao-carrinho')
  await avaliar(`__t.botao('Pagamento')`)
  await esperar(200)
  await avaliar(`__t.escrever('Valor entregue', '1 500,00')`)
  await avaliar(`__t.botao('Adicionar pagamento', __t.modal())`)
  await esperar(150)
  await avaliar(`__t.botao('Concluir venda', __t.modal())`)
  await esperar(250)
  exigir((await avaliar('__t.texto()')).includes('Autorização necessária'), 'modal de autorização não abriu')
  await avaliar(`__t.escrever('Quem autoriza', 'u-carlos')`)
  await avaliar(`__t.escrever('PIN de quem autoriza', '0000')`)
  await avaliar(`__t.escrever('Motivo', 'Cliente habitual')`)
  await avaliar(`__t.botao('Autorizar', __t.modal())`)
  await esperar(150)
  exigir((await avaliar('__t.texto()')).includes('PIN incorrecto'), 'PIN errado devia ser recusado')
  await avaliar(`__t.escrever('PIN de quem autoriza', '1234')`)
  await avaliar(`__t.botao('Autorizar', __t.modal())`)
  await esperar(400)
  const h = await avaliar('location.hash')
  exigir(h.startsWith('#/vendas/'), 'não abriu o comprovativo: ' + h)
  const c = await avaliar('__t.texto()')
  exigir(c.includes('Documento interno') && c.includes('Este documento não é uma factura'), 'avisos do comprovativo em falta')
  exigir(c.includes('Troco') && c.includes('474,00 MZN'), 'troco 474,00 em falta')
  exigir(c.includes('Carlos Mabunda — Cliente habitual'), 'autorizador em falta')
  numeroVenda = (c.match(/F01-C01-\d{4}-\d{6}/) || [''])[0]
  exigir(numeroVenda !== '', 'número do comprovativo em falta')
  exigir(!/factura-recibo|Factura\b/.test(c), 'a palavra factura não pode ser título')
  exigir(!/custo|margem/i.test(await avaliar('__t.textoTotal()')), 'o comprovativo da operadora mostra custo ou margem')
  return numeroVenda
})

await passo('Venda online passa de Pendente a Confirmado (envio simulado)', async () => {
  await esperar(2000)
  exigir((await avaliar('__t.texto()')).includes('Confirmado'), 'não confirmou')
  await captura('03-comprovativo')
})

await passo('Venda offline fica Pendente, comprovativo indica-o, e confirma ao voltar online', async () => {
  await avaliar(`__t.botao('Offline')`)
  await ir('#/balcao')
  await avaliar(`__t.botao('Pão')`)
  await avaliar(`__t.botao('Pagamento')`)
  await esperar(150)
  await avaliar(`__t.botao('Adicionar pagamento', __t.modal())`)
  await avaliar(`__t.botao('Concluir venda', __t.modal())`)
  await esperar(2000)
  const t = await avaliar('__t.texto()')
  exigir(t.includes('Pendente de sincronização'), 'comprovativo devia dizer pendente')
  exigir(t.includes('1 pendente'), 'cabeçalho devia mostrar 1 pendente')
  await captura('04-venda-offline-pendente')
  await avaliar(`__t.botao('Online')`)
  await esperar(2000)
  exigir((await avaliar('__t.texto()')).includes('0 pendentes'), 'devia ficar sem pendentes')
})

await passo('Conflito simulado numa operação pendente fica visível e preservado', async () => {
  await avaliar(`__t.botao('Offline')`)
  await ir('#/caixa')
  await avaliar(`__t.botao('Reforço')`)
  await esperar(150)
  await avaliar(`__t.escrever('Valor', '100,00')`)
  await avaliar(`__t.escrever('Origem e motivo', 'Trocos do cofre')`)
  await avaliar(`__t.botao('Pedir autorização', __t.modal())`)
  await esperar(200)
  await avaliar(`__t.escrever('PIN de quem autoriza', '4321')`)
  await avaliar(`__t.escrever('Motivo', 'Falta de trocos')`)
  await avaliar(`__t.botao('Autorizar', __t.modal())`)
  await esperar(250)
  await ir('#/sincronizacao')
  await avaliar(`__t.botao('Marcar conflito')`)
  await esperar(150)
  await avaliar(`__t.botao('Sessão de caixa fechada à força', __t.modal())`)
  await esperar(200)
  await avaliar(`__t.botao('Online')`)
  await esperar(2000)
  const t = await avaliar('__t.texto()')
  exigir(t.includes('Conflito') && t.includes('Sessão de caixa fechada à força'), 'conflito não visível')
  exigir(!t.includes('Resolver'), 'operadora não devia poder resolver')
  await captura('05-sincronizacao-conflito')
})

// Esperado = 2 000 + 1 026 + 10 (pão) + 100 (reforço) = 3 136,00
await passo('Fecho (operadora): o esperado não aparece antes de registar a contagem, nem por trás da janela', async () => {
  await ir('#/caixa')
  await avaliar(`__t.botao('Fechar caixa')`)
  await esperar(200)
  const antes = await avaliar('__t.textoTotal()')
  exigir(!antes.includes('3 136,00'), 'o esperado (3 136,00) está no documento antes da contagem')
  exigir(antes.includes('proposta por validar'), 'a contagem cega devia estar marcada como proposta')
  await captura('08-fecho-contagem')
})

await passo('Fecho: regista a contagem, depois revela esperado e diferença, e exige justificação', async () => {
  await avaliar(`__t.escrever('Numerário contado', '3 000,00')`)
  await avaliar(`__t.botao('Registar contagem', __t.modal())`)
  await esperar(200)
  let t = await avaliar('__t.texto()')
  exigir(t.includes('3 136,00 MZN'), 'esperado devia ser 3 136,00')
  exigir(t.includes('Falta 136,00 MZN'), 'diferença devia ser falta de 136,00')
  await avaliar(`__t.botao('Fechar sessão', __t.modal())`)
  await esperar(150)
  exigir((await avaliar('__t.texto()')).includes('justificação é obrigatória'), 'devia exigir justificação')
  await captura('09-fecho-resultado')
  // Recontagem: a primeira contagem fica guardada.
  await avaliar(`__t.botao('Recontar', __t.modal())`)
  await esperar(150)
  exigir((await avaliar('__t.texto()')).includes('recontagem'), 'devia indicar que é uma recontagem')
  await avaliar(`__t.escrever('Numerário contado', '3 100,00')`)
  await avaliar(`__t.botao('Registar contagem', __t.modal())`)
  await esperar(200)
  t = await avaliar('__t.texto()')
  exigir(t.includes('1.ª 3 000,00 MZN') && t.includes('2.ª 3 100,00 MZN'), 'as duas contagens deviam aparecer')
  exigir(t.includes('Falta 36,00 MZN'), 'diferença da recontagem devia ser falta de 36,00')
  await avaliar(`__t.escrever('Justificação', 'Teste automático')`)
  await avaliar(`__t.botao('Fechar sessão', __t.modal())`)
  await esperar(300)
  exigir((await avaliar('__t.texto()')).includes('Abrir caixa'), 'caixa devia ficar fechada')
})

await passo('Gestor: histórico do fecho mostra as duas contagens', async () => {
  await entrarComo('Carlos Mabunda')
  await ir('#/caixa')
  const t = await avaliar('__t.texto()')
  exigir(t.includes('2 contagens; 1.ª: 3 000,00 MZN'), 'o histórico devia mostrar a primeira contagem')
})

await passo('Gestor: com a janela de fecho aberta, o esperado não aparece por trás', async () => {
  await avaliar(`__t.escrever('Fundo de maneio', '1 500,00')`)
  await avaliar(`__t.botao('Abrir caixa')`)
  await esperar(300)
  const fora = (await avaliar(`document.querySelector('[data-teste="esperado-cartao"]').textContent`)).replace(/[  ]/g, ' ')
  exigir(fora.includes('1 500,00'), 'fora do fecho o gestor vê o esperado (B.5): ' + fora)
  await avaliar(`__t.botao('Fechar caixa')`)
  await esperar(200)
  // O fundo (1 500,00) continua visível; o que não pode aparecer é o valor esperado.
  const durante = await avaliar(`document.querySelector('[data-teste="esperado-cartao"]').textContent`)
  exigir(!/\d/.test(durante), 'o esperado continua no cartão por trás da janela: ' + durante)
  await avaliar(`__t.botao('Cancelar', __t.modal())`)
  await esperar(150)
})

await passo('Gestor: relatórios de gestão mostram aviso provisório e os indicadores', async () => {
  await ir('#/relatorios')
  const t = await avaliar('__t.texto()')
  exigir(t.includes('Relatório de gestão — provisório') && t.includes('Não substitui a contabilidade'), 'aviso em falta')
  exigir(t.includes('Pendentes declarados') && t.includes('Operações tardias') && t.includes('Correcções auditadas'), 'indicadores em falta')
  exigir(!/definitiv/i.test(t), 'não pode haver valores definitivos')
  await captura('06-relatorios')
})

await passo('Gestor: conflito resolvido com nota fica anulado e preservado', async () => {
  await ir('#/sincronizacao')
  await avaliar(`__t.botao('Resolver')`)
  await esperar(150)
  await avaliar(`__t.botao('Anular', __t.modal())`)
  await esperar(100)
  exigir((await avaliar('__t.texto()')).includes('Escreva uma nota'), 'nota devia ser obrigatória')
  await avaliar(`__t.escrever('Nota para a auditoria', 'Duplicado')`)
  await avaliar(`__t.botao('Anular', __t.modal())`)
  await esperar(200)
  exigir((await avaliar('__t.texto()')).includes('Anulada pelo gestor'), 'estado anulada em falta')
})

await passo('Produto: validação do formulário e código de barras duplicado', async () => {
  await ir('#/produtos/novo')
  await avaliar(`__t.botao('Guardar')`)
  await esperar(150)
  let t = await avaliar('__t.texto()')
  exigir(t.includes('Indique o nome') && t.includes('Escolha uma categoria') && t.includes('preço maior do que zero'), 'mensagens em falta')
  await avaliar(`__t.escrever('Nome', 'Bolacha maria')`)
  await avaliar(`__t.escrever('Categoria', 'c-mercearia')`)
  await avaliar(`__t.escrever('Preço de venda', '35,00')`)
  await avaliar(`__t.escrever('Código de barras', '6001234000001')`)
  await avaliar(`__t.botao('Guardar')`)
  await esperar(150)
  t = await avaliar('__t.texto()')
  exigir(t.includes('já pertence a'), 'devia recusar código de barras duplicado')
  await avaliar(`__t.escrever('Código de barras', '')`)
  await avaliar(`__t.botao('Guardar')`)
  await esperar(250)
  exigir((await avaliar('location.hash')) === '#/produtos', 'devia voltar à lista')
})

await passo('Compra: recepção confirmada aumenta o stock uma única vez', async () => {
  await ir('#/produtos')
  const antes = await avaliar(`[...document.querySelectorAll('tr')].find(r => r.textContent.includes('Farinha de milho'))?.textContent`)
  await ir('#/compras/cp-2')
  await avaliar(`__t.botao('Confirmar recepção')`)
  await esperar(150)
  await avaliar(`__t.botao('Confirmar', __t.modal())`)
  await esperar(200)
  const botaoAinda = await avaliar(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Confirmar recepção'))`)
  exigir(!botaoAinda, 'botão de recepção devia desaparecer')
  await ir('#/produtos')
  const depois = await avaliar(`[...document.querySelectorAll('tr')].find(r => r.textContent.includes('Farinha de milho'))?.textContent`)
  exigir(antes.includes('8 un') && depois.includes('23 un'), `stock esperado 8 → 23; obtido "${antes}" → "${depois}"`)
})

await passo('Pausa de contagem: bloqueia o balcão; sem rede não retoma; retoma só pelo servidor', async () => {
  await esperar(1800) // deixa confirmar as operações pendentes antes do pedido de pausa
  await ir('#/sincronizacao')
  await avaliar(`__t.botao('Simular pedido de pausa')`)
  await esperar(200)
  exigir(!(await avaliar('__t.texto()')).includes('Simular pedido de pausa'), 'o pedido de pausa não foi aceite')
  exigir((await avaliar('__t.texto()')).includes('retoma local por PIN é uma possibilidade futura'), 'a retoma local devia estar indicada como futura')
  await ir('#/balcao')
  exigir((await avaliar('__t.texto()')).includes('Vendas em pausa'), 'balcão devia estar em pausa')
  await avaliar(`__t.botao('Offline')`)
  await ir('#/sincronizacao')
  exigir(!(await avaliar(`[...document.querySelectorAll('button')].some((b) => /retoma local/i.test(b.textContent))`)), 'não pode haver acção de retoma local')
  await avaliar(`__t.botao('Simular retoma')`)
  await esperar(150)
  exigir((await avaliar('__t.texto()')).includes('continua em pausa'), 'sem rede devia continuar em pausa')
  await avaliar(`__t.botao('Online')`)
  await avaliar(`__t.botao('Simular retoma')`)
  await esperar(2000)
  const t = await avaliar('__t.texto()')
  exigir(t.includes('Confirmação de pausa') && t.includes('Confirmação de retoma recebida do servidor'), 'as confirmações de pausa e de retoma deviam estar na lista de operações')
  await ir('#/balcao')
  exigir(!(await avaliar('__t.texto()')).includes('Vendas em pausa'), 'devia ter retomado')
})

// Largura de telemóvel: nenhum ecrã pode ter deslocamento horizontal da página.
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
for (const rota of ['#/painel', '#/balcao', '#/vendas', '#/caixa', '#/produtos', '#/produtos/novo', '#/compras', '#/compras/nova', '#/despesas', '#/relatorios', '#/sincronizacao']) {
  await passo(`Telemóvel 390 px sem deslocamento horizontal: ${rota}`, async () => {
    await ir(rota)
    await esperar(200)
    const larguras = await avaliar('[document.documentElement.scrollWidth, window.innerWidth]')
    exigir(larguras[0] <= larguras[1], `scrollWidth ${larguras[0]} > ${larguras[1]}`)
    if (['#/painel', '#/balcao', '#/relatorios'].includes(rota)) await captura(`07-telemovel-${rota.replace(/[#/]/g, '')}`)
  })
}

await passo('Sem erros na consola durante o fluxo', async () => {
  exigir(errosConsola.length === 0, errosConsola.slice(0, 3).join(' | '))
})

ws.close()
proc.kill()
await esperar(500)
try {
  rmSync(perfil, { recursive: true, force: true })
} catch {
  // o Windows pode manter ficheiros do perfil bloqueados por instantes; a pasta é temporária
}
const falhas = resultados.filter((r) => !r.ok)
for (const r of resultados) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.passo}${r.detalhe ? ' — ' + r.detalhe : ''}`)
console.log(`\nNavegador: ${navegador}\nCapturas: ${capturas}`)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos OK`)
process.exit(falhas.length ? 1 : 0)
