// Autorização da API com a base REAL (H-01, requisito R2): a aplicação Express completa, numa porta
// local, com os serviços reais, o PostgreSQL de teste e e-mail em memória. Cada "navegador" guarda
// o seu cookie de sessão. Os logs da API são capturados e procurados por segredos.
import './verificacaoPrevia.js' // uma ligação de cada tipo antes de tudo (ver o ficheiro)
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { after, before, describe, test } from 'node:test'
import { criarApp } from '../../src/app.js'
import type { AcessoBase } from '../../src/base/acesso.js'
import { criarEnvioEmailMemoria } from '../../src/email/envio.js'
import { criarLogger } from '../../src/registo/logger.js'
import { acessoTeste, CODIGO_DONO, CODIGO_FUNC, codigoEmpresaTeste, configTeste, limparEmpresas, motivoSalto } from './ajuda.js'

const linhasLog: string[] = []
const destino = new Writable({
  write(pedaco, _enc, cb) {
    linhasLog.push(String(pedaco))
    cb()
  },
})
const email = criarEnvioEmailMemoria()
const criadas: string[] = []
const segredosVistos = new Set<string>([CODIGO_DONO, CODIGO_FUNC])

class Navegador {
  cookie = ''
  constructor(readonly url: string) {}
  async pedir(metodo: string, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}) {
    const r = await fetch(`${this.url}/api/v1${caminho}`, {
      method: metodo,
      headers: {
        'X-Nexo-Cliente': 'web',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...cabecalhos,
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    })
    const definido = r.headers.get('set-cookie')
    if (definido) {
      const valor = definido.split(';')[0]
      this.cookie = valor.endsWith('=') ? '' : valor
      if (!valor.endsWith('=')) segredosVistos.add(valor.split('=')[1])
    }
    const texto = await r.text()
    return { estado: r.status, corpo: texto ? JSON.parse(texto) : null, texto, setCookie: definido, cabecalhos: r.headers }
  }
}

describe('API com a base real: autenticação e autorização', { skip: motivoSalto }, () => {
  let base: AcessoBase
  let url = ''
  let fechar = async () => {}
  const novo = () => new Navegador(url)
  const A = { codigo: '', dono: undefined as unknown as Navegador, empresaId: '', filial: '' }
  const B = { codigo: '', dono: undefined as unknown as Navegador, empresaId: '', filial: '', opId: '' }
  let opA = { id: '', nav: undefined as unknown as Navegador }
  let gestorA = { id: '', nav: undefined as unknown as Navegador }

  async function registar(nav: Navegador, nomeUtilizador = 'dono') {
    const codigoEmpresa = codigoEmpresaTeste()
    criadas.push(codigoEmpresa)
    const antes = email.mensagens.length
    const r = await nav.pedir('POST', '/autenticacao/registo', {
      codigoEmpresa,
      nomeEmpresa: `TESTE ${codigoEmpresa}`,
      nome: 'Dono de Teste',
      nomeUtilizador,
      email: 'dono@exemplo.co.mz',
      codigoSecreto: CODIGO_DONO,
    })
    assert.equal(r.estado, 201, r.texto)
    assert.equal(r.setCookie, null, 'o registo não emite sessão')
    // Activação: o link de confirmação (envio assíncrono) e só depois o login.
    const token = await linkConfirmacao(antes)
    const c = await novo().pedir('POST', '/autenticacao/email/confirmar', { token })
    assert.deepEqual(c.corpo, { confirmado: true, contaActivada: true })
    const l = await entrar(nav, codigoEmpresa, nomeUtilizador, CODIGO_DONO)
    assert.equal(l.estado, 200, l.texto)
    return { codigoEmpresa, corpo: l.corpo }
  }

  async function linkConfirmacao(depoisDe: number): Promise<string> {
    const m = (await email.esperar(depoisDe + 1)).slice(depoisDe).filter((x) => x.finalidade === 'confirmar_email').at(-1)!
    const token = /token=(ne_[A-Za-z0-9_-]{43})/.exec(m.texto)![1]
    segredosVistos.add(token)
    return token
  }

  async function entrar(nav: Navegador, codigoEmpresa: string, nomeUtilizador: string, codigoSecreto: string) {
    return nav.pedir('POST', '/autenticacao/entrar', { codigoEmpresa, nomeUtilizador, codigoSecreto })
  }

  before(async () => {
    const config = configTeste()
    base = acessoTeste(config)
    const app = criarApp({ config, logger: criarLogger('debug', destino), base, email })
    const servidor = app.listen(0)
    await new Promise((r) => servidor.once('listening', r))
    url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
    fechar = () => new Promise<void>((r) => servidor.close(() => r()))

    A.dono = novo()
    const ra = await registar(A.dono)
    A.codigo = ra.codigoEmpresa
    A.empresaId = ra.corpo.empresa.id
    A.filial = ra.corpo.filiais[0].id
    B.dono = novo()
    const rb = await registar(B.dono)
    B.codigo = rb.codigoEmpresa
    B.empresaId = rb.corpo.empresa.id
    B.filial = rb.corpo.filiais[0].id

    const op = await A.dono.pedir('POST', '/utilizadores', { nome: 'Ana', nomeUtilizador: 'ana', funcao: 'operador', filiais: [A.filial], codigoSecreto: CODIGO_FUNC })
    assert.equal(op.estado, 201, op.texto)
    opA = { id: op.corpo.utilizador.id, nav: novo() }
    assert.equal((await entrar(opA.nav, A.codigo, 'ana', CODIGO_FUNC)).estado, 200)
    const ge = await A.dono.pedir('POST', '/utilizadores', { nome: 'Carlos', nomeUtilizador: 'carlos', funcao: 'gestor', filiais: [A.filial], codigoSecreto: CODIGO_FUNC })
    gestorA = { id: ge.corpo.utilizador.id, nav: novo() }
    assert.equal((await entrar(gestorA.nav, A.codigo, 'carlos', CODIGO_FUNC)).estado, 200)
    const opb = await B.dono.pedir('POST', '/utilizadores', { nome: 'Ana B', nomeUtilizador: 'ana', funcao: 'operador', filiais: [B.filial], codigoSecreto: CODIGO_FUNC })
    assert.equal(opb.estado, 201, 'o mesmo nome "ana" noutra empresa')
    B.opId = opb.corpo.utilizador.id
  })

  after(async () => {
    await fechar()
    await base?.encerrar()
    await limparEmpresas(criadas)
  })

  test('registo: sem sessão; login antes da confirmação recusado; reenvio neutro; confirmação activa; depois cookie HttpOnly', async () => {
    const nav = novo()
    const codigoEmpresa = codigoEmpresaTeste()
    criadas.push(codigoEmpresa)
    const antes = email.mensagens.length
    const r = await nav.pedir('POST', '/autenticacao/registo', { codigoEmpresa, nomeEmpresa: 'Pendente', nome: 'Dono', nomeUtilizador: 'dono', email: 'c@exemplo.co.mz', codigoSecreto: CODIGO_DONO })
    assert.equal(r.estado, 201)
    assert.equal(r.setCookie, null)
    assert.equal(r.corpo.activacaoPendente, true)
    assert.ok(!r.texto.includes(CODIGO_DONO) && !r.texto.includes('ns_') && !r.texto.includes('ne_'))
    assert.equal((await nav.pedir('GET', '/autenticacao/sessao')).estado, 401, 'sem sessão depois do registo')
    const primeiro = await linkConfirmacao(antes)
    // Antes da confirmação: o login com o código certo é recusado e não há cookie.
    const cedo = await entrar(nav, codigoEmpresa, 'dono', CODIGO_DONO)
    assert.equal(cedo.estado, 403)
    assert.equal(cedo.corpo.erro.codigo, 'activacao_pendente')
    assert.equal(cedo.setCookie, null)
    assert.equal((await entrar(novo(), codigoEmpresa, 'dono', 'errado errado')).corpo.erro.codigo, 'credenciais_invalidas', 'código errado não revela o estado')
    // Reenvio: resposta igual para um registo pendente e para uma conta inexistente; o link anterior deixa de valer.
    const n = email.mensagens.length
    const pendente = await novo().pedir('POST', '/autenticacao/activacao/reenviar', { codigoEmpresa, nomeUtilizador: 'dono' })
    const inexistente = await novo().pedir('POST', '/autenticacao/activacao/reenviar', { codigoEmpresa, nomeUtilizador: 'ninguem' })
    assert.equal(pendente.estado, 202)
    assert.deepEqual(pendente.corpo, inexistente.corpo)
    const segundo = await linkConfirmacao(n)
    assert.equal((await novo().pedir('POST', '/autenticacao/email/confirmar', { token: primeiro })).corpo.erro.codigo, 'link_invalido')
    assert.deepEqual((await novo().pedir('POST', '/autenticacao/email/confirmar', { token: segundo })).corpo, { confirmado: true, contaActivada: true })
    assert.equal((await novo().pedir('POST', '/autenticacao/email/confirmar', { token: segundo })).corpo.erro.codigo, 'link_invalido', 'repetida')
    const l = await entrar(nav, codigoEmpresa, 'dono', CODIGO_DONO)
    assert.equal(l.estado, 200)
    assert.match(l.setCookie ?? '', /^nexo_sessao=ns_[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/)
    assert.deepEqual(Object.keys(l.corpo).sort(), ['emailRecuperacao', 'empresa', 'expiraEm', 'filiais', 'filialActual', 'utilizador'])
    assert.equal(l.corpo.emailRecuperacao.email, 'c@exemplo.co.mz')
  })

  test('pedidos que alteram dados sem X-Nexo-Cliente são recusados (CSRF)', async () => {
    const r = await fetch(`${url}/api/v1/autenticacao/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigoEmpresa: A.codigo, nomeUtilizador: 'dono', codigoSecreto: CODIGO_DONO }),
    })
    assert.equal(r.status, 403)
    assert.equal(((await r.json()) as { erro: { codigo: string } }).erro.codigo, 'pedido_nao_confiavel')
  })

  test('login: mensagens iguais para empresa, conta ou código errados; nomes iguais em empresas diferentes', async () => {
    const respostas = await Promise.all([
      entrar(novo(), 't-naoexiste', 'dono', CODIGO_DONO),
      entrar(novo(), A.codigo, 'ninguem', CODIGO_DONO),
      entrar(novo(), A.codigo, 'dono', 'código errado mesmo'),
    ])
    for (const r of respostas) {
      assert.equal(r.estado, 401)
      assert.equal(r.corpo.erro.codigo, 'credenciais_invalidas')
      assert.equal(r.corpo.erro.mensagem, respostas[0].corpo.erro.mensagem)
      assert.equal(r.setCookie, null)
    }
    const a = novo()
    const b = novo()
    const ra = await entrar(a, A.codigo, 'ana', CODIGO_FUNC)
    const rb = await entrar(b, B.codigo, 'ana', CODIGO_FUNC)
    assert.equal(ra.corpo.empresa.id, A.empresaId)
    assert.equal(rb.corpo.empresa.id, B.empresaId)
    assert.notEqual(ra.corpo.utilizador.id, rb.corpo.utilizador.id)
  })

  test('rotas protegidas: sem sessão 401; com sessão terminada 401 e o cookie é apagado', async () => {
    assert.equal((await novo().pedir('GET', '/utilizadores')).corpo.erro.codigo, 'nao_autenticado')
    const nav = novo()
    await entrar(nav, A.codigo, 'dono', CODIGO_DONO)
    const cookie = nav.cookie
    assert.equal((await nav.pedir('POST', '/autenticacao/sair')).estado, 204)
    nav.cookie = cookie // reutilizar o cookie antigo
    const r = await nav.pedir('GET', '/autenticacao/sessao')
    assert.equal(r.estado, 401)
    assert.equal(r.corpo.erro.codigo, 'sessao_terminada')
    assert.match(r.setCookie ?? '', /Max-Age=0/)
  })

  test('operador e gestor: as funções do proprietário são recusadas no servidor', async () => {
    for (const [nav, nome] of [
      [opA.nav, 'Operador'],
      [gestorA.nav, 'Gestor'],
    ] as const) {
      const tentativas = await Promise.all([
        nav.pedir('GET', '/utilizadores'),
        nav.pedir('POST', '/utilizadores', { nome: 'X', nomeUtilizador: 'intruso', funcao: 'proprietario', filiais: [], codigoSecreto: 'Um código qualquer 1' }),
        nav.pedir('PATCH', `/utilizadores/${opA.id}`, { funcao: 'proprietario' }),
        nav.pedir('POST', `/utilizadores/${opA.id}/desactivar`),
        nav.pedir('PUT', `/utilizadores/${opA.id}/codigo`, { codigoSecreto: 'Um código qualquer 1' }),
        nav.pedir('PATCH', '/empresa', { nome: 'Tomada' }),
        nav.pedir('PATCH', `/filiais/${A.filial}`, { nome: 'Tomada' }),
        nav.pedir('GET', '/auditoria'),
        nav.pedir('POST', '/autenticacao/email', { codigoActual: CODIGO_FUNC, email: 'x@exemplo.co.mz' }),
      ])
      for (const r of tentativas) {
        assert.equal(r.estado, 403, `${nome}: ${r.texto}`)
        assert.equal(r.corpo.erro.codigo, 'permissao_negada')
      }
      const ver = await nav.pedir('GET', '/empresa')
      assert.equal(ver.estado, 200, 'ver a empresa é permitido a todos')
    }
    const conta = await A.dono.pedir('GET', `/utilizadores/${opA.id}`)
    assert.equal(conta.corpo.utilizador.funcao, 'operador', 'nada mudou')
  })

  test('escolher outra empresa ou filial pelo pedido: recusado; campos de empresa no corpo: recusados', async () => {
    const r1 = await A.dono.pedir('GET', '/utilizadores', undefined, { 'X-Nexo-Empresa': B.empresaId })
    assert.equal(r1.estado, 403)
    assert.equal(r1.corpo.erro.codigo, 'empresa_nao_permitida')
    const r2 = await opA.nav.pedir('GET', '/empresa', undefined, { 'X-Nexo-Filial': B.filial })
    assert.equal(r2.estado, 403)
    assert.equal(r2.corpo.erro.codigo, 'filial_nao_permitida')
    const r3 = await A.dono.pedir('POST', '/utilizadores', { nome: 'X', nomeUtilizador: 'xx1', funcao: 'operador', filiais: [A.filial], codigoSecreto: 'Um código qualquer 1', empresaId: B.empresaId })
    assert.equal(r3.estado, 400)
    assert.equal(r3.corpo.erro.codigo, 'validacao')
    const r4 = await A.dono.pedir('GET', '/empresa', undefined, { 'X-Nexo-Empresa': A.empresaId })
    assert.equal(r4.estado, 200, 'indicar a própria empresa é aceite')
  })

  test('isolamento A/B pela API: contas e filiais de B "não existem" para o proprietário de A', async () => {
    const pedidos = await Promise.all([
      A.dono.pedir('GET', `/utilizadores/${B.opId}`),
      A.dono.pedir('PATCH', `/utilizadores/${B.opId}`, { funcao: 'gestor' }),
      A.dono.pedir('POST', `/utilizadores/${B.opId}/desactivar`),
      A.dono.pedir('PUT', `/utilizadores/${B.opId}/codigo`, { codigoSecreto: 'Tomada da conta B 1' }),
      A.dono.pedir('PATCH', `/filiais/${B.filial}`, { nome: 'Tomada' }),
    ])
    for (const r of pedidos) assert.equal(r.estado, 404, r.texto)
    const filialAlheia = await A.dono.pedir('PATCH', `/utilizadores/${opA.id}`, { filiais: [B.filial] })
    assert.equal(filialAlheia.estado, 422)
    const listaA = await A.dono.pedir('GET', '/utilizadores')
    assert.ok(listaA.corpo.utilizadores.every((u: { id: string }) => u.id !== B.opId))
    // B intacta: a operadora de B continua a entrar com o código original.
    assert.equal((await entrar(novo(), B.codigo, 'ana', CODIGO_FUNC)).estado, 200)
    const auditoriaB = await B.dono.pedir('GET', '/auditoria')
    assert.ok(auditoriaB.corpo.entradas.every((e: { autor: { id: string } | null }) => e.autor?.id !== undefined))
    assert.ok(!JSON.stringify(auditoriaB.corpo).includes(A.empresaId))
  })

  test('sem auto-promoção nem auto-desactivação; código de outro proprietário não se redefine', async () => {
    const eu = (await A.dono.pedir('GET', '/autenticacao/sessao')).corpo.utilizador.id
    assert.equal((await A.dono.pedir('PATCH', `/utilizadores/${eu}`, { funcao: 'gestor' })).corpo.erro.codigo, 'propria_conta')
    assert.equal((await A.dono.pedir('POST', `/utilizadores/${eu}/desactivar`)).corpo.erro.codigo, 'propria_conta')
    const outro = await A.dono.pedir('POST', '/utilizadores', { nome: 'Sócia', nomeUtilizador: 'socia', funcao: 'proprietario', filiais: [], codigoSecreto: 'Código da sócia 2026' })
    assert.equal(outro.estado, 201)
    const r = await A.dono.pedir('PUT', `/utilizadores/${outro.corpo.utilizador.id}/codigo`, { codigoSecreto: 'Tomada da sócia 2026' })
    assert.equal(r.estado, 403)
    assert.equal(r.corpo.erro.codigo, 'codigo_de_proprietario')
  })

  test('desactivação: a sessão aberta deixa de valer; login com o código certo diz "desactivada"', async () => {
    const criada = await A.dono.pedir('POST', '/utilizadores', { nome: 'Para desactivar', nomeUtilizador: 'sai', funcao: 'operador', filiais: [A.filial], codigoSecreto: CODIGO_FUNC })
    const nav = novo()
    assert.equal((await entrar(nav, A.codigo, 'sai', CODIGO_FUNC)).estado, 200)
    assert.equal((await A.dono.pedir('POST', `/utilizadores/${criada.corpo.utilizador.id}/desactivar`)).estado, 200)
    assert.equal((await nav.pedir('GET', '/autenticacao/sessao')).corpo.erro.codigo, 'sessao_terminada')
    const r = await entrar(novo(), A.codigo, 'sai', CODIGO_FUNC)
    assert.equal(r.estado, 403)
    assert.equal(r.corpo.erro.codigo, 'conta_desactivada')
    assert.equal((await entrar(novo(), A.codigo, 'sai', 'outro código errado')).corpo.erro.codigo, 'credenciais_invalidas')
  })

  test('redefinição do código: as sessões existentes terminam; o código antigo deixa de servir', async () => {
    const criada = await A.dono.pedir('POST', '/utilizadores', { nome: 'Redefinir', nomeUtilizador: 'redef', funcao: 'operador', filiais: [A.filial], codigoSecreto: CODIGO_FUNC })
    const nav = novo()
    await entrar(nav, A.codigo, 'redef', CODIGO_FUNC)
    const novoCodigo = 'Código novo do turno 3'
    segredosVistos.add(novoCodigo)
    const r = await A.dono.pedir('PUT', `/utilizadores/${criada.corpo.utilizador.id}/codigo`, { codigoSecreto: novoCodigo })
    assert.equal(r.estado, 200)
    assert.ok(!r.texto.includes(novoCodigo), 'a resposta não devolve o código')
    assert.equal((await nav.pedir('GET', '/autenticacao/sessao')).estado, 401)
    assert.equal((await entrar(novo(), A.codigo, 'redef', CODIGO_FUNC)).estado, 401)
    assert.equal((await entrar(novo(), A.codigo, 'redef', novoCodigo)).estado, 200)
  })

  test('recuperação pela API: resposta igual exista ou não a conta; link do e-mail define o novo código', async () => {
    const nav = novo()
    // registar() já confirmou o e-mail (a conta está activa e o e-mail de recuperação confirmado).
    const { codigoEmpresa } = await registar(nav, 'recupera')
    const antes = email.mensagens.length
    const inexistente = await novo().pedir('POST', '/autenticacao/recuperacao', { codigoEmpresa, nomeUtilizador: 'ninguem' })
    const existente = await novo().pedir('POST', '/autenticacao/recuperacao', { codigoEmpresa, nomeUtilizador: 'recupera' })
    assert.equal(inexistente.estado, 202)
    assert.deepEqual(existente.corpo, inexistente.corpo)
    const link = (await email.esperar(antes + 1)).at(-1)!
    assert.equal(link.finalidade, 'recuperar_acesso')
    const token = /token=(ne_[A-Za-z0-9_-]{43})/.exec(link.texto)![1]
    segredosVistos.add(token)
    assert.match(link.texto, /#\/recuperar-acesso\?token=ne_/, 'o token vai no fragmento do link')
    const fraco = await novo().pedir('POST', '/autenticacao/recuperacao/concluir', { token, codigoNovo: '12345678' })
    assert.equal(fraco.corpo.erro.codigo, 'validacao')
    const ok = await novo().pedir('POST', '/autenticacao/recuperacao/concluir', { token, codigoNovo: 'Novo código recuperado 1' })
    assert.equal(ok.estado, 200)
    assert.equal((await nav.pedir('GET', '/autenticacao/sessao')).estado, 401, 'a sessão aberta terminou')
    assert.equal((await novo().pedir('POST', '/autenticacao/recuperacao/concluir', { token, codigoNovo: 'Outro código qualquer 2' })).corpo.erro.codigo, 'link_invalido')
    assert.equal((await entrar(novo(), codigoEmpresa, 'recupera', 'Novo código recuperado 1')).estado, 200)
  })

  test('tentativas repetidas: 429 ao fim de 5 falhas, igual para contas existentes e inexistentes', async () => {
    const config = configTeste()
    const app = criarApp({ config, logger: criarLogger('silent'), base, email })
    const servidor = app.listen(0)
    await new Promise((r) => servidor.once('listening', r))
    const outro = new Navegador(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`)
    try {
      for (const utilizador of ['dono', 'naoexiste']) {
        const estados: number[] = []
        for (let i = 0; i < 6; i++) estados.push((await entrar(outro, A.codigo, utilizador, 'errado errado')).estado)
        assert.deepEqual(estados, [401, 401, 401, 401, 401, 429], utilizador)
        const bloqueado = await entrar(outro, A.codigo, utilizador, CODIGO_DONO)
        assert.equal(bloqueado.estado, 429, 'mesmo com o código certo, enquanto durar o bloqueio')
        assert.ok(Number(bloqueado.cabecalhos.get('retry-after')) > 0)
      }
    } finally {
      await new Promise<void>((r) => servidor.close(() => r()))
    }
  })

  test('alterações administrativas ficam na auditoria (conta usada, sem segredos)', async () => {
    const r = await A.dono.pedir('GET', '/auditoria?limite=200')
    assert.equal(r.estado, 200)
    const accoes = new Set(r.corpo.entradas.map((e: { accao: string }) => e.accao))
    for (const a of ['empresa.criada', 'utilizador.activado', 'utilizador.criado', 'utilizador.codigo_definido', 'utilizador.desactivado', 'utilizador.codigo_redefinido']) {
      assert.ok(accoes.has(a), `falta ${a}`)
    }
    for (const s of segredosVistos) assert.ok(!r.texto.includes(s), 'segredo na auditoria')
  })

  test('nenhum segredo nos logs: códigos, tokens de sessão e de e-mail, cookies', () => {
    const logs = linhasLog.join('\n')
    assert.ok(logs.length > 1000, 'há logs para verificar')
    for (const s of segredosVistos) assert.ok(!logs.includes(s), `segredo nos logs: ${s.slice(0, 6)}…`)
    assert.ok(!/ns_[A-Za-z0-9_-]{43}|ne_[A-Za-z0-9_-]{43}/.test(logs))
    assert.ok(!/@exemplo\.co\.mz/.test(logs.replace(/\*@exemplo\.co\.mz/g, '')), 'endereço de e-mail completo nos logs')
  })
})
