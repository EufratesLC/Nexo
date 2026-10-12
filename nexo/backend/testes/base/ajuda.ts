// Ajudas comuns aos testes contra PostgreSQL real (testes/base). Ver integracao.test.ts e
// docs/Nexo_Ambientes.md (secção 2.6) para as variáveis.
//
// Os dados de teste são empresas fictícias com códigos "t-…" aleatórios, criadas pelos próprios
// testes. A limpeza apaga SÓ essas empresas, pela ligação administrativa, como dono das tabelas
// (nexo_proprietario), com o FORCE e o trigger de imutabilidade da auditoria retirados apenas
// dentro da transacção de limpeza. Nenhuma outra sessão vê o estado intermédio.
process.env.NEXO_AMBIENTE = 'teste'

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { criarAcessoBase, type AcessoBase } from '../../src/base/acesso.js'
import { lerConfiguracao, type Configuracao } from '../../src/config/ambiente.js'
import { criarLogger, type Logger } from '../../src/registo/logger.js'

export const API = process.env.NEXO_TESTE_API_URL
export const ADMIN = process.env.NEXO_TESTE_ADMIN_URL
const CA = process.env.DB_CA_CERT_FICHEIRO
export const motivoSalto =
  !API || !ADMIN ? 'defina NEXO_TESTE_API_URL e NEXO_TESTE_ADMIN_URL (base de desenvolvimento)' : !process.env.NEXO_TESTE_CONFIRMO ? 'defina NEXO_TESTE_CONFIRMO' : undefined

export const ssl = CA ? { ca: readFileSync(CA, 'utf8'), rejectUnauthorized: true } : undefined

export function configTeste(extra: NodeJS.ProcessEnv = {}): Configuracao {
  return lerConfiguracao({ NEXO_AMBIENTE: 'teste', DATABASE_URL: API, DB_CA_CERT_FICHEIRO: CA, DB_POOL_MAX: '4', EMAIL_TRANSPORTE: 'desactivado', ...extra })
}

export function acessoTeste(config: Configuracao, logger: Logger = criarLogger('silent')): AcessoBase {
  return criarAcessoBase(config.base, logger)
}

export async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: ADMIN, ssl })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Cliente "cru" como nexo_api (sem o módulo de acesso), para testar o que a ligação não consegue fazer. */
export async function clienteApi(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: API, ssl })
  await c.connect()
  return c
}

/** Executa como dono das tabelas, com o FORCE retirado só nesta transacção (preparação e verificação dos testes). */
export async function comoDono<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  return admin(async (c) => {
    await c.query('BEGIN')
    try {
      await c.query('SET LOCAL ROLE nexo_proprietario')
      for (const t of TABELAS) await c.query(`ALTER TABLE nexo.${t} NO FORCE ROW LEVEL SECURITY`)
      const r = await fn(c)
      for (const t of TABELAS) await c.query(`ALTER TABLE nexo.${t} FORCE ROW LEVEL SECURITY`)
      await c.query('COMMIT')
      return r
    } catch (erro) {
      await c.query('ROLLBACK').catch(() => {})
      throw erro
    }
  })
}

const TABELAS = ['registo_auditoria', 'tokens_email', 'contactos_recuperacao', 'sessoes', 'credenciais_acesso', 'utilizador_filiais', 'utilizadores', 'filiais', 'empresas']

export async function limparEmpresas(codigos: string[]): Promise<void> {
  if (!codigos.length) return
  await comoDono(async (c) => {
    const ids = (await c.query<{ id: string }>('SELECT id FROM nexo.empresas WHERE codigo = ANY($1)', [codigos])).rows.map((r) => r.id)
    if (!ids.length) return
    await c.query('ALTER TABLE nexo.registo_auditoria DISABLE TRIGGER registo_auditoria_imutavel')
    for (const t of TABELAS) {
      await c.query(`DELETE FROM nexo.${t} WHERE ${t === 'empresas' ? 'id' : 'empresa_id'} = ANY($1::uuid[])`, [ids])
    }
    await c.query('ALTER TABLE nexo.registo_auditoria ENABLE TRIGGER registo_auditoria_imutavel')
  })
}

export function codigoEmpresaTeste(): string {
  return `t-${randomBytes(5).toString('hex')}`
}

export async function codigoDoErro(promessa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promessa
    return undefined
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message
  }
}

export const CODIGO_DONO = 'Caju verde na feira 2026'
export const CODIGO_FUNC = 'Balcão norte, porta 7'
