// Diagnóstico das ligações da sessão do terminal, sem segredos. Na pasta backend:
//
//   npx tsx src/base/migracoes/ligacoes.ts            só analisa os URLs (não se liga a nada)
//   npx tsx src/base/migracoes/ligacoes.ts --testar   + UMA tentativa de ligação por URL distinto
//
// Lê DATABASE_ADMIN_URL, NEXO_TESTE_ADMIN_URL, NEXO_TESTE_API_URL, DATABASE_URL, DB_CA_CERT_FICHEIRO
// e NEXO_TESTE_CONFIRMO. Nunca imprime URLs, utilizadores com palavra-passe nem partes de
// palavras-passe. Uma tentativa por URL, para não alimentar o bloqueio por falhas do pooler.

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { sanitizar } from '../../registo/sanitizar.js'
import { analisarLigacao, classificarFalha, mesmaPalavraPasse, type AnaliseLigacao } from './diagnosticoLigacoes.js'

const VARIAVEIS = [
  { nome: 'DATABASE_ADMIN_URL', papel: 'postgres', porta: 5432, admin: true },
  { nome: 'NEXO_TESTE_ADMIN_URL', papel: 'postgres', porta: 5432, admin: true },
  { nome: 'NEXO_TESTE_API_URL', papel: 'nexo_api', porta: 6543, admin: false },
  { nome: 'DATABASE_URL', papel: 'nexo_api', porta: 6543, admin: false },
] as const

const local = (texto: string) => {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(texto).hostname)
  } catch {
    return false
  }
}

function mostrar(a: AnaliseLigacao): void {
  if (!a.definida) {
    console.log(`- ${a.variavel}: não definida nesta sessão`)
    return
  }
  console.log(`- ${a.variavel}: ${a.destino ?? '?'} · papel ${a.papel ?? '?'}${a.ref ? ` · ref ${a.ref}` : ''} · palavra-passe ${a.temPalavraPasse ? 'presente' : 'AUSENTE'}`)
  for (const p of a.problemas) console.log(`    PROBLEMA  ${p}`)
  for (const v of a.avisos) console.log(`    aviso     ${v}`)
}

async function main(): Promise<void> {
  const testar = process.argv.includes('--testar')
  let problemas = 0
  console.log('Ligações nesta sessão (sem segredos):')
  const analises = VARIAVEIS.map((v) => {
    const texto = process.env[v.nome]
    // Localmente o administrador não se chama "postgres": só se exige no Supabase.
    const papel = v.admin && texto && local(texto) ? (texto ? decodeURIComponent(new URL(texto).username).split('.')[0] : v.papel) : v.papel
    const a = analisarLigacao(v.nome, texto, { papel, porta: texto && local(texto) ? undefined : v.porta })
    mostrar(a)
    problemas += a.problemas.length
    return a
  })

  // Coerência entre variáveis.
  console.log('Coerência:')
  const refs = new Set(analises.filter((a) => a.definida && a.ref).map((a) => a.ref))
  if (refs.size > 1) {
    console.log('    PROBLEMA  as ligações apontam para projectos diferentes (refs diferentes)')
    problemas++
  } else if (refs.size === 1) console.log(`    ok        todas as ligações com ref são do mesmo projecto`)
  for (const [x, y] of [
    ['NEXO_TESTE_API_URL', 'DATABASE_URL'],
    ['NEXO_TESTE_ADMIN_URL', 'DATABASE_ADMIN_URL'],
  ] as const) {
    const igual = mesmaPalavraPasse(x, y)
    if (igual === false) {
      console.log(`    PROBLEMA  ${x} e ${y} têm palavras-passe diferentes (uma delas está errada)`)
      problemas++
    } else if (igual) console.log(`    ok        ${x} e ${y} têm a mesma palavra-passe`)
  }
  const confirmo = process.env.NEXO_TESTE_CONFIRMO
  const ref = [...refs][0]
  if (confirmo && ref && confirmo !== ref) console.log(`    aviso     NEXO_TESTE_CONFIRMO (${confirmo}) difere da ref das ligações (${ref})`)
  const ca = process.env.DB_CA_CERT_FICHEIRO
  if (ca) {
    try {
      const pem = readFileSync(ca, 'utf8')
      console.log(pem.includes('BEGIN CERTIFICATE') ? '    ok        DB_CA_CERT_FICHEIRO legível e com certificado PEM' : '    PROBLEMA  DB_CA_CERT_FICHEIRO não contém um certificado PEM')
      if (!pem.includes('BEGIN CERTIFICATE')) problemas++
    } catch {
      console.log(`    PROBLEMA  DB_CA_CERT_FICHEIRO não se consegue ler a partir de ${process.cwd()} (caminho relativo à pasta backend?)`)
      problemas++
    }
  } else if (analises.some((a) => a.definida && a.destino && !a.destino.startsWith('localhost') && !a.destino.startsWith('127.'))) {
    console.log('    PROBLEMA  DB_CA_CERT_FICHEIRO não definida (obrigatória para o Supabase)')
    problemas++
  }

  if (!testar) {
    console.log(problemas ? `\n${problemas} problema(s) de forma. Corrija-os antes de testar ligações.` : '\nSem problemas de forma. Para uma tentativa real por ligação: --testar')
    process.exitCode = problemas ? 1 : 0
    return
  }

  console.log('\nTentativas (uma por URL distinto):')
  const sslBase = ca ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true as const } : undefined
  const feitos = new Set<string>()
  for (const v of VARIAVEIS) {
    const texto = process.env[v.nome]
    if (!texto || feitos.has(texto)) continue
    feitos.add(texto)
    const u = new URL(texto)
    for (const p of ['sslmode', 'sslrootcert', 'ssl', 'sslcert', 'sslkey']) u.searchParams.delete(p)
    const c = new pg.Client({ connectionString: u.toString(), ssl: local(texto) ? undefined : sslBase, connectionTimeoutMillis: 10_000, application_name: 'nexo-diagnostico' })
    try {
      await c.connect()
      const quem = (await c.query('SELECT current_user AS u, version() AS v')).rows[0]
      let extra = ''
      if (v.admin) {
        const existe = (await c.query("SELECT to_regclass('nexo_controlo.migracoes') IS NOT NULL AS e")).rows[0].e
        extra = existe ? ` · migrações aplicadas: ${(await c.query('SELECT string_agg(versao, \',\' ORDER BY versao) AS l FROM nexo_controlo.migracoes')).rows[0].l ?? 'nenhuma'}` : ' · sem tabela de migrações'
      } else {
        const existe = (await c.query("SELECT to_regprocedure('nexo.estado_base()') IS NOT NULL AS e")).rows[0].e
        extra = existe ? ` · última migração (vista pela API): ${(await c.query('SELECT versao FROM nexo.estado_base()')).rows[0]?.versao ?? '—'}` : ''
      }
      console.log(`- ${v.nome}: LIGOU como ${quem.u} (${String(quem.v).split(' ').slice(0, 2).join(' ')})${extra}`)
    } catch (erro) {
      const { causa, explicacao } = classificarFalha(erro)
      const e = erro as { code?: string; message?: string }
      problemas++
      console.log(`- ${v.nome}: FALHOU — ${causa}`)
      console.log(`    ${explicacao}`)
      console.log(`    (código ${e.code ?? '—'}: ${sanitizar(String(e.message ?? '')).slice(0, 160)})`)
    } finally {
      await c.end().catch(() => {})
    }
  }
  process.exitCode = problemas ? 1 : 0
}

main().catch((erro) => {
  console.error(`Erro: ${sanitizar(erro instanceof Error ? erro.message : String(erro))}`)
  process.exit(1)
})
