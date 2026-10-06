// Módulo de transacções com um pool SIMULADO (sem base de dados): ordem dos comandos, papel da
// lista fixa, contexto verificado, COMMIT/ROLLBACK e libertação da ligação em todos os caminhos.
// Os mesmos comportamentos são testados contra PostgreSQL real em testes/base/.
process.env.NEXO_AMBIENTE = 'teste'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type pg from 'pg'
import { comandoProibido, criarAcessoBase, ErroBaseIndisponivel, type ClienteMinimo, type PoolMinimo } from '../../src/base/acesso.js'
import { MARCA_CONTEXTO, SEM_CONTEXTO } from '../../src/base/contexto.js'
import { contextoDeTeste } from '../../src/base/contexto.testes.js'
import type { ConfiguracaoBase } from '../../src/config/ambiente.js'
import { criarLogger } from '../../src/registo/logger.js'

const logger = criarLogger('silent')
const config: ConfiguracaoBase = { ligacao: 'postgresql://nexo_api@localhost/x', tls: null, poolMax: 1, descricao: 'localhost:5432' }
const A = '11111111-1111-4111-8111-111111111111'

function poolSimulado(opcoes: { falharEm?: RegExp; falharRollback?: boolean } = {}) {
  const comandos: string[] = []
  const libertacoes: (Error | boolean | undefined)[] = []
  let ligacoes = 0
  const cliente: ClienteMinimo = {
    async query(config: string | pg.QueryConfig) {
      const texto = typeof config === 'string' ? config : config.text
      comandos.push(texto)
      if (opcoes.falharRollback && texto === 'ROLLBACK') throw new Error('ligação perdida')
      if (opcoes.falharEm?.test(texto)) throw Object.assign(new Error('erro simulado'), { code: '42501' })
      return { rows: [{ ok: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] } as pg.QueryResult
    },
    release(erro) {
      libertacoes.push(erro)
    },
  }
  const pool: PoolMinimo = {
    async connect() {
      ligacoes++
      return cliente
    },
    async end() {},
    on() {},
  }
  return { pool, comandos, libertacoes, ligacoes: () => ligacoes }
}

test('sucesso: BEGIN → SET LOCAL ROLE → timeout → definir_contexto → trabalho → COMMIT; liberta a ligação', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  const r = await acesso.executarTransaccao({ papel: 'gestao', contexto: contextoDeTeste({ empresaId: A, funcao: 'gestor' }) }, async (c) => {
    await c.query('SELECT 1')
    return 'feito'
  })
  assert.equal(r, 'feito')
  assert.deepEqual(s.comandos, [
    "BEGIN; SET LOCAL ROLE nexo_gestao; SET LOCAL statement_timeout = '15s'",
    'SELECT nexo.definir_contexto($1, $2, $3, $4, $5)',
    'SELECT 1',
    'COMMIT',
  ])
  assert.deepEqual(s.libertacoes, [undefined])
})

test('sem contexto: não chama definir_contexto', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  await acesso.executarTransaccao({ papel: 'operador', contexto: SEM_CONTEXTO }, async () => null)
  assert.ok(!s.comandos.some((c) => c.includes('definir_contexto')))
  assert.equal(s.comandos[0], "BEGIN; SET LOCAL ROLE nexo_operador; SET LOCAL statement_timeout = '15s'")
})

test('erro no trabalho: ROLLBACK, o erro propaga-se e a ligação volta ao pool', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  await assert.rejects(
    acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, async () => {
      throw new Error('falha de negócio')
    }),
    /falha de negócio/,
  )
  assert.equal(s.comandos.at(-1), 'ROLLBACK')
  assert.ok(!s.comandos.includes('COMMIT'))
  assert.deepEqual(s.libertacoes, [undefined])
})

test('erro numa consulta e erro no próprio COMMIT também fazem ROLLBACK', async () => {
  for (const falharEm of [/^SELECT 2$/, /^COMMIT$/, /SET LOCAL ROLE/]) {
    const s = poolSimulado({ falharEm })
    const acesso = criarAcessoBase(config, logger, () => s.pool)
    await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, (c) => c.query('SELECT 2')))
    assert.equal(s.comandos.at(-1), 'ROLLBACK', String(falharEm))
    assert.deepEqual(s.libertacoes, [undefined])
  }
})

test('se o ROLLBACK falhar, a ligação é destruída (release com erro) e não volta ao pool', async () => {
  const s = poolSimulado({ falharEm: /^SELECT 2$/, falharRollback: true })
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, (c) => c.query('SELECT 2')), /erro simulado/)
  assert.equal(s.libertacoes.length, 1)
  assert.ok(s.libertacoes[0] instanceof Error)
})

test('papel fora da lista fixa é recusado antes de pedir ligação', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  for (const papel of ['postgres', 'nexo_proprietario', 'nexo_gestao; DROP TABLE x', 'toString', '__proto__']) {
    await assert.rejects(acesso.executarTransaccao({ papel: papel as 'gestao', contexto: SEM_CONTEXTO }, async () => null), /papel de execução desconhecido/)
  }
  assert.equal(s.ligacoes(), 0)
})

test('contexto montado à mão (ex.: valores vindos do navegador) é recusado antes de pedir ligação', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  const forjados: unknown[] = [
    { empresaId: A, filialId: null, utilizadorId: null, funcao: 'gestor', registoId: null },
    JSON.parse(JSON.stringify({ [MARCA_CONTEXTO]: true, empresaId: A })),
    { [MARCA_CONTEXTO]: true, empresaId: 'nao-e-uuid', filialId: null, utilizadorId: null, funcao: null, registoId: null },
    { [MARCA_CONTEXTO]: true, empresaId: A, filialId: null, utilizadorId: null, funcao: 'administrador', registoId: null },
    null,
  ]
  for (const contexto of forjados) {
    await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: contexto as typeof SEM_CONTEXTO }, async () => null))
  }
  assert.equal(s.ligacoes(), 0)
})

test('contextoDeTeste só funciona com NEXO_AMBIENTE=teste', () => {
  process.env.NEXO_AMBIENTE = 'desenvolvimento'
  try {
    assert.throws(() => contextoDeTeste({ empresaId: A }), /só pode ser usado com NEXO_AMBIENTE=teste/)
  } finally {
    process.env.NEXO_AMBIENTE = 'teste'
  }
})

test('dentro da transacção, comandos que mudam transacção, papel ou contexto são recusados', async () => {
  const proibidos = [
    'COMMIT',
    'rollback',
    'BEGIN',
    'SAVEPOINT x',
    'SET ROLE postgres',
    'set local role nexo_gestao',
    'RESET ROLE',
    "SELECT set_config('nexo.empresa_id', 'x', false)",
    "select SET_CONFIG ('nexo.marca', '1', true)",
    'SET SESSION AUTHORIZATION postgres',
    "SELECT nexo.definir_contexto('x', null, null, null, null)",
    'DISCARD ALL',
    'DO $$ BEGIN END $$',
  ]
  for (const t of proibidos) assert.ok(comandoProibido(t), t)
  for (const t of ['SELECT 1', 'SELECT id, nome FROM nexo.empresas WHERE id = $1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'INSERT INTO nexo.t (a) VALUES ($1)']) {
    assert.ok(!comandoProibido(t), t)
  }
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, (c) => c.query('SET ROLE postgres')), /comando não permitido/)
  assert.equal(s.comandos.at(-1), 'ROLLBACK')
})

test('o cliente da transacção deixa de funcionar depois do fim', async () => {
  const s = poolSimulado()
  const acesso = criarAcessoBase(config, logger, () => s.pool)
  let guardado: { query: (t: string) => Promise<unknown> } | undefined
  await acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, async (c) => {
    guardado = c
  })
  await assert.rejects(guardado!.query('SELECT 1'), /transacção já terminada/)
})

test('sem base configurada: executarTransaccao falha e o diagnóstico diz "nao_configurada"', async () => {
  const acesso = criarAcessoBase(null, logger)
  await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, async () => null), /não configurada/)
  assert.deepEqual(await acesso.diagnosticar(), { disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'nao_configurada' })
})

test('sem ligação dentro do tempo limite (fila do pool cheia): ErroBaseIndisponivel, sem nada para libertar', async () => {
  const pool: PoolMinimo = {
    connect: async () => {
      throw new Error('timeout exceeded when trying to connect')
    },
    end: async () => {},
    on() {},
  }
  const acesso = criarAcessoBase(config, logger, () => pool)
  await assert.rejects(acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, async () => null), ErroBaseIndisponivel)
})
