// Rotas de autenticação e administração com serviços SIMULADOS (sem base de dados): a API recusa
// no servidor ANTES de chamar qualquer serviço (função, sessão, empresa/filial pedidas, CSRF,
// campos desconhecidos), as mensagens de login não revelam contas, e nada de secreto sai nas
// respostas nem nos logs. A mesma autorização com a base real está em testes/base/api.test.ts.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { after, before, test } from 'node:test'
import { criarApp } from '../../src/app.js'
import type { AcessoBase } from '../../src/base/acesso.js'
import { MARCA_SESSAO, type Funcao, type SessaoValidada } from '../../src/base/contexto.js'
import { lerConfiguracao } from '../../src/config/ambiente.js'
import { criarEnvioEmailMemoria } from '../../src/email/envio.js'
import { criarLogger } from '../../src/registo/logger.js'
import type { ServicoAdministracao } from '../../src/servicos/administracao.js'
import type { ServicoIdentidade } from '../../src/servicos/identidade.js'

const EMPRESA = '11111111-1111-4111-8111-111111111111'
const FILIAL = '22222222-2222-4222-8222-222222222222'
const OUTRA_EMPRESA = '33333333-3333-4333-8333-333333333333'
const OUTRA_FILIAL = '44444444-4444-4444-8444-444444444444'
const CODIGO = 'Caju verde 2026'

const contas: Record<string, { funcao: Funcao; estado: 'activo' | 'pendente' | 'desactivado'; id: string }> = {
  'loja-a/dono': { funcao: 'proprietario', estado: 'activo', id: 'aaaaaaaa-0000-4000-8000-000000000001' },
  'loja-a/ana': { funcao: 'operador', estado: 'activo', id: 'aaaaaaaa-0000-4000-8000-000000000002' },
  'loja-a/carlos': { funcao: 'gestor', estado: 'activo', id: 'aaaaaaaa-0000-4000-8000-000000000003' },
  'loja-a/saiu': { funcao: 'operador', estado: 'desactivado', id: 'aaaaaaaa-0000-4000-8000-000000000004' },
  'loja-a/nova': { funcao: 'proprietario', estado: 'pendente', id: 'aaaaaaaa-0000-4000-8000-000000000005' },
}
const registos: string[] = []
const reenvios: string[] = []
const sessoes = new Map<string, SessaoValidada>()
const chamadasAdmin: string[] = []

const identidade: ServicoIdentidade = {
  async entrar({ codigoEmpresa, nomeUtilizador, codigoSecreto }) {
    const c = contas[`${codigoEmpresa.trim().toLowerCase()}/${nomeUtilizador.trim().toLowerCase()}`]
    if (!c || codigoSecreto !== CODIGO) return { tipo: 'invalido' }
    if (c.estado === 'pendente') return { tipo: 'pendente' }
    if (c.estado !== 'activo') return { tipo: 'desactivado' }
    const token = 'ns_' + randomBytes(32).toString('base64url')
    const sessao: SessaoValidada = {
      [MARCA_SESSAO]: true,
      sessaoId: randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-4$3-8$4-$5').slice(0, 36),
      empresaId: EMPRESA,
      utilizadorId: c.id,
      funcao: c.funcao,
      nome: nomeUtilizador,
      nomeUtilizador,
      filiais: [FILIAL],
      expiraEm: new Date(Date.now() + 3_600_000),
    }
    sessoes.set(token, sessao)
    return { tipo: 'ok', token, sessao }
  },
  validarSessao: async (token) => sessoes.get(token) ?? null,
  terminarSessao: async (token) => void sessoes.delete(token),
  registar: async (d) => void registos.push(d.codigoEmpresa),
  confirmarEmail: async () => 'invalido',
  reenviarActivacao: async (d) => void reenvios.push(d.nomeUtilizador),
  corrigirEmailActivacao: async () => false,
  pedirRecuperacao: async () => {},
  concluirRecuperacao: async () => false,
  alterarCodigoProprio: async () => true,
  definirEmailRecuperacao: async () => true,
  reenviarConfirmacao: async () => true,
}

const administracao = new Proxy({} as ServicoAdministracao, {
  get: (_alvo, nome: string) => async () => {
    chamadasAdmin.push(nome)
    if (nome === 'resumoSessao') return { empresa: { id: EMPRESA, codigo: 'loja-a', nome: 'Loja A', nuit: null, telefone: null, endereco: null }, filiais: [{ id: FILIAL, codigo: 'F01', nome: 'Principal' }], emailRecuperacao: null }
    if (nome === 'listarUtilizadores') return []
    return {}
  },
})

const baseNaoUsada: AcessoBase = {
  executarTransaccao: async () => {
    throw new Error('a base não devia ser usada')
  },
  chamarIdentidade: async () => {
    throw new Error('a base não devia ser usada')
  },
  diagnosticar: async () => ({ disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'nao_configurada' }),
  encerrar: async () => {},
}

const logs: string[] = []
const destino = new Writable({
  write(p, _e, cb) {
    logs.push(String(p))
    cb()
  },
})

let url = ''
let fechar = async () => {}
function iniciar(env: NodeJS.ProcessEnv = { NEXO_AMBIENTE: 'teste' }) {
  const app = criarApp({ config: lerConfiguracao(env), logger: criarLogger('debug', destino), base: baseNaoUsada, email: criarEnvioEmailMemoria(), servicos: { identidade, administracao } })
  const servidor = app.listen(0)
  return new Promise<{ url: string; fechar: () => Promise<void> }>((r) =>
    servidor.once('listening', () =>
      r({ url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, fechar: () => new Promise((f) => servidor.close(() => f())) }),
    ),
  )
}
before(async () => {
  const s = await iniciar()
  url = s.url
  fechar = s.fechar
})
after(() => fechar())

async function pedir(metodo: string, caminho: string, opcoes: { corpo?: unknown; cookie?: string; cabecalhos?: Record<string, string>; semCliente?: boolean; base?: string } = {}) {
  const r = await fetch(`${opcoes.base ?? url}/api/v1${caminho}`, {
    method: metodo,
    headers: {
      ...(opcoes.semCliente ? {} : { 'X-Nexo-Cliente': 'web' }),
      ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.cookie ? { Cookie: opcoes.cookie } : {}),
      ...opcoes.cabecalhos,
    },
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
  })
  const texto = await r.text()
  return { estado: r.status, corpo: texto ? JSON.parse(texto) : null, texto, setCookie: r.headers.get('set-cookie'), retry: r.headers.get('retry-after') }
}

async function entrar(nomeUtilizador: string, codigo = CODIGO, codigoEmpresa = 'loja-a') {
  const r = await pedir('POST', '/autenticacao/entrar', { corpo: { codigoEmpresa, nomeUtilizador, codigoSecreto: codigo } })
  return { ...r, cookie: r.setCookie?.split(';')[0] ?? '' }
}

test('login correcto: cookie HttpOnly e corpo sem token nem código', async () => {
  const r = await entrar('dono')
  assert.equal(r.estado, 200)
  assert.match(r.setCookie ?? '', /^nexo_sessao=ns_[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/)
  assert.ok(!r.texto.includes('ns_') && !r.texto.includes(CODIGO))
  assert.equal(r.corpo.utilizador.funcao, 'proprietario')
})

test('login incorrecto: a mesma resposta para empresa, conta ou código errados', async () => {
  const rs = await Promise.all([entrar('dono', CODIGO, 'outra-loja'), entrar('ninguem'), entrar('dono', 'errado errado')])
  for (const r of rs) {
    assert.equal(r.estado, 401)
    assert.equal(r.corpo.erro.codigo, 'credenciais_invalidas')
    assert.equal(r.corpo.erro.mensagem, rs[0].corpo.erro.mensagem)
    assert.equal(r.setCookie, null)
  }
  const d = await entrar('saiu')
  assert.equal(d.estado, 403)
  assert.equal(d.corpo.erro.codigo, 'conta_desactivada')
})

test('sem sessão: 401 nao_autenticado; token desconhecido: 401 sessao_terminada e cookie apagado', async () => {
  assert.equal((await pedir('GET', '/autenticacao/sessao')).corpo.erro.codigo, 'nao_autenticado')
  const r = await pedir('GET', '/utilizadores', { cookie: `nexo_sessao=ns_${'x'.repeat(43)}` })
  assert.equal(r.corpo.erro.codigo, 'sessao_terminada')
  assert.match(r.setCookie ?? '', /Max-Age=0/)
  assert.equal((await pedir('GET', '/rota-que-nao-existe')).estado, 404, 'rotas inexistentes continuam 404')
})

test('operador e gestor: 403 nas funções do proprietário SEM chegar ao serviço', async () => {
  for (const nome of ['ana', 'carlos']) {
    const { cookie } = await entrar(nome)
    chamadasAdmin.length = 0
    const rs = await Promise.all([
      pedir('GET', '/utilizadores', { cookie }),
      pedir('POST', '/utilizadores', { cookie, corpo: { nome: 'X', nomeUtilizador: 'xx1', funcao: 'proprietario', filiais: [], codigoSecreto: 'Outro código 1' } }),
      pedir('PATCH', `/utilizadores/${contas['loja-a/ana'].id}`, { cookie, corpo: { funcao: 'proprietario' } }),
      pedir('POST', `/utilizadores/${contas['loja-a/ana'].id}/desactivar`, { cookie }),
      pedir('PUT', `/utilizadores/${contas['loja-a/ana'].id}/codigo`, { cookie, corpo: { codigoSecreto: 'Outro código 1' } }),
      pedir('PATCH', '/empresa', { cookie, corpo: { nome: 'Tomada' } }),
      pedir('GET', '/auditoria', { cookie }),
    ])
    for (const r of rs) assert.equal(r.estado, 403, `${nome}: ${r.texto}`)
    assert.deepEqual(chamadasAdmin, [], 'nenhum serviço foi chamado')
  }
})

test('empresa ou filial escolhida pelo pedido: só a da sessão; corpo com campos desconhecidos: 400', async () => {
  const { cookie } = await entrar('dono')
  assert.equal((await pedir('GET', '/empresa', { cookie, cabecalhos: { 'X-Nexo-Empresa': OUTRA_EMPRESA } })).corpo.erro.codigo, 'empresa_nao_permitida')
  assert.equal((await pedir('GET', '/empresa', { cookie, cabecalhos: { 'X-Nexo-Filial': OUTRA_FILIAL } })).corpo.erro.codigo, 'filial_nao_permitida')
  assert.equal((await pedir('GET', '/empresa', { cookie, cabecalhos: { 'X-Nexo-Empresa': EMPRESA, 'X-Nexo-Filial': FILIAL } })).estado, 200)
  const r = await pedir('POST', '/utilizadores', { cookie, corpo: { nome: 'X', nomeUtilizador: 'xx1', funcao: 'operador', filiais: [FILIAL], codigoSecreto: 'Outro código 1', empresaId: OUTRA_EMPRESA } })
  assert.equal(r.estado, 400)
  assert.ok(r.corpo.erro.detalhes.campos.corpo)
})

test('CSRF: escrita sem X-Nexo-Cliente recusada (também o login); leitura permitida', async () => {
  const r = await pedir('POST', '/autenticacao/entrar', { corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'dono', codigoSecreto: CODIGO }, semCliente: true })
  assert.equal(r.estado, 403)
  assert.equal(r.corpo.erro.codigo, 'pedido_nao_confiavel')
  assert.equal((await pedir('GET', '/saude', { semCliente: true })).estado, 200)
  const outraOrigem = await fetch(`${url}/api/v1/autenticacao/sair`, { method: 'POST', headers: { Origin: 'https://site-alheio.example', 'X-Nexo-Cliente': 'web' } })
  assert.equal(outraOrigem.status, 403, 'origem fora de CORS_ORIGENS')
})

test('tentativas repetidas: 429 igual para conta existente e inexistente, com Retry-After', async () => {
  const s = await iniciar()
  try {
    for (const nome of ['dono', 'naoexiste']) {
      const estados: number[] = []
      for (let i = 0; i < 6; i++) estados.push((await pedir('POST', '/autenticacao/entrar', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: nome, codigoSecreto: 'errado errado' } })).estado)
      assert.deepEqual(estados, [401, 401, 401, 401, 401, 429], nome)
    }
    const r = await pedir('POST', '/autenticacao/entrar', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'dono', codigoSecreto: CODIGO } })
    assert.equal(r.estado, 429)
    assert.ok(Number(r.retry) > 0)
  } finally {
    await s.fechar()
  }
})

test('recuperação: resposta igual exista ou não a conta; códigos fracos recusados', async () => {
  const a = await pedir('POST', '/autenticacao/recuperacao', { corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'dono' } })
  const b = await pedir('POST', '/autenticacao/recuperacao', { corpo: { codigoEmpresa: 'nao-existe', nomeUtilizador: 'x' } })
  assert.equal(a.estado, 202)
  assert.deepEqual(a.corpo, b.corpo)
  const fraco = await pedir('POST', '/autenticacao/recuperacao/concluir', { corpo: { token: 'ne_x', codigoNovo: 'password' } })
  assert.equal(fraco.corpo.erro.codigo, 'validacao')
  const invalido = await pedir('POST', '/autenticacao/recuperacao/concluir', { corpo: { token: 'ne_x', codigoNovo: 'Um código forte 9' } })
  assert.equal(invalido.corpo.erro.codigo, 'link_invalido')
})

test('cookie seguro: __Host- e Secure quando configurado', async () => {
  const s = await iniciar({ NEXO_AMBIENTE: 'teste', SESSAO_COOKIE_SEGURO: 'sim' })
  try {
    const r = await pedir('POST', '/autenticacao/entrar', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'dono', codigoSecreto: CODIGO } })
    assert.match(r.setCookie ?? '', /^__Host-nexo_sessao=ns_[^;]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/)
  } finally {
    await s.fechar()
  }
})

test('nada de secreto nos logs (códigos, tokens de sessão, cookies)', () => {
  const tudo = logs.join('\n')
  assert.ok(tudo.length > 500)
  assert.ok(!tudo.includes(CODIGO) && !tudo.includes('errado errado') && !tudo.includes('Outro código 1'))
  assert.ok(!/ns_[A-Za-z0-9_-]{43}/.test(tudo))
  for (const t of sessoes.keys()) assert.ok(!tudo.includes(t))
})

test('registo: 201 sem cookie de sessão; login de uma conta pendente: 403 activacao_pendente, sem cookie', async () => {
  const r = await pedir('POST', '/autenticacao/registo', {
    corpo: { codigoEmpresa: 'loja-nova', nomeEmpresa: 'Loja Nova', nome: 'Dona', nomeUtilizador: 'nova', email: 'nova@exemplo.co.mz', codigoSecreto: CODIGO },
  })
  assert.equal(r.estado, 201)
  assert.equal(r.setCookie, null)
  assert.equal(r.corpo.activacaoPendente, true)
  assert.deepEqual(registos, ['loja-nova'])
  const l = await entrar('nova')
  assert.equal(l.estado, 403)
  assert.equal(l.corpo.erro.codigo, 'activacao_pendente')
  assert.equal(l.setCookie, null)
  assert.equal((await entrar('nova', 'errado errado')).corpo.erro.codigo, 'credenciais_invalidas', 'o estado só com o código certo')
})

test('reenvio da confirmação: resposta igual sempre; limitado (429) por conta', async () => {
  const s = await iniciar()
  try {
    const estados: number[] = []
    const corpos: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await pedir('POST', '/autenticacao/activacao/reenviar', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: i % 2 ? 'nova' : 'NOVA' } })
      estados.push(r.estado)
      if (r.estado === 202) corpos.push(JSON.stringify(r.corpo))
    }
    assert.deepEqual(estados, [202, 202, 202, 429])
    assert.equal(new Set(corpos).size, 1)
    const outra = await pedir('POST', '/autenticacao/activacao/reenviar', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'ninguem' } })
    assert.equal(JSON.stringify(outra.corpo), corpos[0], 'conta inexistente: a mesma resposta')
    const correccao = await pedir('POST', '/autenticacao/activacao/email', { base: s.url, corpo: { codigoEmpresa: 'loja-a', nomeUtilizador: 'nova', codigoSecreto: 'errado errado', email: 'x@exemplo.co.mz' } })
    assert.equal(correccao.corpo.erro.codigo, 'correccao_recusada')
  } finally {
    await s.fechar()
  }
})
