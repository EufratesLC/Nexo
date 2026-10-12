// Comandos de base de dados (só para administração; nunca usados pela API). Na pasta backend:
//
//   npx tsx src/base/migracoes/cli.ts estado                       migrações, papéis e pertenças
//   npx tsx src/base/migracoes/cli.ts migrar --confirmo <alvo>     aplica as pendentes
//   npx tsx src/base/migracoes/cli.ts verificar                    verificação do catálogo (H-01, R1)
//   npx tsx src/base/migracoes/cli.ts senha-api --confirmo <alvo>  palavra-passe de nexo_api (NEXO_SENHA_API)
//   npx tsx src/base/migracoes/cli.ts suporte-recuperacao --empresa <código> --utilizador <nome>
//        --motivo "<como foi confirmada a identidade>" --confirmo <alvo>
//        recuperação assistida pelo suporte: link de utilização única para um proprietário que
//        perdeu o código E o e-mail (Etapa 3). Fora dos pedidos da API; fica auditado.
//
// O alvo é mostrado pelo comando estado. Em alternativa a --confirmo, a variável NEXO_CONFIRMO.
// (No PowerShell, "npm run db:migrar -- --confirmo x" pode não passar --confirmo ao script:
// o PowerShell trata "--" como fim de parâmetros. Por isso o guia usa npx tsx directamente.)
//
// Lê DATABASE_ADMIN_URL (Session pooler, porta 5432, ou ligação directa) e DB_CA_CERT_FICHEIRO.
// Nunca imprime utilizador, palavra-passe nem o URL completo.

import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { sanitizar } from '../../registo/sanitizar.js'
import { gerarToken } from '../../autenticacao/tokens.js'
import { linkRecuperacao } from '../../email/mensagens.js'
import { aplicarMigracoes, estadoMigracoes, lerMigracoes, resumoScram } from './executor.js'

const PASTA_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migracoes')

function falhar(mensagem: string): never {
  console.error(`Erro: ${sanitizar(mensagem)}`)
  process.exit(1)
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

interface Alvo {
  ligacao: string
  ssl: pg.ClientConfig['ssl']
  /** Identificador a confirmar: referência do projecto Supabase, ou "local". */
  identificador: string
  descricao: string
}

function lerAlvo(): Alvo {
  const texto = process.env.DATABASE_ADMIN_URL
  if (!texto) falhar('defina DATABASE_ADMIN_URL (ligação administrativa ao nexo-dev; ver docs/Nexo_Ambientes.md)')
  if (process.env.NEXO_AMBIENTE === 'producao') {
    falhar('migrações em produção ainda não têm procedimento aprovado (docs/Nexo_Ambientes.md, secção 4)')
  }
  let u: URL
  try {
    u = new URL(texto)
  } catch {
    falhar('DATABASE_ADMIN_URL não é um URL válido')
  }
  if (u.port === '6543') {
    falhar('as migrações não podem usar o Transaction pooler (6543): use o Session pooler (5432) ou a ligação directa')
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname)
  const ca = process.env.DB_CA_CERT_FICHEIRO
  if (!local && !ca) falhar('servidor remoto exige DB_CA_CERT_FICHEIRO (TLS com validação do certificado)')
  for (const p of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) u.searchParams.delete(p)
  const utilizador = decodeURIComponent(u.username)
  const doHost = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1]
  const doUtilizador = utilizador.includes('.') ? utilizador.split('.').slice(1).join('.') : undefined
  return {
    ligacao: u.toString(),
    ssl: ca ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } : undefined,
    identificador: local ? 'local' : (doUtilizador ?? doHost ?? u.hostname),
    descricao: `${u.hostname}:${u.port || '5432'}`,
  }
}

function exigirConfirmacao(alvo: Alvo): void {
  const confirmado = argumento('confirmo') ?? process.env.NEXO_CONFIRMO
  if (confirmado !== alvo.identificador) {
    falhar(
      `confirme o alvo: npx tsx src/base/migracoes/cli.ts ${process.argv[2]} --confirmo ${alvo.identificador}` +
        ` (ou NEXO_CONFIRMO=${alvo.identificador}); alvo actual: ${alvo.descricao}`,
    )
  }
}

async function comCliente<T>(alvo: Alvo, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const cliente = new pg.Client({ connectionString: alvo.ligacao, ssl: alvo.ssl, application_name: 'nexo-migracoes' })
  try {
    await cliente.connect()
  } catch (erro) {
    falhar(`sem ligação a ${alvo.descricao}: ${erro instanceof Error ? erro.message : String(erro)}`)
  }
  try {
    return await fn(cliente)
  } finally {
    await cliente.end()
  }
}

async function main(): Promise<void> {
  const comando = process.argv[2]
  const migracoes = lerMigracoes(PASTA_MIGRACOES)
  const alvo = lerAlvo()
  console.log(`Alvo: ${alvo.descricao} (identificador: ${alvo.identificador})`)

  if (comando === 'estado') {
    await comCliente(alvo, async (c) => {
      const versao = (await c.query('SHOW server_version')).rows[0]?.server_version
      const e = await estadoMigracoes(c, migracoes)
      console.log(`PostgreSQL ${versao}`)
      for (const a of e.aplicadas) console.log(`  aplicada  ${a.versao} ${a.nome} (${a.aplicadaEm})`)
      for (const p of e.pendentes) console.log(`  pendente  ${p.versao} ${p.nome}`)
      for (const m of e.alteradas) console.log(`  ALTERADA  ${m.versao} ${m.nome} — o ficheiro mudou depois de aplicado`)
      for (const d of e.desconhecidas) console.log(`  DESCONHECIDA ${d} — existe na base, não nesta cópia`)
      // Diagnóstico de papéis: atributos perigosos e pertenças (sem dados de ligação).
      const papeis = await c.query(`SELECT rolname, rolcanlogin, rolinherit,
          array_remove(ARRAY[CASE WHEN rolsuper THEN 'SUPERUSER' END, CASE WHEN rolcreatedb THEN 'CREATEDB' END,
            CASE WHEN rolcreaterole THEN 'CREATEROLE' END, CASE WHEN rolreplication THEN 'REPLICATION' END,
            CASE WHEN rolbypassrls THEN 'BYPASSRLS' END], NULL) AS perigosos
        FROM pg_catalog.pg_roles WHERE starts_with(rolname, 'nexo_') ORDER BY rolname`)
      const eu = (await c.query(`SELECT current_user AS u, rolsuper, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = current_user`)).rows[0]
      console.log(`Administrador: ${eu.rolsuper ? 'superutilizador' : 'não é superutilizador'}${eu.rolcreaterole ? ', CREATEROLE' : ''}`)
      if (papeis.rows.length === 0) console.log('  (nenhum papel nexo_* existe ainda)')
      for (const r of papeis.rows) {
        const perigo = (r.perigosos as string[]).length ? `  PROIBIDO: ${(r.perigosos as string[]).join(', ')}` : ''
        console.log(`  papel ${r.rolname}: ${r.rolcanlogin ? 'LOGIN' : 'NOLOGIN'} ${r.rolinherit ? 'INHERIT' : 'NOINHERIT'}${perigo}`)
        if (perigo) process.exitCode = 1
      }
      const pertencas = await c.query(`SELECT u.rolname AS membro, r.rolname AS papel, m.admin_option, m.inherit_option, m.set_option
          FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid = m.roleid JOIN pg_catalog.pg_roles u ON u.oid = m.member
         WHERE starts_with(r.rolname, 'nexo_') AND starts_with(u.rolname, 'nexo_') ORDER BY 1, 2`)
      for (const m of pertencas.rows) {
        const opcoes = [m.admin_option && 'ADMIN', m.inherit_option && 'INHERIT', m.set_option && 'SET'].filter(Boolean).join(', ') || 'nenhuma'
        console.log(`  pertença ${m.membro} → ${m.papel} (${opcoes})`)
      }
      if (e.alteradas.length || e.desconhecidas.length) process.exitCode = 1
    })
  } else if (comando === 'migrar') {
    exigirConfirmacao(alvo)
    await comCliente(alvo, async (c) => {
      const aplicadas = await aplicarMigracoes(c, migracoes, (m) => console.log(`  aplicada  ${m.versao} ${m.nome}`))
      console.log(aplicadas.length ? `${aplicadas.length} migração(ões) aplicada(s).` : 'Nada a aplicar.')
    })
  } else if (comando === 'verificar') {
    const sql = readFileSync(join(PASTA_MIGRACOES, 'verificacoes.sql'), 'utf8')
    await comCliente(alvo, async (c) => {
      const r = await c.query(sql)
      if (r.rows.length === 0) {
        console.log('Verificação do catálogo: OK (nenhum problema).')
      } else {
        for (const l of r.rows) console.log(`  PROBLEMA  ${l.problema}: ${l.objecto}`)
        console.log(`Verificação do catálogo: ${r.rows.length} problema(s).`)
        process.exitCode = 1
      }
    })
  } else if (comando === 'senha-api') {
    exigirConfirmacao(alvo)
    const senha = process.env.NEXO_SENHA_API
    if (!senha) falhar('defina NEXO_SENHA_API só nesta sessão do terminal')
    if (!/^[!-~]{16,}$/.test(senha)) falhar('NEXO_SENHA_API: pelo menos 16 caracteres ASCII imprimíveis, sem espaços')
    const resumo = resumoScram(senha, randomBytes(16))
    await comCliente(alvo, async (c) => {
      await c.query(`ALTER ROLE nexo_api PASSWORD ${c.escapeLiteral(resumo)}`)
    })
    console.log('Palavra-passe de nexo_api definida (enviado só o resumo SCRAM-SHA-256).')
  } else if (comando === 'suporte-recuperacao') {
    exigirConfirmacao(alvo)
    const empresa = argumento('empresa')
    const utilizador = argumento('utilizador')
    const motivo = argumento('motivo')
    if (!empresa || !utilizador || !motivo) {
      falhar('indique --empresa <código>, --utilizador <nome> e --motivo "<como foi confirmada a identidade e o vínculo>"')
    }
    const url = (process.env.NEXO_URL_APLICACAO ?? 'http://localhost:5173').replace(/\/+$/, '')
    const horas = Number(process.env.NEXO_VALIDADE_SUPORTE_HORAS ?? 24)
    if (!Number.isFinite(horas) || horas < 1 || horas > 48) falhar('NEXO_VALIDADE_SUPORTE_HORAS entre 1 e 48')
    const { token, resumo } = gerarToken('email')
    const r = await comCliente(alvo, async (c) => {
      await c.query('BEGIN')
      try {
        // Só nexo_proprietario executa a função (e só o administrador das migrações o pode assumir).
        await c.query('SET LOCAL ROLE nexo_proprietario')
        const linhas = (
          await c.query('SELECT utilizador_id, nome, empresa FROM nexo.suporte_emitir_recuperacao($1, $2, $3, $4::interval, $5)', [
            empresa,
            utilizador,
            resumo,
            `${horas} hours`,
            motivo,
          ])
        ).rows
        await c.query('COMMIT')
        return linhas[0]
      } catch (erro) {
        await c.query('ROLLBACK').catch(() => {})
        throw erro
      }
    })
    console.log(`Proprietário: ${r.nome} — empresa: ${r.empresa}. Registo de auditoria criado (origem: suporte).`)
    console.log('Link de recuperação (mostrado UMA vez; entregue-o só pelo canal confirmado, nunca por e-mail não verificado):')
    console.log(`  ${linkRecuperacao(url, token)}`)
    console.log(`Válido durante ${horas} h, uma única utilização. Pedir ao proprietário que registe um novo e-mail de recuperação.`)
  } else {
    falhar('comando desconhecido: use estado, migrar, verificar, senha-api ou suporte-recuperacao')
  }
}

main().catch((erro) => falhar(erro instanceof Error ? erro.message : String(erro)))
