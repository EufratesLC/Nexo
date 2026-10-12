// Verificação prévia dos testes de base (importada no início de cada ficheiro de testes/base).
//
// Faz UMA ligação com cada URL (API e administrativa) antes dos testes. Se uma falhar, o ficheiro
// falha logo com a causa classificada, sem abrir as dezenas de ligações da suite. Assim uma
// palavra-passe errada não leva o pooler do Supabase a bloquear o utilizador por excesso de
// falhas (ECIRCUITBREAKER), como aconteceu a 11/10/2026.
//
// Dentro da mesma execução de "npm run test:base", depois da primeira falha os ficheiros seguintes
// não voltam a tentar: usam a falha registada (ficheiro temporário marcado com o processo pai).
// Sem as variáveis, não faz nada (os testes ficam saltados, como antes, e o resumo diz porquê).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { classificarFalha } from '../../src/base/migracoes/diagnosticoLigacoes.js'
import { sanitizar } from '../../src/registo/sanitizar.js'

const API = process.env.NEXO_TESTE_API_URL
const ADMIN = process.env.NEXO_TESTE_ADMIN_URL
const CA = process.env.DB_CA_CERT_FICHEIRO
const MARCA = join(tmpdir(), `nexo-test-base-falha-${process.ppid}.txt`)

async function tentar(nome: string, ligacao: string): Promise<string | undefined> {
  const ssl = CA ? { ca: readFileSync(CA, 'utf8'), rejectUnauthorized: true } : undefined
  const c = new pg.Client({ connectionString: ligacao, ssl, connectionTimeoutMillis: 15_000, application_name: 'nexo-verificacao-previa' })
  try {
    await c.connect()
    await c.query('SELECT 1')
    return undefined
  } catch (erro) {
    const { causa, explicacao } = classificarFalha(erro)
    const e = erro as { code?: string; message?: string }
    return `${nome}: ${causa} — ${explicacao} (código ${e.code ?? '—'}: ${sanitizar(String(e.message ?? '')).slice(0, 160)})`
  } finally {
    await c.end().catch(() => {})
  }
}

if (API && ADMIN && process.env.NEXO_TESTE_CONFIRMO) {
  let falha: string | undefined
  if (existsSync(MARCA)) {
    falha = `${readFileSync(MARCA, 'utf8')} [registada por um ficheiro anterior desta execução; não se voltou a tentar]`
  } else {
    falha = (await tentar('NEXO_TESTE_ADMIN_URL', ADMIN)) ?? (await tentar('NEXO_TESTE_API_URL', API))
    if (falha) writeFileSync(MARCA, falha, 'utf8')
  }
  if (falha) {
    throw new Error(
      `Verificação prévia falhou; nenhum teste foi executado neste ficheiro.\n${falha}\n` +
        'Diagnóstico sem segredos: npx tsx src/base/migracoes/ligacoes.ts (e depois --testar, uma vez).',
    )
  }
}
