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
    // Sessões (Etapa 3). Propostas ajustáveis no piloto.
    SESSAO_DURACAO_HORAS: z.coerce.number().min(1).max(24).default(12),
    SESSAO_INACTIVIDADE_MINUTOS: z.coerce.number().int().min(5).max(1440).default(240),
    SESSAO_COOKIE_SEGURO: z.enum(['sim', 'nao']).optional(),
    // Proxies à frente da API (0 = nenhum). Necessário para os limites por IP atrás de um proxy.
    NEXO_PROXIES_CONFIAVEIS: z.coerce.number().int().min(0).max(3).default(0),
    // Endereço da aplicação web, usado nos links dos e-mails (confirmação e recuperação).
    NEXO_URL_APLICACAO: z.string().default('http://localhost:5173'),
    // Envio de e-mail: ficheiro (só desenvolvimento/teste: caixa de saída local), smtp ou desactivado.
    EMAIL_TRANSPORTE: z.enum(['ficheiro', 'smtp', 'desactivado']).optional(),
    EMAIL_PASTA: z.string().default('correio-dev'),
    EMAIL_REMETENTE: z.string().optional(),
    SMTP_SERVIDOR: z.string().optional(),
    SMTP_PORTA: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_TLS_IMPLICITO: z.enum(['sim', 'nao']).default('nao'),
    SMTP_UTILIZADOR: z.string().optional(),
    SMTP_SENHA: z.string().optional(),
    SMTP_CA_FICHEIRO: z.string().optional(),
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
    if (v.SESSAO_INACTIVIDADE_MINUTOS > v.SESSAO_DURACAO_HORAS * 60) {
      ctx.addIssue({ code: 'custom', path: ['SESSAO_INACTIVIDADE_MINUTOS'], message: 'não pode exceder a duração da sessão' })
    }
    if (!urlValido(v.NEXO_URL_APLICACAO)) {
      ctx.addIssue({ code: 'custom', path: ['NEXO_URL_APLICACAO'], message: 'tem de ser um URL http(s)' })
    }
    if (v.NEXO_AMBIENTE === 'producao') {
      if (v.SESSAO_COOKIE_SEGURO === 'nao') ctx.addIssue({ code: 'custom', path: ['SESSAO_COOKIE_SEGURO'], message: 'em produção o cookie é sempre Secure' })
      if (!v.NEXO_URL_APLICACAO.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['NEXO_URL_APLICACAO'], message: 'em produção tem de ser https://' })
      if ((v.EMAIL_TRANSPORTE ?? 'smtp') !== 'smtp') ctx.addIssue({ code: 'custom', path: ['EMAIL_TRANSPORTE'], message: 'em produção só smtp (a recuperação do proprietário depende do e-mail)' })
    }
    if ((v.EMAIL_TRANSPORTE ?? transportePorOmissao(v.NEXO_AMBIENTE)) === 'smtp') {
      for (const nome of ['SMTP_SERVIDOR', 'EMAIL_REMETENTE'] as const) {
        if (!v[nome]) ctx.addIssue({ code: 'custom', path: [nome], message: 'obrigatória com EMAIL_TRANSPORTE=smtp' })
      }
      if (Boolean(v.SMTP_UTILIZADOR) !== Boolean(v.SMTP_SENHA)) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_SENHA'], message: 'SMTP_UTILIZADOR e SMTP_SENHA vêm juntos' })
      }
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

export interface ConfiguracaoSessao {
  duracaoMs: number
  inactividadeMs: number
  /** Cookie com Secure (e prefixo __Host-). Sempre em produção; em desenvolvimento por http, não. */
  cookieSeguro: boolean
}

export type ConfiguracaoEmail =
  | { transporte: 'desactivado' }
  | { transporte: 'ficheiro'; pasta: string }
  | {
      transporte: 'smtp'
      remetente: string
      servidor: string
      porta: number
      tlsImplicito: boolean
      /** Nunca registar. */
      autenticacao: { utilizador: string; senha: string } | null
      ca: string | null
    }

export interface Configuracao {
  ambiente: Ambiente
  porta: number
  origensCors: string[]
  nivelLog: (typeof NIVEIS_LOG)[number]
  base: ConfiguracaoBase | null
  /** A rota da prova técnica de assinatura (Etapa 1) só existe em desenvolvimento. */
  provaAssinaturaActiva: boolean
  sessao: ConfiguracaoSessao
  proxiesConfiaveis: number
  /** Base dos links enviados por e-mail (sem barra final). */
  urlAplicacao: string
  email: ConfiguracaoEmail
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
    sessao: {
      duracaoMs: v.SESSAO_DURACAO_HORAS * 3_600_000,
      inactividadeMs: v.SESSAO_INACTIVIDADE_MINUTOS * 60_000,
      cookieSeguro: v.NEXO_AMBIENTE === 'producao' || v.SESSAO_COOKIE_SEGURO === 'sim',
    },
    proxiesConfiaveis: v.NEXO_PROXIES_CONFIAVEIS,
    urlAplicacao: v.NEXO_URL_APLICACAO.replace(/\/+$/, ''),
    email: configuracaoEmail(v),
  }
}

function transportePorOmissao(ambiente: Ambiente): 'ficheiro' | 'smtp' {
  return ambiente === 'producao' ? 'smtp' : 'ficheiro'
}

function configuracaoEmail(v: z.infer<typeof esquema>): ConfiguracaoEmail {
  const transporte = v.EMAIL_TRANSPORTE ?? transportePorOmissao(v.NEXO_AMBIENTE)
  if (transporte === 'desactivado') return { transporte }
  if (transporte === 'ficheiro') return { transporte, pasta: v.EMAIL_PASTA }
  let ca: string | null = null
  if (v.SMTP_CA_FICHEIRO) {
    try {
      ca = readFileSync(v.SMTP_CA_FICHEIRO, 'utf8')
    } catch {
      throw new ErroConfiguracao('Configuração inválida:\n- SMTP_CA_FICHEIRO: não foi possível ler o ficheiro indicado')
    }
  }
  return {
    transporte,
    remetente: v.EMAIL_REMETENTE as string,
    servidor: v.SMTP_SERVIDOR as string,
    porta: v.SMTP_PORTA,
    tlsImplicito: v.SMTP_TLS_IMPLICITO === 'sim',
    autenticacao: v.SMTP_UTILIZADOR && v.SMTP_SENHA ? { utilizador: v.SMTP_UTILIZADOR, senha: v.SMTP_SENHA } : null,
    ca,
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
