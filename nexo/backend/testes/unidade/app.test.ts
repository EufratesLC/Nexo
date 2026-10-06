// Aplicação HTTP com uma base SIMULADA: rotas versionadas, erros no formato único, identificação
// dos pedidos, CORS, validação, prova de assinatura só em desenvolvimento e logs sem segredos.
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { after, before, test } from 'node:test'
import { criarApp } from '../../src/app.js'
import { ErroBaseIndisponivel, type AcessoBase, type EstadoBase } from '../../src/base/acesso.js'
import { lerConfiguracao } from '../../src/config/ambiente.js'
import { criarLogger } from '../../src/registo/logger.js'

function baseSimulada(estado: EstadoBase | 'falhar'): AcessoBase {
  return {
    executarTransaccao: async () => {
      throw new Error('não usado')
    },
    diagnosticar: async () => {
      if (estado === 'falhar') throw new Error('ligação postgresql://nexo_api:SegredoMuitoForte@servidor/postgres recusou')
      return estado
    },
    encerrar: async () => {},
  }
}

const linhasLog: string[] = []
const destino = new Writable({
  write(pedaco, _enc, cb) {
    linhasLog.push(String(pedaco))
    cb()
  },
})

async function servir(env: NodeJS.ProcessEnv, estado: EstadoBase | 'falhar') {
  const config = lerConfiguracao(env)
  const app = criarApp({ config, logger: criarLogger('info', destino), base: baseSimulada(estado) })
  const servidor = app.listen(0)
  await new Promise((r) => servidor.once('listening', r))
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
  return { url, fechar: () => new Promise<void>((r) => servidor.close(() => r())) }
}

const pronta: EstadoBase = { disponivel: true, papelSeguro: true, versaoMigracao: '0004' }
let dev: Awaited<ReturnType<typeof servir>>
before(async () => {
  dev = await servir({ NEXO_AMBIENTE: 'desenvolvimento' }, pronta)
})
after(async () => dev.fechar())

test('GET /api/v1/saude responde ok e devolve X-Nexo-Pedido', async () => {
  const r = await fetch(`${dev.url}/api/v1/saude`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { estado: 'ok', servico: 'nexo-api', ambiente: 'desenvolvimento' })
  assert.match(r.headers.get('x-nexo-pedido') ?? '', /^[0-9a-f-]{36}$/)
  assert.equal(r.headers.get('x-powered-by'), null)
})

test('o identificador do pedido do cliente é aceite só se for UUID', async () => {
  const id = '0b9f6c1e-7c3a-4f7e-9a51-3c2d8e0f4a11'
  assert.equal((await fetch(`${dev.url}/api/v1/saude`, { headers: { 'X-Nexo-Pedido': id } })).headers.get('x-nexo-pedido'), id)
  const falso = 'nao-e-uuid","nivel":"fatal'
  const injectado = (await fetch(`${dev.url}/api/v1/saude`, { headers: { 'X-Nexo-Pedido': falso } })).headers.get('x-nexo-pedido')
  assert.notEqual(injectado, falso)
  assert.match(injectado ?? '', /^[0-9a-f-]{36}$/)
})

test('GET /api/v1/saude/base: 200 quando pronta, 503 com motivo quando não', async () => {
  const r = await fetch(`${dev.url}/api/v1/saude/base`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { estado: 'ok', base: { disponivel: true, papelSeguro: true, versaoMigracao: '0004' } })
  for (const estado of [
    { disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'nao_configurada' },
    { disponivel: true, papelSeguro: false, versaoMigracao: '0004', motivo: 'papel_inseguro' },
    { disponivel: true, papelSeguro: true, versaoMigracao: null, motivo: 'migracoes_em_falta' },
  ] as EstadoBase[]) {
    const s = await servir({ NEXO_AMBIENTE: 'teste' }, estado)
    const r2 = await fetch(`${s.url}/api/v1/saude/base`)
    const corpo = (await r2.json()) as { estado: string; base: { motivo: string } }
    await s.fechar()
    assert.equal(r2.status, 503)
    assert.equal(corpo.estado, 'indisponivel')
    assert.equal(corpo.base.motivo, estado.motivo)
  }
})

test('rota inexistente: 404 no formato único, com pedidoId', async () => {
  const r = await fetch(`${dev.url}/api/v1/nao-existe`)
  assert.equal(r.status, 404)
  const corpo = (await r.json()) as { erro: { codigo: string; pedidoId: string } }
  assert.equal(corpo.erro.codigo, 'nao_encontrado')
  assert.equal(corpo.erro.pedidoId, r.headers.get('x-nexo-pedido'))
})

test('JSON inválido: 400 pedido_invalido', async () => {
  const r = await fetch(`${dev.url}/api/prova-assinatura/chaves`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nao json' })
  assert.equal(r.status, 400)
  assert.equal(((await r.json()) as { erro: { codigo: string } }).erro.codigo, 'pedido_invalido')
})

test('validação: 400 com os campos inválidos', async () => {
  const r = await fetch(`${dev.url}/api/prova-assinatura/chaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jwk: 'x', utilizador: '' }),
  })
  assert.equal(r.status, 400)
  const corpo = (await r.json()) as { erro: { codigo: string; detalhes: { campos: Record<string, string[]> } } }
  assert.equal(corpo.erro.codigo, 'validacao')
  assert.deepEqual(Object.keys(corpo.erro.detalhes.campos).sort(), ['corpo.jwk', 'corpo.registo', 'corpo.utilizador'])
})

test('erro inesperado: 500 genérico; a mensagem interna fica só no log, sem segredos', async () => {
  linhasLog.length = 0
  // O diagnóstico simulado lança um erro com a ligação completa na mensagem.
  const s = await servir({ NEXO_AMBIENTE: 'teste' }, 'falhar')
  const r = await fetch(`${s.url}/api/v1/saude/base`)
  await s.fechar()
  assert.equal(r.status, 500)
  const texto = await r.text()
  assert.ok(!texto.includes('Segredo') && !texto.includes('postgresql'), texto)
  assert.match(texto, /erro_interno/)
  const log = linhasLog.join('')
  assert.match(log, /erro no pedido/)
  assert.ok(!log.includes('SegredoMuitoForte'), 'o log não pode ter a palavra-passe')
  assert.ok(!log.includes('nexo_api:'), 'o log não pode ter o utilizador da ligação')
})

test('sem ligação à base a tempo: 503 indisponivel (não 500)', async () => {
  const config = lerConfiguracao({ NEXO_AMBIENTE: 'teste' })
  const base: AcessoBase = {
    ...baseSimulada(pronta),
    diagnosticar: async () => {
      throw new ErroBaseIndisponivel('sem ligação à base dentro do tempo limite')
    },
  }
  const app = criarApp({ config, logger: criarLogger('silent'), base })
  const servidor = app.listen(0)
  await new Promise((r) => servidor.once('listening', r))
  const r = await fetch(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1/saude/base`)
  await new Promise((r2) => servidor.close(r2))
  assert.equal(r.status, 503)
  assert.equal(((await r.json()) as { erro: { codigo: string } }).erro.codigo, 'indisponivel')
})

test('o log não regista o cabeçalho Authorization', async () => {
  linhasLog.length = 0
  await fetch(`${dev.url}/api/v1/saude`, { headers: { Authorization: 'Bearer eyJabcdefgh.eyJabcdefgh.assinaturaxyz' } })
  assert.ok(!linhasLog.join('').includes('eyJabcdefgh'))
})

test('CORS: origem prevista é aceite; outra é recusada com 403', async () => {
  const ok = await fetch(`${dev.url}/api/v1/saude`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const outra = await fetch(`${dev.url}/api/v1/saude`, { headers: { Origin: 'https://site-desconhecido.exemplo' } })
  assert.equal(outra.status, 403)
  assert.equal(((await outra.json()) as { erro: { codigo: string } }).erro.codigo, 'origem_nao_permitida')
})

test('prova de assinatura: existe em desenvolvimento com aviso; não existe em teste nem produção', async () => {
  const r = await fetch(`${dev.url}/api/prova-assinatura/chaves`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('x-nexo-aviso'), 'prova-tecnica; nao-e-autenticacao')
  const t = await servir({ NEXO_AMBIENTE: 'teste' }, pronta)
  assert.equal((await fetch(`${t.url}/api/prova-assinatura/chaves`)).status, 404)
  await t.fechar()
})

test('a rota antiga /api/health deixou de existir (substituída por /api/v1/saude)', async () => {
  assert.equal((await fetch(`${dev.url}/api/health`)).status, 404)
})
