// Configuração da API, validada no arranque. Um erro aqui impede o servidor de arrancar.
//
// Só a ligação de EXECUÇÃO (papel nexo_api, Transaction pooler) pertence à API. A ligação
// administrativa das migrações (DATABASE_ADMIN_URL) é lida apenas pelos scripts de migração
// (src/base/migracoes) e nunca por este módulo.

import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const AMBIENTES = ['desenvolvimento', 'teste', 'producao'] as const
export type Ambiente = (typeof AMBIENTES)[number]

const NIVEIS_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

// Utilizadores que nunca podem ser usados pela API (H-01, requisito R3).
// No pooler do Supabase o utilizador tem a forma "<papel>.<referência-do-projecto>".
const PAPEIS_PROIBIDOS = ['postgres', 'service_role', 'supabase_admin', 'authenticator', 'nexo_proprietario']

const esquema = z
  .object({
    NEXO_AMBIENTE: z.enum(AMBIENTES).default('desenvolvimento'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGENS: z.string().default('http://localhost:5173'),
    LOG_NIVEL: z.enum(NIVEIS_LOG).default('info'),
    DATABASE_URL: z.string().optional(),
    DB_CA_CERT_FICHEIRO: z.string().optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((v, ctx) => {
    for (const origem of origensDe(v.CORS_ORIGENS)) {
      if (!urlValido(origem)) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGENS'], message: `origem inválida: ${origem}` })
    }
    if (v.NEXO_AMBIENTE === 'producao' && !v.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obrigatória em produção' })
    }
    if (v.DATABASE_URL) {
      const problema = problemaDaLigacao(v.DATABASE_URL, v.DB_CA_CERT_FICHEIRO, v.NEXO_AMBIENTE)
      if (problema) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: problema })
    }
  })

export interface ConfiguracaoBase {
  /** Texto de ligação sem parâmetros de TLS (a TLS é configurada à parte). Nunca registar. */
  ligacao: string
  /** Certificado da autoridade que assina o servidor; null só para PostgreSQL local sem TLS. */
  tls: { ca: string; rejectUnauthorized: true } | null
  poolMax: number
  /** Para mensagens e logs: só o servidor e a porta, sem utilizador nem palavra-passe. */
  descricao: string
}

export interface Configuracao {
  ambiente: Ambiente
  porta: number
  origensCors: string[]
  nivelLog: (typeof NIVEIS_LOG)[number]
  base: ConfiguracaoBase | null
  /** A rota da prova técnica de assinatura (Etapa 1) só existe em desenvolvimento. */
  provaAssinaturaActiva: boolean
}

export class ErroConfiguracao extends Error {}

export function lerConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const r = esquema.safeParse(env)
  if (!r.success) {
    // Só nomes de variáveis e motivos; nunca os valores.
    const linhas = r.error.issues.map((i) => `- ${i.path.join('.') || '(geral)'}: ${i.message}`)
    throw new ErroConfiguracao(`Configuração inválida:\n${linhas.join('\n')}`)
  }
  const v = r.data
  return {
    ambiente: v.NEXO_AMBIENTE,
    porta: v.PORT,
    origensCors: origensDe(v.CORS_ORIGENS),
    nivelLog: v.LOG_NIVEL,
    base: v.DATABASE_URL ? configuracaoBase(v.DATABASE_URL, v.DB_CA_CERT_FICHEIRO, v.DB_POOL_MAX) : null,
    provaAssinaturaActiva: v.NEXO_AMBIENTE === 'desenvolvimento',
  }
}

function origensDe(texto: string): string[] {
  return texto
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function urlValido(texto: string): boolean {
  try {
    const u = new URL(texto)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function hostLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

function problemaDaLigacao(texto: string, caFicheiro: string | undefined, ambiente: Ambiente): string | null {
  let u: URL
  try {
    u = new URL(texto)
  } catch {
    return 'não é um URL de ligação válido'
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return 'tem de começar por postgresql://'
  const papel = decodeURIComponent(u.username).split('.')[0]
  if (!papel) return 'falta o utilizador'
  if (PAPEIS_PROIBIDOS.includes(papel)) {
    return `o utilizador "${papel}" é administrativo ou ignora as políticas; a API usa só nexo_api (H-01)`
  }
  const sslmode = u.searchParams.get('sslmode')
  if (sslmode && ['disable', 'allow', 'prefer', 'no-verify'].includes(sslmode)) {
    return `sslmode=${sslmode} não valida o certificado; retire-o e indique DB_CA_CERT_FICHEIRO`
  }
  if (!hostLocal(u.hostname) && !caFicheiro) {
    return 'servidor remoto exige DB_CA_CERT_FICHEIRO (TLS com validação do certificado)'
  }
  if (ambiente === 'producao' && hostLocal(u.hostname)) return 'em produção a base não pode ser local'
  return null
}

function configuracaoBase(texto: string, caFicheiro: string | undefined, poolMax: number): ConfiguracaoBase {
  const u = new URL(texto)
  // Os parâmetros de TLS do URL substituiriam a configuração abaixo no driver: retiram-se.
  for (const p of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) u.searchParams.delete(p)
  let tls: ConfiguracaoBase['tls'] = null
  if (caFicheiro) {
    let ca: string
    try {
      ca = readFileSync(caFicheiro, 'utf8')
    } catch {
      throw new ErroConfiguracao(`Configuração inválida:\n- DB_CA_CERT_FICHEIRO: não foi possível ler o ficheiro indicado`)
    }
    if (!ca.includes('BEGIN CERTIFICATE')) {
      throw new ErroConfiguracao('Configuração inválida:\n- DB_CA_CERT_FICHEIRO: o ficheiro não contém um certificado PEM')
    }
    tls = { ca, rejectUnauthorized: true }
  }
  return {
    ligacao: u.toString(),
    tls,
    poolMax,
    descricao: `${u.hostname}:${u.port || '5432'}`,
  }
}
