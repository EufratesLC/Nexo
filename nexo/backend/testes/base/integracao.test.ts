// Testes da base REAL: transacções, contexto, papéis e privilégios das migrações 0001–0004.
//
// Precisam de uma base com as migrações aplicadas e destas variáveis (ver docs/Nexo_Ambientes.md):
//   NEXO_TESTE_API_URL     ligação como nexo_api (no Supabase: Transaction pooler, porta 6543)
//   NEXO_TESTE_ADMIN_URL   ligação administrativa (Session pooler 5432 ou directa), para os dados de teste
//   NEXO_TESTE_CONFIRMO    identificador do alvo (o mesmo de npm run db:estado), para não correr por engano
//   DB_CA_CERT_FICHEIRO    certificado (obrigatório para servidores remotos)
//   NEXO_TESTE_LOCAL=1     só para o PostgreSQL local de verificação (PGlite), que não tem login por
//                          papel: a sessão passa a nexo_api com SET SESSION AUTHORIZATION.
// Sem estas variáveis, os testes são SALTADOS (e o resumo diz porquê); não falham.
//
// Os dados de teste (duas empresas fictícias com identificadores aleatórios) são criados e
// apagados pela ligação administrativa. Nada é apagado além desses identificadores.
process.env.NEXO_AMBIENTE = 'teste'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { criarAcessoBase, type AcessoBase } from '../../src/base/acesso.js'
import { SEM_CONTEXTO } from '../../src/base/contexto.js'
import { contextoDeTeste } from '../../src/base/contexto.testes.js'
import { lerConfiguracao } from '../../src/config/ambiente.js'
import { criarLogger } from '../../src/registo/logger.js'

const API = process.env.NEXO_TESTE_API_URL
const ADMIN = process.env.NEXO_TESTE_ADMIN_URL
const LOCAL = process.env.NEXO_TESTE_LOCAL === '1'
const CA = process.env.DB_CA_CERT_FICHEIRO
const motivoSalto = !API || !ADMIN ? 'defina NEXO_TESTE_API_URL e NEXO_TESTE_ADMIN_URL (base de desenvolvimento)' : !process.env.NEXO_TESTE_CONFIRMO ? 'defina NEXO_TESTE_CONFIRMO' : undefined

// O PostgreSQL local de verificação (PGlite + pglite-socket) dessincroniza a ligação depois de um
// erro no protocolo estendido (consultas com parâmetros). Os testes que provocam esses erros só
// correm numa base real (nexo-dev); localmente ficam marcados como não executados.
const SO_BASE_REAL = LOCAL ? { skip: 'não executado no PostgreSQL local: erros no protocolo estendido dessincronizam o emulador; correr no nexo-dev' } : {}

// NEXO_TESTE_CONCORRENCIA_LOCAL=1 força o teste de concorrência no emulador (experimental: pode cortar ligações).
const SO_CONCORRENCIA_REAL = LOCAL && process.env.NEXO_TESTE_CONCORRENCIA_LOCAL !== '1' ? { skip: 'não executado no PostgreSQL local: o emulador tem um só processo e corta ligações concorrentes; correr no nexo-dev' } : {}

const ssl = CA ? { ca: readFileSync(CA, 'utf8'), rejectUnauthorized: true } : undefined
const logger = criarLogger('silent')

const A = { empresa: randomUUID(), filial: randomUUID() }
const B = { empresa: randomUUID(), filial: randomUUID() }

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN, ssl })
  await c.connect()
  try {
    if (LOCAL) await c.query('RESET SESSION AUTHORIZATION; RESET ROLE')
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Cliente "cru" como nexo_api, para testar o que a API não consegue fazer mesmo fora do módulo. */
async function clienteApi(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: API, ssl })
  await c.connect()
  if (LOCAL) await c.query('SET SESSION AUTHORIZATION nexo_api')
  return c
}

function criarAcesso(poolMax: number, aoCriarPool?: (pool: pg.Pool) => void): AcessoBase {
  const config = lerConfiguracao({ NEXO_AMBIENTE: 'teste', DATABASE_URL: API, DB_CA_CERT_FICHEIRO: CA, DB_POOL_MAX: String(poolMax) })
  return criarAcessoBase(config.base, logger, (opcoes) => {
    const pool = new pg.Pool(opcoes)
    if (LOCAL) pool.on('connect', (c) => void c.query('SET SESSION AUTHORIZATION nexo_api'))
    aoCriarPool?.(pool)
    return pool
  })
}

const ctx = (e: typeof A) => contextoDeTeste({ empresaId: e.empresa, filialId: e.filial, funcao: 'gestor' })
const lerEmpresas = (acesso: AcessoBase, contexto: ReturnType<typeof ctx> | typeof SEM_CONTEXTO, papel: 'gestao' | 'operador' = 'gestao') =>
  acesso.executarTransaccao({ papel, contexto }, async (c) => (await c.query<{ id: string }>('SELECT id FROM nexo.empresas ORDER BY id')).rows.map((r) => r.id))

async function codigoDoErro(promessa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promessa
    return undefined
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message
  }
}

describe('base de dados real (migrações 0001–0004)', { skip: motivoSalto }, () => {
  let acesso: AcessoBase

  before(async () => {
    await admin(async (c) => {
      await c.query('BEGIN')
      // O dono (nexo_proprietario) cria os dados de teste com o FORCE retirado só dentro desta
      // transacção; o COMMIT repõe-no. Nenhuma outra sessão vê o estado intermédio.
      await c.query('SET LOCAL ROLE nexo_proprietario')
      await c.query('ALTER TABLE nexo.empresas NO FORCE ROW LEVEL SECURITY')
      await c.query('ALTER TABLE nexo.filiais NO FORCE ROW LEVEL SECURITY')
      for (const [e, nome] of [[A, 'TESTE AUTOMATICO A'], [B, 'TESTE AUTOMATICO B']] as const) {
        await c.query('INSERT INTO nexo.empresas (id, nome) VALUES ($1, $2)', [e.empresa, nome])
        await c.query("INSERT INTO nexo.filiais (id, empresa_id, codigo, nome) VALUES ($1, $2, 'F01', 'Filial de teste')", [e.filial, e.empresa])
      }
      await c.query('ALTER TABLE nexo.empresas FORCE ROW LEVEL SECURITY')
      await c.query('ALTER TABLE nexo.filiais FORCE ROW LEVEL SECURITY')
      await c.query('COMMIT')
    })
    acesso = criarAcesso(Number(process.env.NEXO_TESTE_POOL_MAX ?? 4))
  })

  after(async () => {
    await acesso?.encerrar()
    // No emulador local a identidade da sessão partilhada não volta ao administrador depois das
    // ligações nexo_api; os dados ficam numa pasta descartável. Numa base real a limpeza corre sempre.
    if (LOCAL) return
    await admin(async (c) => {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE nexo_proprietario')
      await c.query('ALTER TABLE nexo.empresas NO FORCE ROW LEVEL SECURITY')
      await c.query('ALTER TABLE nexo.filiais NO FORCE ROW LEVEL SECURITY')
      await c.query('DELETE FROM nexo.filiais WHERE id = ANY($1::uuid[])', [[A.filial, B.filial]])
      await c.query('DELETE FROM nexo.empresas WHERE id = ANY($1::uuid[])', [[A.empresa, B.empresa]])
      await c.query('ALTER TABLE nexo.empresas FORCE ROW LEVEL SECURITY')
      await c.query('ALTER TABLE nexo.filiais FORCE ROW LEVEL SECURITY')
      await c.query('COMMIT')
    })
  })

  test('diagnóstico: base disponível, papel seguro, migração 0004', async () => {
    assert.deepEqual(await acesso.diagnosticar(), { disponivel: true, papelSeguro: true, versaoMigracao: '0004' })
  })

  test('falta de contexto: nenhuma linha, para gestão e operador', async () => {
    assert.deepEqual(await lerEmpresas(acesso, SEM_CONTEXTO), [])
    assert.deepEqual(await lerEmpresas(acesso, SEM_CONTEXTO, 'operador'), [])
    const filiais = await acesso.executarTransaccao({ papel: 'gestao', contexto: SEM_CONTEXTO }, async (c) => (await c.query('SELECT 1 FROM nexo.filiais')).rowCount)
    assert.equal(filiais, 0)
  })

  test('separação entre duas empresas, mesmo pedindo o identificador da outra', async () => {
    assert.deepEqual(await lerEmpresas(acesso, ctx(A)), [A.empresa])
    assert.deepEqual(await lerEmpresas(acesso, ctx(B)), [B.empresa])
    const cruzado = await acesso.executarTransaccao({ papel: 'operador', contexto: ctx(A) }, async (c) => ({
      empresa: (await c.query('SELECT 1 FROM nexo.empresas WHERE id = $1', [B.empresa])).rowCount,
      filial: (await c.query('SELECT 1 FROM nexo.filiais WHERE id = $1 OR empresa_id = $2', [B.filial, B.empresa])).rowCount,
    }))
    assert.deepEqual(cruzado, { empresa: 0, filial: 0 })
  })

  test('contexto depois de sucesso: não passa para a transacção seguinte (ligação reutilizada)', async () => {
    const um = criarAcesso(1) // uma só ligação: a transacção seguinte reutiliza-a de certeza
    try {
      assert.deepEqual(await lerEmpresas(um, ctx(A)), [A.empresa])
      assert.deepEqual(await lerEmpresas(um, SEM_CONTEXTO), [], 'depois de sucesso')
      assert.deepEqual(await lerEmpresas(um, ctx(B)), [B.empresa])
      assert.deepEqual(await lerEmpresas(um, SEM_CONTEXTO, 'operador'), [], 'depois de sucesso, outro papel')
    } finally {
      await um.encerrar()
    }
  })

  test('contexto depois de erro: ROLLBACK e nada passa para a transacção seguinte (ligação reutilizada)', SO_BASE_REAL, async () => {
    const um = criarAcesso(1)
    try {
      await assert.rejects(
        um.executarTransaccao({ papel: 'gestao', contexto: ctx(A) }, async (c) => {
          await c.query('SELECT id FROM nexo.empresas')
          await c.query('SELECT 1 / 0')
        }),
        (e: { code?: string }) => e.code === '22012',
      )
      assert.deepEqual(await lerEmpresas(um, SEM_CONTEXTO), [], 'depois de erro')
      await assert.rejects(um.executarTransaccao({ papel: 'gestao', contexto: ctx(B) }, async () => Promise.reject(new Error('falha da aplicação'))), /falha da aplicação/)
      assert.deepEqual(await lerEmpresas(um, SEM_CONTEXTO), [], 'depois de erro da aplicação')
      assert.deepEqual(await lerEmpresas(um, ctx(B)), [B.empresa], 'a ligação continua utilizável')
    } finally {
      await um.encerrar()
    }
  })

  test('reutilização de ligações com transacções concorrentes: cada uma vê só a sua empresa', SO_CONCORRENCIA_REAL, async (t) => {
    // 90 transacções (A, B, sem contexto; gestão e operador) com concorrência LIMITADA: há sempre
    // mais tarefas activas do que ligações, por isso há espera pelo pool e reutilização de
    // ligações, mas a fila nunca excede o que cabe no tempo limite de aquisição (10 s, que inclui
    // a espera na fila). Antes, as 90 eram lançadas de uma vez com Promise.all: as últimas ficavam
    // mais de 10 s na fila e falhavam, e as restantes continuavam a correr depois da falha.
    const TOTAL = 90
    const POOL = Number(process.env.NEXO_TESTE_POOL_MAX ?? 4)
    const CONCORRENCIA = Number(process.env.NEXO_TESTE_CONCORRENCIA ?? POOL * 3)
    assert.ok(CONCORRENCIA > POOL, 'a concorrência tem de exceder o pool para testar a espera e a reutilização')
    let pool: pg.Pool | undefined
    const proprio = criarAcesso(POOL, (p) => (pool = p))

    interface Resultado { i: number; alvo: string; papel: string; ms: number; ids?: string[]; erro?: string; pid?: number }
    const resultados: Resultado[] = []
    let proxima = 0
    let activasMax = 0
    let activas = 0
    const inicio = performance.now()
    // Trabalhadores: cada um tira a próxima tarefa. Nenhuma falha interrompe os outros.
    const trabalhador = async () => {
      while (proxima < TOTAL) {
        const i = proxima++
        const alvo = [A, B, null][i % 3]
        const papel = i % 2 ? 'operador' : 'gestao'
        const t0 = performance.now()
        activas++
        activasMax = Math.max(activasMax, activas)
        try {
          const r = await proprio.executarTransaccao({ papel, contexto: alvo ? ctx(alvo) : SEM_CONTEXTO }, async (c) => ({
            ids: (await c.query<{ id: string }>('SELECT id FROM nexo.empresas ORDER BY id')).rows.map((x) => x.id),
            pid: (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          }))
          resultados.push({ i, alvo: alvo === A ? 'A' : alvo === B ? 'B' : 'sem contexto', papel, ms: performance.now() - t0, ...r })
        } catch (e) {
          const erro = e as Error & { code?: string }
          resultados.push({ i, alvo: alvo === A ? 'A' : alvo === B ? 'B' : 'sem contexto', papel, ms: performance.now() - t0, erro: `${erro.name}${erro.code ? ' ' + erro.code : ''}: ${erro.message}` })
        } finally {
          activas--
        }
      }
    }
    // allSettled: espera por TODOS os trabalhadores antes de avaliar, mesmo que algum rebente.
    const fim = await Promise.allSettled(Array.from({ length: CONCORRENCIA }, trabalhador))
    const duracao = performance.now() - inicio
    const estadoPool = pool ? { total: pool.totalCount, livres: pool.idleCount, emEspera: pool.waitingCount } : null
    await proprio.encerrar()

    const esperado = (r: Resultado) => (r.alvo === 'A' ? [A.empresa] : r.alvo === 'B' ? [B.empresa] : [])
    const falhas = resultados.filter((r) => r.erro).map((r) => `#${r.i} ${r.alvo}/${r.papel}: ${r.erro}`)
    const fugas = resultados.filter((r) => !r.erro && JSON.stringify(r.ids) !== JSON.stringify(esperado(r)))
      .map((r) => `#${r.i} ${r.alvo}/${r.papel}: viu ${JSON.stringify(r.ids)}`)
    const trabalhadoresRebentados = fim.filter((x) => x.status === 'rejected').map((x) => String((x as PromiseRejectedResult).reason))
    const tempos = resultados.map((r) => r.ms).sort((a, b) => a - b)
    // Só números e contagens; nenhum dado de ligação.
    t.diagnostic(`transacções=${TOTAL} concorrência=${CONCORRENCIA} (máx. activas ${activasMax}) pool=${POOL} duração=${Math.round(duracao)} ms`)
    t.diagnostic(`por transacção: mediana=${Math.round(tempos[Math.floor(tempos.length / 2)] ?? 0)} ms máx=${Math.round(tempos.at(-1) ?? 0)} ms; processos do servidor distintos=${new Set(resultados.map((r) => r.pid).filter(Boolean)).size}`)
    t.diagnostic(`pool no fim (antes de encerrar): ${JSON.stringify(estadoPool)}`)

    const problemas = [
      ...(resultados.length !== TOTAL ? [`concluídas ${resultados.length} de ${TOTAL}`] : []),
      ...trabalhadoresRebentados.map((x) => `trabalhador terminou com erro: ${x}`),
      ...fugas.map((x) => `ISOLAMENTO: ${x}`),
      ...falhas.map((x) => `ERRO: ${x}`),
      // Libertação: no fim, nenhuma ligação presa, ninguém à espera, nunca acima do máximo.
      ...(estadoPool && estadoPool.emEspera !== 0 ? [`pool com ${estadoPool.emEspera} pedido(s) à espera no fim`] : []),
      ...(estadoPool && estadoPool.livres !== estadoPool.total ? [`pool com ${estadoPool.total - estadoPool.livres} ligação(ões) não libertada(s)`] : []),
      ...(estadoPool && estadoPool.total > POOL ? [`pool acima do máximo: ${estadoPool.total}`] : []),
    ]
    assert.deepEqual(problemas, [], `${problemas.length} problema(s):\n${problemas.join('\n')}`)
  })

  test('execução com papéis sem BYPASSRLS: current_user é o papel de execução; a sessão é nexo_api', async () => {
    const r = await acesso.executarTransaccao({ papel: 'operador', contexto: SEM_CONTEXTO }, async (c) =>
      (
        await c.query(`SELECT current_user AS papel, session_user AS sessao,
            (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) AS papel_privilegiado,
            (SELECT rolbypassrls OR rolsuper OR rolinherit FROM pg_roles WHERE rolname = 'nexo_api') AS api_privilegiada`)
      ).rows[0],
    )
    assert.deepEqual(r, { papel: 'nexo_operador', sessao: 'nexo_api', papel_privilegiado: false, api_privilegiada: false })
  })

  test('ausência de acesso administrativo pela API, dentro de executarTransaccao', SO_BASE_REAL, async () => {
    const tentar = (sql: string, papel: 'gestao' | 'operador' | 'sincronizacao' = 'gestao') =>
      codigoDoErro(acesso.executarTransaccao({ papel, contexto: ctx(A) }, (c) => c.query(sql)))
    assert.equal(await tentar('SELECT * FROM nexo_controlo.migracoes'), '42501')
    assert.equal(await tentar(`INSERT INTO nexo.empresas (nome) VALUES ('intrusa')`), '42501')
    assert.equal(await tentar(`UPDATE nexo.empresas SET nome = 'x'`, 'sincronizacao'), '42501')
    assert.equal(await tentar('DELETE FROM nexo.filiais'), '42501')
  })

  test('ausência de acesso administrativo pela ligação nexo_api', async () => {
    // O guarda do módulo recusa mudar de papel antes de chegar à base.
    assert.equal(
      await codigoDoErro(acesso.executarTransaccao({ papel: 'gestao', contexto: ctx(A) }, (c) => c.query('SET ROLE postgres'))),
      'comando não permitido dentro de executarTransaccao',
    )
    // Mesmo fora do módulo de acesso, a ligação nexo_api não chega a papéis administrativos.
    // (Protocolo simples: sem parâmetros, os erros não afectam o emulador local.)
    const c = await clienteApi()
    try {
      assert.equal(await codigoDoErro(c.query('SELECT 1 FROM nexo.empresas')), '42501', 'sem SET ROLE não lê tabelas')
      for (const papel of ['postgres', 'nexo_proprietario', 'nexo_diagnostico']) {
        assert.equal(await codigoDoErro(c.query(`SET ROLE ${papel}`)), '42501', `SET ROLE ${papel}`)
      }
      assert.equal(await codigoDoErro(c.query('CREATE TABLE nexo.intrusa (id int)')), '42501')
      const membro = await c.query(`SELECT pg_has_role('nexo_api', 'nexo_proprietario', 'MEMBER') AS m`)
      assert.equal(membro.rows[0].m, false)
    } finally {
      await c.end()
    }
  })

  test('definir_contexto: uma vez por transacção, só dentro de um papel de execução', async () => {
    const c = await clienteApi()
    try {
      assert.equal(await codigoDoErro(c.query(`SELECT nexo.definir_contexto('${A.empresa}', null, null, null, null)`)), '42501', 'nexo_api sem SET ROLE')
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE nexo_gestao')
      await c.query(`SELECT nexo.definir_contexto('${A.empresa}', null, null, null, null)`)
      assert.equal(await codigoDoErro(c.query(`SELECT nexo.definir_contexto('${B.empresa}', null, null, null, null)`)), '25000')
      await c.query('ROLLBACK')
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE nexo_gestao')
      assert.equal(await codigoDoErro(c.query(`SELECT nexo.definir_contexto('${A.empresa}', null, null, 'administrador', null)`)), '22023')
      await c.query('ROLLBACK')
    } finally {
      await c.end()
    }
  })

  test('marca da transacção: contexto sem marca e contexto residual de sessão não dão acesso', async () => {
    const c = await clienteApi()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE nexo_gestao')
      await c.query(`SELECT set_config('nexo.empresa_id', $1, true)`, [A.empresa])
      assert.equal((await c.query('SELECT 1 FROM nexo.empresas')).rowCount, 0, 'empresa sem marca')
      await c.query('COMMIT')
      // Erro proibido no código, simulado aqui: contexto e marca ao nível da SESSÃO.
      await c.query(
        `SELECT set_config('nexo.empresa_id', $1, false),
                set_config('nexo.marca', pg_backend_pid()::text || ':' || extract(epoch FROM now())::text, false)`,
        [A.empresa],
      )
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE nexo_gestao')
      const herdado = (await c.query(`SELECT current_setting('nexo.empresa_id', true) AS v`)).rows[0].v
      assert.equal(herdado, A.empresa, 'o valor residual existe na sessão')
      assert.equal((await c.query('SELECT 1 FROM nexo.empresas')).rowCount, 0, 'mas a marca já não corresponde')
      await c.query('COMMIT')
    } finally {
      await c.query(`SELECT set_config('nexo.empresa_id', '', false), set_config('nexo.marca', '', false)`).catch(() => {})
      await c.end()
    }
  })

  test('verificação do catálogo (R1): nenhum problema', async () => {
    const sql = readFileSync(join(import.meta.dirname, '..', '..', 'migracoes', 'verificacoes.sql'), 'utf8')
    const problemas = await admin(async (c) => (await c.query(sql)).rows)
    assert.deepEqual(problemas, [])
  })
})
