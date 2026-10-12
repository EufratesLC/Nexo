// Identidade e isolamento na base REAL (migrações 0005–0008), pelos serviços da API e por SQL directo.
// Cobre: registo atómico, login, sessões (expiração, inactividade, revogação), desactivação,
// redefinição do código, recuperação por e-mail e pelo suporte, privilégios e políticas por função,
// isolamento entre duas empresas, último proprietário, auditoria imutável e sem segredos.
import './verificacaoPrevia.js' // uma ligação de cada tipo antes de tudo (ver o ficheiro)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { AcessoBase } from '../../src/base/acesso.js'
import { contextoDaSessao, papelDaFuncao, type SessaoValidada } from '../../src/base/contexto.js'
import { criarEnvioEmailMemoria } from '../../src/email/envio.js'
import type { ErroApi } from '../../src/http/erros.js'
import { criarServicoAdministracao, type ServicoAdministracao } from '../../src/servicos/administracao.js'
import { criarServicoIdentidade, type ServicoIdentidade } from '../../src/servicos/identidade.js'
import { criarLogger } from '../../src/registo/logger.js'
import { gerarToken } from '../../src/autenticacao/tokens.js'
import {
  acessoTeste,
  admin,
  clienteApi,
  CODIGO_DONO,
  CODIGO_FUNC,
  codigoDoErro,
  codigoEmpresaTeste,
  comoDono,
  configTeste,
  limparEmpresas,
  motivoSalto,
} from './ajuda.js'

const email = criarEnvioEmailMemoria()
const config = configTeste()
const criadas: string[] = []
let base: AcessoBase
let identidade: ServicoIdentidade
let adm: ServicoAdministracao

const tokenDoLink = (texto: string) => /token=(ne_[A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? ''
const codigoApi = async (p: Promise<unknown>) => {
  try {
    await p
    return undefined
  } catch (e) {
    return (e as ErroApi).codigo ?? (e as { code?: string }).code ?? (e as Error).message
  }
}

/** Último link de confirmação enviado para este endereço (espera pelo envio, que é assíncrono). */
async function linkConfirmacaoPara(endereco: string, depoisDe: number): Promise<string> {
  const fim = Date.now() + 5000
  while (Date.now() < fim) {
    const m = email.mensagens.slice(depoisDe).filter((x) => x.finalidade === 'confirmar_email' && x.para === endereco.toLowerCase()).at(-1)
    if (m) return tokenDoLink(m.texto)
    await new Promise((res) => setTimeout(res, 20))
  }
  throw new Error(`sem link de confirmação para ${endereco}`)
}

/** Regista (conta pendente) e, por omissão, confirma o e-mail e entra (conta activa). */
async function registar(nomeUtilizador = 'dono', emailRec = 'dono@exemplo.co.mz', confirmar = true) {
  const codigoEmpresa = codigoEmpresaTeste()
  criadas.push(codigoEmpresa)
  const antes = email.mensagens.length
  await identidade.registar({ codigoEmpresa, nomeEmpresa: `TESTE ${codigoEmpresa}`, nome: 'Dono de Teste', nomeUtilizador, email: emailRec, codigoSecreto: CODIGO_DONO })
  if (!confirmar) return { codigoEmpresa, sessao: undefined as unknown as SessaoValidada, token: '' }
  assert.equal(await identidade.confirmarEmail(await linkConfirmacaoPara(emailRec, antes)), 'activada')
  const l = await entrarOk(codigoEmpresa, nomeUtilizador, CODIGO_DONO)
  return { codigoEmpresa, sessao: l.sessao, token: l.token }
}

async function entrarOk(codigoEmpresa: string, nomeUtilizador: string, codigoSecreto: string) {
  const r = await identidade.entrar({ codigoEmpresa, nomeUtilizador, codigoSecreto })
  assert.equal(r.tipo, 'ok', `login de ${nomeUtilizador}`)
  return r as { tipo: 'ok'; token: string; sessao: SessaoValidada }
}

/** SQL livre num papel de execução, com o contexto da sessão (como faria a API). */
function comoSessao<T>(s: SessaoValidada, sql: string, valores: unknown[] = []) {
  return base.executarTransaccao({ papel: papelDaFuncao(s.funcao), contexto: contextoDaSessao(s) }, async (c) => (await c.query(sql, valores)) as T)
}

describe('identidade na base real (0005–0008)', { skip: motivoSalto }, () => {
  let A: Awaited<ReturnType<typeof registar>>
  let B: Awaited<ReturnType<typeof registar>>
  let opA: { id: string; sessao: SessaoValidada; token: string }
  let gestorA: { id: string; sessao: SessaoValidada }

  before(async () => {
    base = acessoTeste(config)
    identidade = criarServicoIdentidade({ base, config, email, logger: criarLogger('silent') })
    adm = criarServicoAdministracao(base)
    A = await registar()
    B = await registar() // o MESMO nome de utilizador ("dono") noutra empresa
    const filialA = A.sessao.filiais[0]
    const op = await adm.criarUtilizador(A.sessao, { nome: 'Operadora A', nomeUtilizador: 'ana', funcao: 'operador', filiais: [filialA], codigoSecreto: CODIGO_FUNC })
    const ge = await adm.criarUtilizador(A.sessao, { nome: 'Gestor A', nomeUtilizador: 'carlos', funcao: 'gestor', filiais: [filialA], codigoSecreto: CODIGO_FUNC })
    const l = await entrarOk(A.codigoEmpresa, 'ana', CODIGO_FUNC)
    opA = { id: op.id, sessao: l.sessao, token: l.token }
    gestorA = { id: ge.id, sessao: (await entrarOk(A.codigoEmpresa, 'carlos', CODIGO_FUNC)).sessao }
  })

  after(async () => {
    await base?.encerrar()
    await limparEmpresas(criadas)
  })

  test('registo: empresa, filial F01, proprietário, código (só resumo); confirmação activa a conta; auditoria', async () => {
    const r = await comoDono(async (c) => {
      const e = (await c.query('SELECT id FROM nexo.empresas WHERE codigo = $1', [A.codigoEmpresa])).rows[0]
      return {
        filiais: (await c.query('SELECT codigo FROM nexo.filiais WHERE empresa_id = $1', [e.id])).rows.map((x) => x.codigo),
        dono: (await c.query("SELECT funcao, estado FROM nexo.utilizadores WHERE empresa_id = $1 AND nome_utilizador = 'dono'", [e.id])).rows[0],
        credencial: (await c.query("SELECT algoritmo, parametros, octet_length(sal) AS sal, octet_length(resumo) AS resumo FROM nexo.credenciais_acesso c JOIN nexo.utilizadores u ON u.id = c.utilizador_id WHERE u.empresa_id = $1 AND u.nome_utilizador = 'dono'", [e.id])).rows[0],
        contacto: (await c.query('SELECT email, email_pendente FROM nexo.contactos_recuperacao WHERE empresa_id = $1', [e.id])).rows[0],
        auditoria: (await c.query('SELECT accao FROM nexo.registo_auditoria WHERE empresa_id = $1 ORDER BY accao', [e.id])).rows.map((x) => x.accao),
      }
    })
    assert.deepEqual(r.filiais, ['F01'])
    assert.deepEqual(r.dono, { funcao: 'proprietario', estado: 'activo' })
    assert.deepEqual(r.credencial, { algoritmo: 'scrypt', parametros: 'ln=15,r=8,p=3', sal: 16, resumo: 32 })
    // O ajudante registar() já confirmou o e-mail, o que activou a conta (0008).
    assert.deepEqual(r.contacto, { email: 'dono@exemplo.co.mz', email_pendente: null })
    assert.deepEqual(r.dono, { funcao: 'proprietario', estado: 'activo' })
    for (const a of ['empresa.criada', 'utilizador.criado', 'utilizador.email_confirmado', 'utilizador.activado']) assert.ok(r.auditoria.includes(a), a)
  })

  test('registo sem registos parciais: código repetido (409) e falha a meio desfazem tudo', async () => {
    const antes = await comoDono(async (c) => (await c.query('SELECT count(*)::int AS n FROM nexo.empresas')).rows[0].n)
    assert.equal(
      await codigoApi(identidade.registar({ codigoEmpresa: A.codigoEmpresa, nomeEmpresa: 'Outra', nome: 'X', nomeUtilizador: 'outro', email: 'x@exemplo.co.mz', codigoSecreto: CODIGO_DONO })),
      'codigo_empresa_indisponivel',
    )
    // Falha na TERCEIRA inserção (nome de utilizador inválido), depois de criar empresa e filial.
    const codigo = codigoEmpresaTeste()
    criadas.push(codigo)
    const c = await clienteApi()
    try {
      const t = gerarToken('email')
      assert.equal(
        await codigoDoErro(
          c.query("SELECT * FROM nexo.registar_empresa($1, 'Parcial', null, null, 'X', 'NOME INVALIDO!', 'p@exemplo.co.mz', 'ln=15,r=8,p=3', $2, $3, $4, '1 day')", [
            codigo,
            Buffer.alloc(16, 1),
            Buffer.alloc(32, 2),
            t.resumo,
          ]),
        ),
        '23514',
      )
    } finally {
      await c.end()
    }
    const depois = await comoDono(async (c2) => ({
      n: (await c2.query('SELECT count(*)::int AS n FROM nexo.empresas')).rows[0].n,
      parcial: (await c2.query('SELECT count(*)::int AS n FROM nexo.empresas WHERE codigo = $1', [codigo])).rows[0].n,
    }))
    assert.deepEqual(depois, { n: antes, parcial: 0 })
  })

  test('login: o mesmo nome de utilizador em duas empresas; a empresa vem do código, nunca se cruza', async () => {
    const a = await entrarOk(A.codigoEmpresa, 'dono', CODIGO_DONO)
    const b = await entrarOk(B.codigoEmpresa, 'DONO', CODIGO_DONO) // maiúsculas no nome: normalizado
    assert.notEqual(a.sessao.empresaId, b.sessao.empresaId)
    assert.notEqual(a.sessao.utilizadorId, b.sessao.utilizadorId)
    assert.equal((await identidade.entrar({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'ana', codigoSecreto: CODIGO_DONO })).tipo, 'invalido')
    assert.equal((await identidade.entrar({ codigoEmpresa: B.codigoEmpresa, nomeUtilizador: 'ana', codigoSecreto: CODIGO_FUNC })).tipo, 'invalido', 'ana só existe em A')
    assert.equal((await identidade.entrar({ codigoEmpresa: 't-naoexiste', nomeUtilizador: 'dono', codigoSecreto: CODIGO_DONO })).tipo, 'invalido')
    assert.equal((await identidade.entrar({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'dono', codigoSecreto: CODIGO_DONO + ' ' })).tipo, 'invalido', 'espaço final conta')
  })

  test('sessão: só o SHA-256 do token na base; terminar, expirar e inactividade invalidam', async () => {
    const s = await entrarOk(A.codigoEmpresa, 'dono', CODIGO_DONO)
    const guardado = await comoDono(async (c) => (await c.query('SELECT resumo_token FROM nexo.sessoes WHERE id = $1', [s.sessao.sessaoId])).rows[0].resumo_token as Buffer)
    assert.ok(guardado.equals(createHash('sha256').update(s.token).digest()))
    assert.ok(await identidade.validarSessao(s.token))
    await identidade.terminarSessao(s.token)
    assert.equal(await identidade.validarSessao(s.token), null, 'terminada')

    const e = await entrarOk(A.codigoEmpresa, 'dono', CODIGO_DONO)
    await comoDono((c) => c.query("UPDATE nexo.sessoes SET expira_em = now() - interval '1 second' WHERE id = $1", [e.sessao.sessaoId]))
    assert.equal(await identidade.validarSessao(e.token), null, 'expirada')

    const i = await entrarOk(A.codigoEmpresa, 'dono', CODIGO_DONO)
    await comoDono((c) => c.query('UPDATE nexo.sessoes SET ultimo_uso_em = now() - inactividade - interval \'1 second\' WHERE id = $1', [i.sessao.sessaoId]))
    assert.equal(await identidade.validarSessao(i.token), null, 'inactiva')
    assert.equal(await identidade.validarSessao('ns_' + 'x'.repeat(43)), null, 'token desconhecido')
  })

  test('desactivação: termina as sessões; login certo diz "desactivado", errado diz "invalido"; reactivar não ressuscita sessões', async () => {
    const op = await adm.criarUtilizador(A.sessao, { nome: 'Temporário', nomeUtilizador: 'temp', funcao: 'operador', filiais: [...A.sessao.filiais], codigoSecreto: CODIGO_FUNC })
    const l = await entrarOk(A.codigoEmpresa, 'temp', CODIGO_FUNC)
    await adm.desactivarUtilizador(A.sessao, op.id)
    assert.equal(await identidade.validarSessao(l.token), null)
    assert.equal((await identidade.entrar({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'temp', codigoSecreto: CODIGO_FUNC })).tipo, 'desactivado')
    assert.equal((await identidade.entrar({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'temp', codigoSecreto: 'errado errado' })).tipo, 'invalido')
    await adm.reactivarUtilizador(A.sessao, op.id)
    assert.equal(await identidade.validarSessao(l.token), null, 'a sessão antiga continua revogada')
    await entrarOk(A.codigoEmpresa, 'temp', CODIGO_FUNC)
  })

  test('redefinição pelo proprietário: sessões revogadas, código antigo deixa de servir, auditoria sem segredos', async () => {
    const op = await adm.criarUtilizador(A.sessao, { nome: 'Redefinir', nomeUtilizador: 'redef', funcao: 'operador', filiais: [...A.sessao.filiais], codigoSecreto: CODIGO_FUNC })
    const l = await entrarOk(A.codigoEmpresa, 'redef', CODIGO_FUNC)
    const novo = 'Novo código do balcão 2'
    await adm.definirCodigo(A.sessao, op.id, novo)
    assert.equal(await identidade.validarSessao(l.token), null)
    assert.equal((await identidade.entrar({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'redef', codigoSecreto: CODIGO_FUNC })).tipo, 'invalido')
    await entrarOk(A.codigoEmpresa, 'redef', novo)
    const auditoria = await comoDono(async (c) => (await c.query('SELECT accao, antes, depois FROM nexo.registo_auditoria WHERE entidade_id = $1', [op.id])).rows)
    assert.ok(auditoria.some((x) => x.accao === 'utilizador.codigo_redefinido'))
    const texto = JSON.stringify(auditoria)
    for (const segredo of [novo, CODIGO_FUNC, 'resumo', 'sal']) assert.ok(!texto.includes(segredo), `auditoria contém ${segredo}`)
  })

  test('alterar o próprio código: exige o actual; as OUTRAS sessões terminam, a actual continua', async () => {
    const op = await adm.criarUtilizador(A.sessao, { nome: 'Próprio', nomeUtilizador: 'proprio', funcao: 'operador', filiais: [...A.sessao.filiais], codigoSecreto: CODIGO_FUNC })
    assert.ok(op.id)
    const s1 = await entrarOk(A.codigoEmpresa, 'proprio', CODIGO_FUNC)
    const s2 = await entrarOk(A.codigoEmpresa, 'proprio', CODIGO_FUNC)
    assert.equal(await identidade.alterarCodigoProprio(s1.sessao, 'errado errado', 'Outro código seguro'), false)
    assert.equal(await identidade.alterarCodigoProprio(s1.sessao, CODIGO_FUNC, 'Outro código seguro'), true)
    assert.ok(await identidade.validarSessao(s1.token))
    assert.equal(await identidade.validarSessao(s2.token), null)
    await entrarOk(A.codigoEmpresa, 'proprio', 'Outro código seguro')
  })

  test('operador: não cria contas, não muda a função, não lê credenciais, sessões nem outras contas', async () => {
    const s = opA.sessao
    assert.equal(await codigoDoErro(comoSessao(s, "INSERT INTO nexo.utilizadores (empresa_id, nome_utilizador, nome, funcao, criado_por) VALUES ($1, 'intruso', 'X', 'proprietario', $2)", [s.empresaId, s.utilizadorId])), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, "UPDATE nexo.utilizadores SET funcao = 'proprietario' WHERE id = $1", [s.utilizadorId])), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT nexo.definir_codigo($1, $2, $3, $4)', [s.utilizadorId, 'ln=15,r=8,p=3', Buffer.alloc(16), Buffer.alloc(32)])), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT * FROM nexo.credenciais_acesso')), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT * FROM nexo.sessoes')), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT * FROM nexo.registo_auditoria')), '42501')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT * FROM nexo.contactos_recuperacao')), '42501')
    const visiveis = await comoSessao<{ rows: { id: string }[] }>(s, 'SELECT id FROM nexo.utilizadores')
    assert.deepEqual(visiveis.rows.map((r) => r.id), [s.utilizadorId], 'só a própria conta')
  })

  test('gestor: as políticas exigem o proprietário (criar, alterar, definir códigos, ver auditoria)', async () => {
    const s = gestorA.sessao
    assert.equal(await codigoDoErro(comoSessao(s, "INSERT INTO nexo.utilizadores (empresa_id, nome_utilizador, nome, funcao, criado_por) VALUES ($1, 'intruso', 'X', 'operador', $2)", [s.empresaId, s.utilizadorId])), '42501')
    const r = await comoSessao<{ rowCount: number }>(s, "UPDATE nexo.utilizadores SET funcao = 'proprietario' WHERE id = $1", [opA.id])
    assert.equal(r.rowCount, 0, 'UPDATE sem efeito: a política não deixa ver a linha para alterar')
    const auto = await comoSessao<{ rowCount: number }>(s, "UPDATE nexo.utilizadores SET funcao = 'proprietario' WHERE id = $1", [s.utilizadorId])
    assert.equal(auto.rowCount, 0, 'auto-promoção')
    assert.equal(await codigoDoErro(comoSessao(s, 'SELECT nexo.definir_codigo($1, $2, $3, $4)', [opA.id, 'ln=15,r=8,p=3', Buffer.alloc(16), Buffer.alloc(32)])), '42501')
    assert.equal((await comoSessao<{ rowCount: number }>(s, 'SELECT 1 FROM nexo.registo_auditoria')).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(s, "UPDATE nexo.empresas SET nome = 'Tomada'")).rowCount, 0)
  })

  test('proprietário: não altera a própria conta na base (sem auto-despromoção nem auto-desactivação)', async () => {
    const r = await comoSessao<{ rowCount: number }>(A.sessao, "UPDATE nexo.utilizadores SET estado = 'desactivado', desactivado_em = now() WHERE id = $1", [A.sessao.utilizadorId])
    assert.equal(r.rowCount, 0)
    assert.equal(await codigoDoErro(comoSessao(A.sessao, 'SELECT nexo.definir_codigo($1, $2, $3, $4)', [A.sessao.utilizadorId, 'ln=15,r=8,p=3', Buffer.alloc(16), Buffer.alloc(32)])), '42501')
  })

  test('isolamento A/B: leitura e escrita de outra empresa falham na base, mesmo com identificadores certos', async () => {
    const sA = A.sessao
    const contasB = await comoDono(async (c) => (await c.query("SELECT u.id FROM nexo.utilizadores u JOIN nexo.empresas e ON e.id = u.empresa_id WHERE e.codigo = $1", [B.codigoEmpresa])).rows.map((x) => x.id as string))
    const donoB = contasB[0]
    assert.equal((await comoSessao<{ rowCount: number }>(sA, 'SELECT 1 FROM nexo.utilizadores WHERE id = $1', [donoB])).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(sA, 'SELECT 1 FROM nexo.empresas WHERE id = $1', [B.sessao.empresaId])).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(sA, 'SELECT 1 FROM nexo.filiais WHERE id = $1', [B.sessao.filiais[0]])).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(sA, "UPDATE nexo.utilizadores SET funcao = 'gestor' WHERE id = $1", [donoB])).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(sA, "UPDATE nexo.empresas SET nome = 'Tomada' WHERE id = $1", [B.sessao.empresaId])).rowCount, 0)
    assert.equal((await comoSessao<{ rowCount: number }>(sA, "UPDATE nexo.filiais SET nome = 'Tomada' WHERE id = $1", [B.sessao.filiais[0]])).rowCount, 0)
    assert.equal(
      await codigoDoErro(comoSessao(sA, "INSERT INTO nexo.utilizadores (empresa_id, nome_utilizador, nome, funcao, criado_por) VALUES ($1, 'intruso', 'X', 'operador', $2)", [B.sessao.empresaId, sA.utilizadorId])),
      '42501',
    )
    // Uma filial de B não pode ser atribuída a uma conta de A (chave composta), mesmo com o id certo.
    assert.equal(await codigoDoErro(comoSessao(sA, 'INSERT INTO nexo.utilizador_filiais (empresa_id, utilizador_id, filial_id) VALUES ($1, $2, $3)', [sA.empresaId, opA.id, B.sessao.filiais[0]])), '23503')
    assert.equal(await codigoDoErro(comoSessao(sA, 'SELECT nexo.definir_codigo($1, $2, $3, $4)', [donoB, 'ln=15,r=8,p=3', Buffer.alloc(16), Buffer.alloc(32)])), 'P0002')
    assert.equal((await comoSessao<{ rows: { n: number }[] }>(sA, "SELECT nexo.revogar_sessoes($1, 'desactivacao') AS n", [donoB])).rows[0].n, 0)
    // Pelo serviço (como a API): a conta de B "não existe" em A.
    assert.equal(await codigoApi(adm.obterUtilizador(sA, donoB)), 'nao_encontrado')
    assert.equal(await codigoApi(adm.desactivarUtilizador(sA, donoB)), 'nao_encontrado')
    assert.equal(await codigoApi(adm.alterarUtilizador(sA, opA.id, { filiais: [B.sessao.filiais[0]] })), 'filial_invalida')
    const listaA = await adm.listarUtilizadores(sA)
    assert.ok(listaA.every((u) => !contasB.includes(u.id)))
    // B continua intacta.
    await entrarOk(B.codigoEmpresa, 'dono', CODIGO_DONO)
  })

  test('último proprietário: dois proprietários a desactivarem-se em simultâneo — só um consegue', async () => {
    const r = await registar('dona1')
    const segundo = await adm.criarUtilizador(r.sessao, { nome: 'Dona 2', nomeUtilizador: 'dona2', funcao: 'proprietario', filiais: [], codigoSecreto: CODIGO_DONO })
    const s2 = (await entrarOk(r.codigoEmpresa, 'dona2', CODIGO_DONO)).sessao
    const resultados = await Promise.allSettled([adm.desactivarUtilizador(r.sessao, segundo.id), adm.desactivarUtilizador(s2, r.sessao.utilizadorId)])
    assert.equal(resultados.filter((x) => x.status === 'fulfilled').length, 1, JSON.stringify(resultados.map((x) => x.status)))
    const falha = resultados.find((x) => x.status === 'rejected') as PromiseRejectedResult
    assert.equal((falha.reason as ErroApi).codigo, 'ultimo_proprietario')
    const activos = await comoDono(async (c) => (await c.query("SELECT count(*)::int AS n FROM nexo.utilizadores WHERE empresa_id = $1 AND funcao = 'proprietario' AND estado = 'activo'", [r.sessao.empresaId])).rows[0].n)
    assert.equal(activos, 1)
    // Directamente na base, como dono das tabelas: o trigger recusa ficar sem proprietário.
    assert.equal(
      await codigoDoErro(comoDono((c) => c.query("UPDATE nexo.utilizadores SET funcao = 'gestor' WHERE empresa_id = $1 AND funcao = 'proprietario' AND estado = 'activo'", [r.sessao.empresaId]))),
      '23514',
    )
  })

  test('e-mail de recuperação: confirmação por link de utilização única', async () => {
    email.mensagens.length = 0
    const r = await registar('confirma', 'Confirma@Exemplo.co.mz', false)
    const [m] = await email.esperar(1)
    assert.equal(m.para, 'confirma@exemplo.co.mz')
    assert.equal(m.finalidade, 'confirmar_email')
    const token = tokenDoLink(m.texto)
    assert.ok(token)
    assert.equal(await identidade.confirmarEmail(token), 'activada')
    assert.equal(await identidade.confirmarEmail(token), 'invalido', 'utilização única')
    const sessao = (await entrarOk(r.codigoEmpresa, 'confirma', CODIGO_DONO)).sessao
    const resumo = await adm.resumoSessao(sessao)
    assert.equal(resumo.emailRecuperacao?.email, 'confirma@exemplo.co.mz')
    assert.equal(resumo.emailRecuperacao?.emailPendente, null)
    // O token guardado é o resumo, não o token.
    const guardados = await comoDono(async (c) => (await c.query('SELECT resumo_token FROM nexo.tokens_email WHERE empresa_id = $1', [sessao.empresaId])).rows)
    assert.ok(guardados.every((g) => !(g.resumo_token as Buffer).toString('utf8').includes(token)))
  })

  test('recuperação por e-mail: só proprietário com e-mail confirmado; link único, com prazo; revoga sessões', async () => {
    email.mensagens.length = 0
    const r = await registar('recupera', 'recupera@exemplo.co.mz', false)
    const [conf] = await email.esperar(1)
    // Registo pendente (sem e-mail confirmado): nada é enviado.
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'recupera' })
    await new Promise((res) => setTimeout(res, 200))
    assert.equal(email.mensagens.length, 1)
    assert.equal(await identidade.confirmarEmail(tokenDoLink(conf.texto)), 'activada')
    // Conta inexistente e operador: nada é enviado.
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'naoexiste' })
    await identidade.pedirRecuperacao({ codigoEmpresa: A.codigoEmpresa, nomeUtilizador: 'ana' })
    await new Promise((res) => setTimeout(res, 200))
    assert.equal(email.mensagens.length, 1)
    // Proprietário com e-mail confirmado: link. Um segundo pedido invalida o primeiro.
    const sessaoAberta = await entrarOk(r.codigoEmpresa, 'recupera', CODIGO_DONO)
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'recupera' })
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'recupera' })
    const msgs = await email.esperar(3)
    const [primeiro, segundo] = [tokenDoLink(msgs[1].texto), tokenDoLink(msgs[2].texto)]
    assert.equal(msgs[1].para, 'recupera@exemplo.co.mz')
    assert.equal(await identidade.concluirRecuperacao(primeiro, 'Código recuperado 1'), false, 'o primeiro link foi invalidado')
    assert.equal(await identidade.concluirRecuperacao(segundo, 'Código recuperado 2'), true)
    assert.equal(await identidade.concluirRecuperacao(segundo, 'Código recuperado 3'), false, 'utilização única')
    assert.equal(await identidade.validarSessao(sessaoAberta.token), null, 'sessões revogadas')
    assert.equal((await identidade.entrar({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'recupera', codigoSecreto: CODIGO_DONO })).tipo, 'invalido')
    await entrarOk(r.codigoEmpresa, 'recupera', 'Código recuperado 2')
    const aviso = await email.esperar(4)
    assert.equal(aviso[3].finalidade, 'aviso_codigo_alterado')
    // Link expirado.
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'recupera' })
    const expirado = tokenDoLink((await email.esperar(5))[4].texto)
    await comoDono((c) => c.query("UPDATE nexo.tokens_email SET expira_em = now() - interval '1 second' WHERE empresa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL", [sessaoAberta.sessao.empresaId]))
    assert.equal(await identidade.concluirRecuperacao(expirado, 'Código recuperado 4'), false, 'expirado')
  })

  test('registo: a conta nasce pendente e sem sessão; login (pelo serviço e por SQL directo) não cria sessão', async () => {
    const r = await registar('pendente', 'pendente@exemplo.co.mz', false)
    const estado = await comoDono(async (c) => ({
      conta: (await c.query("SELECT u.estado FROM nexo.utilizadores u JOIN nexo.empresas e ON e.id = u.empresa_id WHERE e.codigo = $1", [r.codigoEmpresa])).rows[0].estado,
      sessoes: (await c.query('SELECT count(*)::int AS n FROM nexo.sessoes s JOIN nexo.empresas e ON e.id = s.empresa_id WHERE e.codigo = $1', [r.codigoEmpresa])).rows[0].n,
    }))
    assert.deepEqual(estado, { conta: 'pendente', sessoes: 0 })
    assert.equal((await identidade.entrar({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'pendente', codigoSecreto: CODIGO_DONO })).tipo, 'pendente')
    assert.equal((await identidade.entrar({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'pendente', codigoSecreto: 'errado errado' })).tipo, 'invalido', 'o estado só aparece com o código certo')
    // Directamente na base, como nexo_api, com o resumo certo: a função não cria a sessão.
    const c = await clienteApi()
    try {
      const p = (await c.query("SELECT parametros, sal FROM nexo.parametros_acesso($1, 'pendente')", [r.codigoEmpresa])).rows[0]
      const { calcularResumo } = await import('../../src/autenticacao/codigoSecreto.js')
      const resumo = await calcularResumo(CODIGO_DONO, p.sal, p.parametros)
      const t = gerarToken('sessao')
      const linha = (await c.query("SELECT resultado, sessao_id FROM nexo.iniciar_sessao($1, 'pendente', $2, $3, '1 hour', '1 hour')", [r.codigoEmpresa, resumo, t.resumo])).rows[0]
      assert.deepEqual(linha, { resultado: 'pendente', sessao_id: null })
      assert.equal(await identidade.validarSessao(t.token), null)
      // Mesmo um registo feito directamente por registar_empresa (0007) fica pendente (trigger da 0008).
      const outro = codigoEmpresaTeste()
      criadas.push(outro)
      await c.query("SELECT * FROM nexo.registar_empresa($1, 'Directo', null, null, 'X', 'directo', 'd@exemplo.co.mz', 'ln=15,r=8,p=3', $2, $3, $4, '1 day')", [
        outro,
        Buffer.alloc(16, 1),
        Buffer.alloc(32, 2),
        gerarToken('email').resumo,
      ])
      const e2 = await comoDono(async (a) => (await a.query("SELECT u.estado FROM nexo.utilizadores u JOIN nexo.empresas e ON e.id = u.empresa_id WHERE e.codigo = $1", [outro])).rows[0].estado)
      assert.equal(e2, 'pendente')
    } finally {
      await c.end()
    }
    // Recuperação de um registo pendente: nada é enviado.
    const antes = email.mensagens.length
    await identidade.pedirRecuperacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'pendente' })
    await new Promise((res) => setTimeout(res, 200))
    assert.equal(email.mensagens.length, antes)
  })

  test('confirmação: expirada não activa; reenvio invalida o link anterior; válida activa; repetida recusa; depois o login funciona', async () => {
    const antes = email.mensagens.length
    const r = await registar('activa', 'activa@exemplo.co.mz', false)
    const primeiro = await linkConfirmacaoPara('activa@exemplo.co.mz', antes)
    await comoDono((c) =>
      c.query("UPDATE nexo.tokens_email SET expira_em = now() - interval '1 second' WHERE empresa_id = (SELECT id FROM nexo.empresas WHERE codigo = $1)", [r.codigoEmpresa]),
    )
    assert.equal(await identidade.confirmarEmail(primeiro), 'invalido', 'expirado')
    assert.equal((await identidade.entrar({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'activa', codigoSecreto: CODIGO_DONO })).tipo, 'pendente')
    const n1 = email.mensagens.length
    await identidade.reenviarActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'activa' })
    const segundo = await linkConfirmacaoPara('activa@exemplo.co.mz', n1)
    const n2 = email.mensagens.length
    await identidade.reenviarActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'ACTIVA' })
    const terceiro = await linkConfirmacaoPara('activa@exemplo.co.mz', n2)
    assert.equal(await identidade.confirmarEmail(segundo), 'invalido', 'o reenvio invalida o link anterior')
    assert.equal(await identidade.confirmarEmail(terceiro), 'activada')
    assert.equal(await identidade.confirmarEmail(terceiro), 'invalido', 'repetida')
    await entrarOk(r.codigoEmpresa, 'activa', CODIGO_DONO)
    // Conta já activa ou inexistente: o reenvio não envia nada.
    const n3 = email.mensagens.length
    await identidade.reenviarActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'activa' })
    await identidade.reenviarActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'ninguem' })
    await new Promise((res) => setTimeout(res, 200))
    assert.equal(email.mensagens.length, n3)
    const auditoria = await comoDono(async (c) =>
      (await c.query("SELECT accao FROM nexo.registo_auditoria WHERE empresa_id = (SELECT id FROM nexo.empresas WHERE codigo = $1) ORDER BY criado_em", [r.codigoEmpresa])).rows.map((x) => x.accao),
    )
    assert.ok(auditoria.includes('utilizador.activado') && auditoria.includes('utilizador.email_confirmado'))
  })

  test('reenvio limitado também na base (5 links por hora por conta); correcção do e-mail exige o código', async () => {
    const antes = email.mensagens.length
    const r = await registar('limite', 'erro@exemplo.co.mz', false)
    await linkConfirmacaoPara('erro@exemplo.co.mz', antes)
    for (let i = 0; i < 6; i++) await identidade.reenviarActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'limite' })
    await new Promise((res) => setTimeout(res, 300))
    const tokens = await comoDono(async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM nexo.tokens_email WHERE finalidade = 'confirmar_email' AND empresa_id = (SELECT id FROM nexo.empresas WHERE codigo = $1)", [r.codigoEmpresa])).rows[0].n,
    )
    assert.equal(tokens, 5, 'registo + 4 reenvios; os restantes recusados pela base')
    assert.equal(email.mensagens.length - antes, 5)
    // Correcção do e-mail: código errado recusa; certo… também recusa enquanto o limite da base durar.
    assert.equal(await identidade.corrigirEmailActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'limite', codigoSecreto: 'errado errado', email: 'certo@exemplo.co.mz' }), false)
    assert.equal(await identidade.corrigirEmailActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'limite', codigoSecreto: CODIGO_DONO, email: 'certo@exemplo.co.mz' }), false, 'limite')
    // Passada a hora (simulado), a correcção com o código certo envia para o novo e-mail; o antigo deixa de valer.
    await comoDono((c) =>
      c.query("UPDATE nexo.tokens_email SET criado_em = criado_em - interval '2 hours' WHERE empresa_id = (SELECT id FROM nexo.empresas WHERE codigo = $1)", [r.codigoEmpresa]),
    )
    const n = email.mensagens.length
    assert.equal(await identidade.corrigirEmailActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'limite', codigoSecreto: CODIGO_DONO, email: 'Certo@exemplo.co.mz' }), true)
    const novo = await linkConfirmacaoPara('certo@exemplo.co.mz', n)
    assert.equal(await identidade.confirmarEmail(novo), 'activada')
    const sessao = (await entrarOk(r.codigoEmpresa, 'limite', CODIGO_DONO)).sessao
    assert.equal((await adm.resumoSessao(sessao)).emailRecuperacao?.email, 'certo@exemplo.co.mz')
    assert.equal(await identidade.corrigirEmailActivacao({ codigoEmpresa: r.codigoEmpresa, nomeUtilizador: 'limite', codigoSecreto: CODIGO_DONO, email: 'x@exemplo.co.mz' }), false, 'conta já activa')
  })

  test('recuperação assistida pelo suporte: só nexo_proprietario (administrador) emite; nexo_api não', async () => {
    const r = await registar('suporte')
    const t = gerarToken('email')
    const c = await clienteApi()
    try {
      assert.equal(await codigoDoErro(c.query("SELECT * FROM nexo.suporte_emitir_recuperacao($1, 'suporte', $2, '1 hour', 'tentativa sem autorização')", [r.codigoEmpresa, t.resumo])), '42501')
    } finally {
      await c.end()
    }
    await admin(async (a) => {
      await a.query('BEGIN')
      await a.query('SET LOCAL ROLE nexo_proprietario')
      await a.query("SELECT * FROM nexo.suporte_emitir_recuperacao($1, 'suporte', $2, '1 hour', 'Identidade confirmada presencialmente com BI')", [r.codigoEmpresa, t.resumo])
      await a.query('COMMIT')
    })
    assert.equal(await identidade.concluirRecuperacao(t.token, 'Código dado pelo suporte'), true)
    await entrarOk(r.codigoEmpresa, 'suporte', 'Código dado pelo suporte')
    const reg = await comoDono(async (a) => (await a.query("SELECT autor_id, origem, depois FROM nexo.registo_auditoria WHERE empresa_id = $1 AND accao = 'utilizador.recuperacao_suporte'", [r.sessao.empresaId])).rows[0])
    assert.equal(reg.autor_id, null)
    assert.equal(reg.origem, 'suporte')
    assert.match(reg.depois.motivo, /presencialmente/)
  })

  test('nexo_api sem contexto: só executa as funções previstas e não lê nada de identidade', async () => {
    const c = await clienteApi()
    try {
      for (const t of ['credenciais_acesso', 'sessoes', 'tokens_email', 'utilizadores', 'contactos_recuperacao', 'registo_auditoria']) {
        assert.equal(await codigoDoErro(c.query(`SELECT 1 FROM nexo.${t}`)), '42501', t)
      }
      assert.equal(await codigoDoErro(c.query('SET ROLE nexo_autenticacao')), '42501')
      assert.equal(await codigoDoErro(c.query("SELECT nexo.definir_codigo(gen_random_uuid(), 'ln=15,r=8,p=3', '\\x00'::bytea, '\\x00'::bytea)")), '42501')
      assert.equal(await codigoDoErro(c.query('SELECT * FROM nexo.parametros_acesso_proprios()')), '42501')
      const colunas = await c.query("SELECT * FROM nexo.parametros_acesso($1, 'dono')", [A.codigoEmpresa])
      assert.deepEqual(colunas.fields.map((f) => f.name), ['parametros', 'sal'], 'nunca devolve o resumo')
    } finally {
      await c.end()
    }
  })

  test('auditoria imutável: sem privilégio para a gestão; o trigger recusa até ao dono das tabelas', async () => {
    assert.equal(await codigoDoErro(comoSessao(A.sessao, "UPDATE nexo.registo_auditoria SET accao = 'x.y'")), '42501')
    assert.equal(await codigoDoErro(comoSessao(A.sessao, 'DELETE FROM nexo.registo_auditoria')), '42501')
    assert.equal(await codigoDoErro(comoDono((c) => c.query("UPDATE nexo.registo_auditoria SET accao = 'x.y' WHERE empresa_id = $1", [A.sessao.empresaId]))), '42501')
  })

  test('verificação do catálogo: OK, e detecta privilégios indevidos (mutações revertidas)', async () => {
    const sql = readFileSync(join(import.meta.dirname, '..', '..', 'migracoes', 'verificacoes.sql'), 'utf8')
    await admin(async (c) => {
      assert.deepEqual((await c.query(sql)).rows, [])
      for (const [mutacao, esperado] of [
        ['GRANT SELECT ON nexo.credenciais_acesso TO nexo_gestao', 'tabela_de_identidade_acessivel'],
        ['GRANT UPDATE (estado) ON nexo.utilizadores TO nexo_operador', 'operador_escreve_em_identidade'],
        ['ALTER TABLE nexo.registo_auditoria DISABLE TRIGGER registo_auditoria_imutavel', 'auditoria_sem_trigger_de_imutabilidade'],
        ['GRANT nexo_autenticacao TO nexo_api WITH INHERIT FALSE, SET TRUE', 'papel_autenticacao_com_membros'],
      ] as const) {
        await c.query('BEGIN')
        try {
          await c.query('SET LOCAL ROLE nexo_proprietario')
          if (mutacao.startsWith('GRANT nexo_autenticacao')) await c.query('RESET ROLE')
          await c.query(mutacao)
          await c.query('RESET ROLE')
          const problemas = (await c.query(sql)).rows.map((x) => x.problema)
          assert.ok(problemas.includes(esperado), `${mutacao} → ${problemas.join(', ')}`)
        } finally {
          await c.query('ROLLBACK')
        }
      }
    })
  })
})
