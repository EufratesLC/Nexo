// Executor de migrações versionadas (backend/migracoes/NNNN_nome.sql).
//
// - Usa SÓ a ligação administrativa (DATABASE_ADMIN_URL), nunca a da API.
// - Cada migração corre numa transacção; o registo em nexo_controlo.migracoes é gravado na
//   mesma transacção. Uma falha desfaz a migração inteira.
// - Uma migração aplicada nunca é reaplicada; se o ficheiro mudar depois de aplicado, o executor
//   recusa continuar (o histórico não se reescreve: corrige-se com uma migração nova).
// - Não há "reset", "down" nem DROP automático.
// - A primeira linha "-- nexo:executar-como <papel>" escolhe o papel: "administrador" (o
//   utilizador da ligação) ou "nexo_proprietario" (SET LOCAL ROLE).

import { createHash, createHmac, pbkdf2Sync } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Migracao {
  versao: string
  nome: string
  ficheiro: string
  conteudo: string
  resumo: string
  executarComo: 'administrador' | 'nexo_proprietario'
}

export interface ClienteMigracoes {
  query(texto: string, valores?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

const NOME_FICHEIRO = /^(\d{4})_([a-z0-9_]+)\.sql$/
const DIRECTIVA = /^--\s*nexo:executar-como\s+(administrador|nexo_proprietario)\s*$/m
const CONTROLO_TRANSACCAO = /^\s*(begin|commit|rollback|start\s+transaction|end)\s*;/im

export function lerMigracoes(pasta: string): Migracao[] {
  const ficheiros = readdirSync(pasta)
    .filter((f) => f.endsWith('.sql') && f !== 'verificacoes.sql')
    .sort()
  const versoes = new Set<string>()
  return ficheiros.map((ficheiro) => {
    const m = NOME_FICHEIRO.exec(ficheiro)
    if (!m) throw new Error(`nome de migração inválido: ${ficheiro} (esperado NNNN_nome.sql)`)
    if (versoes.has(m[1])) throw new Error(`versão repetida: ${m[1]}`)
    versoes.add(m[1])
    const conteudo = readFileSync(join(pasta, ficheiro), 'utf8').replace(/\r\n/g, '\n')
    const directiva = DIRECTIVA.exec(conteudo.split('\n')[0] ?? '')
    if (!directiva) throw new Error(`${ficheiro}: a primeira linha tem de ser "-- nexo:executar-como <administrador|nexo_proprietario>"`)
    // Os corpos $…$ (funções, DO) têm BEGIN/END de PL/pgSQL, que não são controlo de transacção.
    const foraDeCorpos = conteudo.replace(/\$\$[\s\S]*?\$\$/g, "''").replace(/--.*$/gm, '')
    if (CONTROLO_TRANSACCAO.test(foraDeCorpos)) throw new Error(`${ficheiro}: não pode conter BEGIN/COMMIT/ROLLBACK (o executor gere a transacção)`)
    return {
      versao: m[1],
      nome: m[2],
      ficheiro,
      conteudo,
      resumo: createHash('sha256').update(conteudo).digest('hex'),
      executarComo: directiva[1] as Migracao['executarComo'],
    }
  })
}

export const SQL_PREPARAR_CONTROLO = `
CREATE SCHEMA IF NOT EXISTS nexo_controlo;
REVOKE ALL ON SCHEMA nexo_controlo FROM PUBLIC;
CREATE TABLE IF NOT EXISTS nexo_controlo.migracoes (
  versao text PRIMARY KEY,
  nome text NOT NULL,
  resumo text NOT NULL,
  aplicada_em timestamptz NOT NULL DEFAULT now(),
  aplicada_por text NOT NULL DEFAULT current_user
);
REVOKE ALL ON nexo_controlo.migracoes FROM PUBLIC;
`

export interface EstadoMigracoes {
  aplicadas: { versao: string; nome: string; aplicadaEm: string }[]
  pendentes: Migracao[]
  alteradas: Migracao[]
  desconhecidas: string[]
}

export async function estadoMigracoes(cliente: ClienteMigracoes, migracoes: Migracao[]): Promise<EstadoMigracoes> {
  const existe = await cliente.query(`SELECT to_regclass('nexo_controlo.migracoes') IS NOT NULL AS existe`)
  const linhas = existe.rows[0]?.existe
    ? (await cliente.query('SELECT versao, nome, resumo, aplicada_em FROM nexo_controlo.migracoes ORDER BY versao')).rows
    : []
  const porVersao = new Map(linhas.map((l) => [String(l.versao), l]))
  const conhecidas = new Set(migracoes.map((m) => m.versao))
  return {
    aplicadas: linhas.map((l) => ({ versao: String(l.versao), nome: String(l.nome), aplicadaEm: new Date(l.aplicada_em as string).toISOString() })),
    pendentes: migracoes.filter((m) => !porVersao.has(m.versao)),
    alteradas: migracoes.filter((m) => porVersao.has(m.versao) && porVersao.get(m.versao)?.resumo !== m.resumo),
    desconhecidas: linhas.map((l) => String(l.versao)).filter((v) => !conhecidas.has(v)),
  }
}

export async function aplicarMigracoes(
  cliente: ClienteMigracoes,
  migracoes: Migracao[],
  aoAplicar: (m: Migracao) => void = () => {},
): Promise<Migracao[]> {
  // Um único executor de cada vez (bloqueio de sessão: exige Session pooler ou ligação directa).
  await cliente.query(`SELECT pg_advisory_lock(hashtext('nexo.migracoes'))`)
  try {
    await cliente.query(SQL_PREPARAR_CONTROLO)
    const estado = await estadoMigracoes(cliente, migracoes)
    if (estado.alteradas.length) {
      throw new Error(`migrações aplicadas foram alteradas depois de aplicadas: ${estado.alteradas.map((m) => m.ficheiro).join(', ')}`)
    }
    if (estado.desconhecidas.length) {
      throw new Error(`a base tem migrações que não existem nesta cópia do projecto: ${estado.desconhecidas.join(', ')}`)
    }
    const aplicadas: Migracao[] = []
    for (const m of estado.pendentes) {
      await cliente.query('BEGIN')
      try {
        if (m.executarComo === 'nexo_proprietario') await cliente.query('SET LOCAL ROLE nexo_proprietario')
        await cliente.query(m.conteudo)
        await cliente.query('RESET ROLE')
        await cliente.query('INSERT INTO nexo_controlo.migracoes (versao, nome, resumo) VALUES ($1, $2, $3)', [m.versao, m.nome, m.resumo])
        await cliente.query('COMMIT')
      } catch (erro) {
        await cliente.query('ROLLBACK').catch(() => {})
        throw new Error(`falhou a migração ${m.ficheiro}: ${erro instanceof Error ? erro.message : String(erro)}`)
      }
      aplicadas.push(m)
      aoAplicar(m)
    }
    return aplicadas
  } finally {
    await cliente.query(`SELECT pg_advisory_unlock(hashtext('nexo.migracoes'))`).catch(() => {})
  }
}

/**
 * Resumo SCRAM-SHA-256 de uma palavra-passe, no formato aceite por ALTER ROLE … PASSWORD
 * (RFC 5802 / RFC 7677, como faz o \password do psql). Assim a palavra-passe em claro nunca
 * é enviada ao servidor nem pode aparecer nos registos de instruções.
 */
export function resumoScram(palavraPasse: string, sal: Buffer, iteracoes = 4096): string {
  const salgada = pbkdf2Sync(palavraPasse, sal, iteracoes, 32, 'sha256')
  const chaveCliente = createHmac('sha256', salgada).update('Client Key').digest()
  const chaveGuardada = createHash('sha256').update(chaveCliente).digest()
  const chaveServidor = createHmac('sha256', salgada).update('Server Key').digest()
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString('base64')}$${chaveGuardada.toString('base64')}:${chaveServidor.toString('base64')}`
}
