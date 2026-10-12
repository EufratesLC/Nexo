// Concorrência na activação do registo (migração 0008, revisão de 11/10/2026), na base REAL.
//
// Para forçar as corridas, o teste segura o bloqueio consultivo da conta ('nexo.activacao') numa
// ligação administrativa, lança os pedidos, espera até estarem TODOS à espera desse bloqueio na
// base (pg_locks) e só então o liberta. Assim os pedidos competem de facto, e na ordem em que
// chegaram à fila (o PostgreSQL atende-os por ordem de chegada). Cada pedido corre na sua
// própria ligação do pool, como na API.
import './verificacaoPrevia.js' // uma ligação de cada tipo antes de tudo (ver o ficheiro)
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import type { AcessoBase } from '../../src/base/acesso.js'
import { criarEnvioEmailMemoria } from '../../src/email/envio.js'
import { criarLogger } from '../../src/registo/logger.js'
import { criarServicoIdentidade, type ServicoIdentidade } from '../../src/servicos/identidade.js'
import { acessoTeste, ADMIN, CODIGO_DONO, codigoEmpresaTeste, comoDono, configTeste, limparEmpresas, motivoSalto, ssl } from './ajuda.js'

const email = criarEnvioEmailMemoria()
const config = configTeste({ DB_POOL_MAX: '12' })
const criadas: string[] = []
let base: AcessoBase
let identidade: ServicoIdentidade

const tokenDoLink = (texto: string) => /token=(ne_[A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? ''
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Conta {
  codigoEmpresa: string
  nome: string
  empresaId: string
  utilizadorId: string
  emailInicial: string
}

/** Mensagens de confirmação já entregues ao transporte para este endereço. */
const confirmacoesPara = (endereco: string) => email.mensagens.filter((m) => m.finalidade === 'confirmar_email' && m.para === endereco)

async function ultimoLink(endereco: string, minimo = 1): Promise<string> {
  const fim = Date.now() + 5000
  while (confirmacoesPara(endereco).length < minimo && Date.now() < fim) await esperar(20)
  const m = confirmacoesPara(endereco).at(-1)
  if (!m) throw new Error(`sem link para ${endereco}`)
  return tokenDoLink(m.texto)
}

/** Registo pendente (sem confirmar), com um endereço próprio para contar os envios. */
async function registoPendente(nome: string): Promise<Conta> {
  const codigoEmpresa = codigoEmpresaTeste()
  criadas.push(codigoEmpresa)
  const emailInicial = `${nome}.${codigoEmpresa}@exemplo.co.mz`
  await identidade.registar({ codigoEmpresa, nomeEmpresa: `TESTE ${codigoEmpresa}`, nome: 'Dono', nomeUtilizador: nome, email: emailInicial, codigoSecreto: CODIGO_DONO })
  await ultimoLink(emailInicial)
  const ids = await comoDono(
    async (c) =>
      (await c.query('SELECT u.empresa_id, u.id FROM nexo.utilizadores u JOIN nexo.empresas e ON e.id = u.empresa_id WHERE e.codigo = $1', [codigoEmpresa])).rows[0],
  )
  return { codigoEmpresa, nome, empresaId: ids.empresa_id, utilizadorId: ids.id, emailInicial }
}

/** Fotografia de tudo o que a activação pode alterar numa conta. */
async function estadoDa(conta: Conta) {
  return comoDono(async (c) => ({
    conta: (await c.query('SELECT estado FROM nexo.utilizadores WHERE id = $1', [conta.utilizadorId])).rows[0].estado as string,
    contacto: (
      await c.query('SELECT email, confirmado_em, email_pendente, pendente_desde, actualizado_em FROM nexo.contactos_recuperacao WHERE utilizador_id = $1', [conta.utilizadorId])
    ).rows[0],
    tokens: (
      await c.query(
        "SELECT id, email, criado_em, usado_em, invalidado_em FROM nexo.tokens_email WHERE utilizador_id = $1 AND finalidade = 'confirmar_email' ORDER BY criado_em, id",
        [conta.utilizadorId],
      )
    ).rows,
    auditoria: (await c.query('SELECT accao FROM nexo.registo_auditoria WHERE entidade_id = $1 ORDER BY criado_em, accao', [conta.utilizadorId])).rows.map(
      (r) => r.accao as string,
    ),
  }))
}

/**
 * Segura o bloqueio da conta, lança os pedidos POR ORDEM (cada um só depois de o anterior estar à
 * espera na base) e liberta-o. Devolve os resultados de todos.
 */
async function emCorrida<T>(conta: Conta, pedidos: (() => Promise<T>)[], porOrdem = true): Promise<PromiseSettledResult<T>[]> {
  const c = new pg.Client({ connectionString: ADMIN, ssl })
  await c.connect()
  const emEspera = async (n: number) => {
    const fim = Date.now() + 15_000
    for (;;) {
      const r = await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND NOT granted")
      if (r.rows[0].n >= n) return
      if (Date.now() > fim) throw new Error(`só ${r.rows[0].n} de ${n} pedidos chegaram ao bloqueio`)
      await esperar(10)
    }
  }
  try {
    await c.query('BEGIN')
    await c.query("SELECT pg_advisory_xact_lock(hashtext('nexo.activacao'), hashtext($1))", [conta.utilizadorId])
    const promessas: Promise<T>[] = []
    for (const [i, p] of pedidos.entries()) {
      promessas.push(p())
      if (porOrdem) await emEspera(i + 1)
    }
    if (!porOrdem) await emEspera(pedidos.length)
    await c.query('COMMIT') // liberta: os pedidos competem a partir daqui
    return await Promise.allSettled(promessas)
  } finally {
    await c.query('ROLLBACK').catch(() => {})
    await c.end()
  }
}

const valores = <T>(r: PromiseSettledResult<T>[]) =>
  r.map((x) => {
    if (x.status === 'rejected') throw x.reason
    return x.value
  })

describe('activação do registo sob concorrência (0008, base real)', { skip: motivoSalto }, () => {
  before(async () => {
    base = acessoTeste(config)
    identidade = criarServicoIdentidade({ base, config, email, logger: criarLogger('silent') })
  })

  after(async () => {
    await base?.encerrar()
    await limparEmpresas(criadas)
  })

  test('reenvios simultâneos perto do limite: só 1 link novo (5 no total), 1 envio, 1 link válido', async () => {
    const c = await registoPendente('perto')
    for (let i = 0; i < 3; i++) await identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })
    await ultimoLink(c.emailInicial, 4)
    assert.equal((await estadoDa(c)).tokens.length, 4)
    const resultados = await emCorrida(
      c,
      Array.from({ length: 6 }, () => () => identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })),
      false,
    )
    valores(resultados)
    await esperar(300)
    const e = await estadoDa(c)
    assert.equal(e.tokens.length, 5, 'o limite de 5 por hora mantém-se')
    assert.equal(e.tokens.filter((t) => !t.usado_em && !t.invalidado_em).length, 1, 'um único link válido')
    assert.equal(confirmacoesPara(c.emailInicial).length, 5, 'só um envio a mais')
  })

  test('reenvios simultâneos a partir do registo: no máximo 4 novos, mesmo com 10 pedidos', async () => {
    const c = await registoPendente('dez')
    valores(await emCorrida(c, Array.from({ length: 10 }, () => () => identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })), false))
    await esperar(300)
    const e = await estadoDa(c)
    assert.equal(e.tokens.length, 5)
    assert.equal(e.tokens.filter((t) => !t.usado_em && !t.invalidado_em).length, 1)
    assert.equal(confirmacoesPara(c.emailInicial).length, 5)
  })

  test('correcção recusada pelo limite: nenhuma alteração (endereço, links, auditoria); o link anterior continua a servir', async () => {
    const c = await registoPendente('recusa')
    for (let i = 0; i < 4; i++) await identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })
    const linkAnterior = await ultimoLink(c.emailInicial, 5)
    const antes = await estadoDa(c)
    assert.equal(antes.tokens.length, 5)
    const ok = await identidade.corrigirEmailActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome, codigoSecreto: CODIGO_DONO, email: 'novo@exemplo.co.mz' })
    assert.equal(ok, false)
    await esperar(200)
    assert.deepEqual(await estadoDa(c), antes, 'nada mudou')
    assert.equal(confirmacoesPara('novo@exemplo.co.mz').length, 0)
    assert.equal(await identidade.confirmarEmail(linkAnterior), 'activada')
    assert.equal((await estadoDa(c)).contacto.email, c.emailInicial)
  })

  test('correcção e reenvio simultâneos no último link permitido: só um passa, e a recusada não deixa rasto', async () => {
    const c = await registoPendente('ultimo')
    for (let i = 0; i < 3; i++) await identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })
    await ultimoLink(c.emailInicial, 4)
    const novo = `outro.${c.codigoEmpresa}@exemplo.co.mz`
    const [correccao] = valores(
      await emCorrida(c, [
        () => identidade.corrigirEmailActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome, codigoSecreto: CODIGO_DONO, email: novo }),
        () => identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome }).then(() => 'reenvio' as const),
      ]),
    )
    await esperar(300)
    const e = await estadoDa(c)
    assert.equal(e.tokens.length, 5)
    // A correcção chegou primeiro à fila: passou; o reenvio encontrou o limite e não fez nada.
    assert.equal(correccao, true)
    assert.equal(e.contacto.email_pendente, novo)
    assert.equal(e.tokens.filter((t) => !t.usado_em && !t.invalidado_em).map((t) => t.email).join(), novo)
    assert.equal(confirmacoesPara(c.emailInicial).length, 4, 'nenhum envio para o endereço antigo')
    assert.equal(e.auditoria.filter((a) => a === 'utilizador.email_alterado').length, 1)
  })

  test('confirmação ganha à correcção: activa com o endereço que estava pendente; a correcção é recusada sem alterações', async () => {
    const c = await registoPendente('conf1')
    const link = await ultimoLink(c.emailInicial)
    const [confirmacao, correccao] = valores(
      await emCorrida<unknown>(c, [
        () => identidade.confirmarEmail(link),
        () => identidade.corrigirEmailActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome, codigoSecreto: CODIGO_DONO, email: 'tarde@exemplo.co.mz' }),
      ]),
    )
    assert.equal(confirmacao, 'activada')
    assert.equal(correccao, false)
    const e = await estadoDa(c)
    assert.equal(e.conta, 'activo')
    assert.equal(e.contacto.email, c.emailInicial)
    assert.equal(e.contacto.email_pendente, null)
    assert.equal(e.tokens.length, 1)
    assert.ok(!e.auditoria.includes('utilizador.email_alterado'))
  })

  test('correcção ganha à confirmação: o link do endereço antigo já não activa a conta; o novo activa', async () => {
    const c = await registoPendente('conf2')
    const link = await ultimoLink(c.emailInicial)
    const novo = `certo.${c.codigoEmpresa}@exemplo.co.mz`
    const [correccao, confirmacao] = valores(
      await emCorrida<unknown>(c, [
        () => identidade.corrigirEmailActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome, codigoSecreto: CODIGO_DONO, email: novo }),
        () => identidade.confirmarEmail(link),
      ]),
    )
    assert.equal(correccao, true)
    assert.equal(confirmacao, 'invalido', 'o endereço antigo deixou de estar pendente')
    let e = await estadoDa(c)
    assert.equal(e.conta, 'pendente')
    assert.equal(e.contacto.email, null)
    assert.equal(e.contacto.email_pendente, novo)
    assert.equal(await identidade.confirmarEmail(await ultimoLink(novo)), 'activada')
    e = await estadoDa(c)
    assert.equal(e.contacto.email, novo)
  })

  test('confirmação ganha ao reenvio: activa; o reenvio já não emite nem envia nada', async () => {
    const c = await registoPendente('reenv1')
    const link = await ultimoLink(c.emailInicial)
    const [confirmacao] = valores(
      await emCorrida<unknown>(c, [() => identidade.confirmarEmail(link), () => identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })]),
    )
    await esperar(300)
    assert.equal(confirmacao, 'activada')
    const e = await estadoDa(c)
    assert.equal(e.conta, 'activo')
    assert.equal(e.tokens.length, 1)
    assert.equal(confirmacoesPara(c.emailInicial).length, 1)
  })

  test('reenvio ganha à confirmação: o link anterior fica invalidado e não activa; o novo activa', async () => {
    const c = await registoPendente('reenv2')
    const link = await ultimoLink(c.emailInicial)
    const [, confirmacao] = valores(
      await emCorrida<unknown>(c, [() => identidade.reenviarActivacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome }), () => identidade.confirmarEmail(link)]),
    )
    assert.equal(confirmacao, 'invalido')
    const e = await estadoDa(c)
    assert.equal(e.conta, 'pendente')
    assert.equal(e.tokens.length, 2)
    assert.ok(e.tokens[0].invalidado_em && !e.tokens[0].usado_em)
    assert.equal(await identidade.confirmarEmail(await ultimoLink(c.emailInicial, 2)), 'activada')
  })

  test('duas utilizações simultâneas do mesmo link de confirmação: só uma activa; auditoria única', async () => {
    const c = await registoPendente('duplo')
    const link = await ultimoLink(c.emailInicial)
    const r = valores(await emCorrida(c, [() => identidade.confirmarEmail(link), () => identidade.confirmarEmail(link)]))
    assert.deepEqual([...r].sort(), ['activada', 'invalido'])
    const e = await estadoDa(c)
    assert.equal(e.conta, 'activo')
    assert.equal(e.auditoria.filter((a) => a === 'utilizador.activado').length, 1)
    assert.equal(e.auditoria.filter((a) => a === 'utilizador.email_confirmado').length, 1)
    assert.equal(e.tokens.filter((t) => t.usado_em).length, 1)
  })

  test('sem barreira: 6 confirmações em paralelo do mesmo link e 2 recuperações em paralelo do mesmo link — uma só passa', async () => {
    const c = await registoPendente('paralelo')
    const link = await ultimoLink(c.emailInicial)
    const r = await Promise.all(Array.from({ length: 6 }, () => identidade.confirmarEmail(link)))
    assert.equal(r.filter((x) => x === 'activada').length, 1)
    assert.equal(r.filter((x) => x === 'invalido').length, 5)
    // Recuperação (0007, FOR UPDATE do token): dois pedidos com o mesmo link.
    await identidade.pedirRecuperacao({ codigoEmpresa: c.codigoEmpresa, nomeUtilizador: c.nome })
    const fim = Date.now() + 5000
    while (!email.mensagens.some((m) => m.finalidade === 'recuperar_acesso' && m.para === c.emailInicial) && Date.now() < fim) await esperar(20)
    const rec = tokenDoLink(email.mensagens.filter((m) => m.finalidade === 'recuperar_acesso' && m.para === c.emailInicial).at(-1)!.texto)
    const dois = await Promise.all([identidade.concluirRecuperacao(rec, 'Primeiro código novo 1'), identidade.concluirRecuperacao(rec, 'Segundo código novo 2')])
    assert.deepEqual([...dois].sort(), [false, true])
  })
})
