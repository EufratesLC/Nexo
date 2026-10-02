// Teste de isolamento H-01 — execução completa num projecto Supabase de DESENVOLVIMENTO.
//
// Estado: preparado na revisão da Etapa 1; NÃO EXECUTADO (não havia projecto de desenvolvimento).
//
// Requisitos: Node.js 22 e o pacote "pg", instalado só para este teste:
//   npm install --no-save pg
//
// Variáveis de ambiente (nunca em ficheiros do repositório):
//   NEXO_ISO_ADMIN_URL   ligação DIRECTA (porta 5432) como administrador do projecto de desenvolvimento
//   NEXO_ISO_SENHA_API   palavra-passe a atribuir ao papel de teste nexo_iso_api
//   NEXO_ISO_API_URL     ligação DIRECTA como nexo_iso_api
//   NEXO_ISO_POOL_URL    ligação pelo pooler em modo TRANSACÇÃO (porta 6543) como nexo_iso_api
//                        (no Supabase o utilizador é "nexo_iso_api.<referência-do-projecto>")
//   NEXO_ISO_CONFIRMO_DESENVOLVIMENTO=sim   confirmação explícita de que NÃO é produção
//
// Uso (na pasta backend):  node testes/isolamento/executar.mjs [--limpar-no-fim]

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dividirSql } from './dividirSql.mjs'

const pasta = dirname(fileURLToPath(import.meta.url))
const env = process.env

if (env.NEXO_ISO_CONFIRMO_DESENVOLVIMENTO !== 'sim') {
  console.error('Defina NEXO_ISO_CONFIRMO_DESENVOLVIMENTO=sim para confirmar que o projecto é de desenvolvimento.')
  process.exit(2)
}
for (const v of ['NEXO_ISO_ADMIN_URL', 'NEXO_ISO_SENHA_API', 'NEXO_ISO_API_URL', 'NEXO_ISO_POOL_URL']) {
  if (!env[v]) {
    console.error(`Falta a variável ${v}.`)
    process.exit(2)
  }
}

let pg
try {
  pg = (await import('pg')).default
} catch {
  console.error('Falta o pacote "pg". Instale-o só para este teste: npm install --no-save pg')
  process.exit(2)
}

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000001'
const resultados = []
const registar = (ok, nome, detalhe = '') => resultados.push({ ok, nome, detalhe })

// Remove as meta-instruções do psql (linhas começadas por "\").
const lerSql = (ficheiro) =>
  readFileSync(join(pasta, ficheiro), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('\\'))
    .join('\n')

async function comCliente(url, fn) {
  const cliente = new pg.Client({ connectionString: url })
  await cliente.connect()
  try {
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

// 1. Preparação (administrador)
await comCliente(env.NEXO_ISO_ADMIN_URL, async (c) => {
  await c.query(lerSql('00_limpar.sql'))
  await c.query(lerSql('01_preparar.sql'))
  await c.query(`ALTER ROLE nexo_iso_api PASSWORD ${c.escapeLiteral(env.NEXO_ISO_SENHA_API)}`)
  await c.query(lerSql('02_dados.sql'))
})
console.log('Preparação concluída (esquema nexo_iso e papéis nexo_iso_*).')

// 2. Testes na base de dados (ligação directa como nexo_iso_api)
await comCliente(env.NEXO_ISO_API_URL, async (c) => {
  c.on('notice', (n) => {
    const m = /^(OK|FALHOU) (T\d+\w?) (.*)$/s.exec(n.message)
    if (m) registar(m[1] === 'OK', `${m[2]} ${m[3]}`)
  })
  // Uma instrução de cada vez: cada uma é uma transacção própria (um texto com várias instruções
  // seria executado numa só transacção e o SET LOCAL ROLE passaria de um teste para o seguinte).
  for (const instrucao of dividirSql(lerSql('03_testes.sql'))) await c.query(instrucao)
})

// 3. Pool em modo transacção: sem fuga de contexto entre transacções de clientes diferentes.
const pool = new pg.Pool({ connectionString: env.NEXO_ISO_POOL_URL, max: 15 })
async function transaccao(contexto) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE nexo_iso_gestao')
    if (contexto) await c.query('SELECT nexo_iso.definir_contexto($1)', [contexto])
    const r = await c.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE empresa_id::text <> coalesce($1, ''))::int AS alheias,
              current_setting('nexo.empresa_id', true) AS herdado
         FROM nexo_iso.produtos`,
      [contexto],
    )
    await c.query('COMMIT')
    return r.rows[0]
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

{
  const N = 600
  let erros = 0
  let valoresDeSessaoVistos = 0
  const tarefas = []
  for (let i = 0; i < N; i++) {
    const contexto = [A, B, null][i % 3]
    tarefas.push(
      transaccao(contexto).then((r) => {
        if (contexto === null && r.total !== 0) erros++
        if (contexto !== null && (r.total !== 1 || r.alheias !== 0)) erros++
        if (contexto === null && r.herdado) valoresDeSessaoVistos++
      }),
    )
  }
  await Promise.all(tarefas)
  registar(erros === 0, `P01 pooler: ${N} transacções concorrentes (A, B, sem contexto), ${erros} com fuga`,
    valoresDeSessaoVistos ? `${valoresDeSessaoVistos} transacções sem contexto viram um valor residual (sem efeito)` : '')
}

{
  // Controlo: contexto definido ao nível da SESSÃO (proibido no código) em várias ligações do pool.
  // O valor pode passar para transacções de outros clientes; a marca da transacção tem de o anular.
  const sujar = []
  for (let i = 0; i < 30; i++) {
    sujar.push(
      pool.query(`SELECT set_config('nexo.empresa_id', $1, false), set_config('nexo.inicio', extract(epoch FROM now())::text, false)`, [A]),
    )
  }
  await Promise.all(sujar)
  let fugas = 0
  let herdados = 0
  const tarefas = []
  for (let i = 0; i < 300; i++) {
    tarefas.push(
      transaccao(null).then((r) => {
        if (r.total !== 0) fugas++
        if (r.herdado) herdados++
      }),
    )
  }
  await Promise.all(tarefas)
  registar(fugas === 0, `P02 pooler: contexto de sessão residual não dá acesso (${fugas} fugas em 300)`,
    `${herdados} transacções herdaram o valor residual; a marca da transacção anulou-o`)
  // Limpeza dos valores de sessão residuais nas ligações do pool.
  const limpar = []
  for (let i = 0; i < 60; i++) limpar.push(pool.query(`SELECT set_config('nexo.empresa_id', '', false), set_config('nexo.inicio', '', false)`))
  await Promise.all(limpar)
}
await pool.end()

// 4. Limpeza opcional
if (process.argv.includes('--limpar-no-fim')) {
  await comCliente(env.NEXO_ISO_ADMIN_URL, (c) => c.query(lerSql('00_limpar.sql')))
  console.log('Esquema e papéis de teste removidos.')
}

const esperados = 20 // T01–T20 do ficheiro 03_testes.sql
const nTestesBase = resultados.filter((r) => /^T\d+/.test(r.nome)).length
if (nTestesBase !== esperados) registar(false, `Recebidos ${nTestesBase} resultados de 03_testes.sql (esperados ${esperados})`)
for (const r of resultados) console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`)
const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações OK`)
process.exit(falhas ? 1 : 0)
