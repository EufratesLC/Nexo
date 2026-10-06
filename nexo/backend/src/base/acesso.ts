// Módulo único de acesso à base de dados da API (H-01).
//
// - Uma só ligação: papel nexo_api pelo Transaction pooler, com TLS validado (config/ambiente.ts).
// - O pool NÃO é exportado. Todo o acesso passa por executarTransaccao() ou pelo diagnóstico.
// - Cada transacção: BEGIN → SET LOCAL ROLE (lista fixa) → nexo.definir_contexto(…) →
//   trabalho → COMMIT; ROLLBACK em erro; a ligação é libertada em todos os caminhos, e
//   destruída se o ROLLBACK falhar (não volta ao pool num estado desconhecido).
// - Dentro da transacção o código só pode fazer consultas comuns: comandos que mudam a
//   transacção, o papel ou o contexto são recusados (ClienteTransaccao.query).

import pg from 'pg'
import type { ConfiguracaoBase } from '../config/ambiente.js'
import type { Logger } from '../registo/logger.js'
import { sanitizar } from '../registo/sanitizar.js'
import { SEM_CONTEXTO, sqlDoPapel, validarContexto, type ContextoTransaccao, type PapelExecucao } from './contexto.js'

export interface ClienteTransaccao {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(texto: string, valores?: unknown[]): Promise<pg.QueryResult<R>>
}

export interface EstadoBase {
  disponivel: boolean
  /** O papel ligado não é superutilizador, não ignora políticas e não herda privilégios. */
  papelSeguro: boolean | null
  /** Última migração aplicada, se a função de diagnóstico existir. */
  versaoMigracao: string | null
  motivo?: 'nao_configurada' | 'sem_ligacao' | 'papel_inseguro' | 'migracoes_em_falta'
}

export interface AcessoBase {
  executarTransaccao<T>(
    opcoes: { papel: PapelExecucao; contexto: ContextoTransaccao },
    trabalho: (cliente: ClienteTransaccao) => Promise<T>,
  ): Promise<T>
  diagnosticar(): Promise<EstadoBase>
  encerrar(): Promise<void>
}

/** Interface mínima do pool, para os testes poderem substituir o driver. */
export interface PoolMinimo {
  connect(): Promise<ClienteMinimo>
  end(): Promise<void>
  on(evento: 'error', fn: (erro: Error) => void): unknown
}
export interface ClienteMinimo {
  query(config: string | pg.QueryConfig): Promise<pg.QueryResult>
  release(erro?: Error | boolean): void
}

export class ErroBase extends Error {}

/**
 * Não foi possível obter uma ligação a tempo (pool ocupado ou base inacessível). O tempo de
 * connectionTimeoutMillis inclui a espera na fila do pool. A API responde 503 "indisponivel".
 */
export class ErroBaseIndisponivel extends ErroBase {}

// Comandos que o código de negócio nunca pode executar dentro de executarTransaccao.
const PROIBIDOS = [
  /^\s*(begin|start|commit|end|rollback|abort|savepoint|release|set|reset|discard|listen|unlisten|notify|copy|do|lock|prepare|execute|deallocate|vacuum|analyze)\b/i,
  /\bset_config\s*\(/i,
  /\bset\s+(local\s+|session\s+)?role\b/i,
  /\bsession_authorization\b/i,
  /\bdefinir_contexto\s*\(/i,
]

export function comandoProibido(texto: string): boolean {
  return PROIBIDOS.some((p) => p.test(texto))
}

const TEMPO_LIMITE_INSTRUCAO = '15s'

export function criarAcessoBase(
  config: ConfiguracaoBase | null,
  logger: Logger,
  criarPool: (opcoes: pg.PoolConfig) => PoolMinimo = (opcoes) => new pg.Pool(opcoes),
): AcessoBase {
  const pool = config
    ? criarPool({
        connectionString: config.ligacao,
        ssl: config.tls ?? undefined,
        max: config.poolMax,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        application_name: 'nexo-api',
      })
    : null
  // Um erro numa ligação inactiva não pode derrubar o processo; o pool descarta-a.
  pool?.on('error', (erro) => logger.warn({ err: erro }, 'ligação inactiva à base com erro'))

  async function executarTransaccao<T>(
    opcoes: { papel: PapelExecucao; contexto: ContextoTransaccao },
    trabalho: (cliente: ClienteTransaccao) => Promise<T>,
  ): Promise<T> {
    // Validações antes de pedir uma ligação: papel da lista fixa e contexto verificado.
    const papelSql = sqlDoPapel(opcoes.papel)
    const contexto = validarContexto(opcoes.contexto)
    if (!pool) throw new ErroBase('base de dados não configurada')

    let cliente: ClienteMinimo
    try {
      cliente = await pool.connect()
    } catch (erro) {
      logger.warn({ err: erro }, 'sem ligação à base dentro do tempo limite')
      throw new ErroBaseIndisponivel('sem ligação à base dentro do tempo limite')
    }
    let activo = true
    let ligacaoEstragada: Error | undefined
    const restrito: ClienteTransaccao = {
      query: async (texto, valores = []) => {
        if (!activo) throw new ErroBase('transacção já terminada')
        if (comandoProibido(texto)) throw new ErroBase('comando não permitido dentro de executarTransaccao')
        // Protocolo estendido: uma única instrução por chamada, valores sempre como parâmetros.
        return cliente.query({ text: texto, values: valores, queryMode: 'extended' } as pg.QueryConfig) as never
      },
    }
    try {
      // Uma só ida ao servidor para abrir a transacção, mudar de papel e limitar o tempo.
      // Seguro: o papel vem da lista fixa (sqlDoPapel) e o tempo é uma constante; nada vem do pedido.
      await cliente.query(`BEGIN; SET LOCAL ROLE ${papelSql}; SET LOCAL statement_timeout = '${TEMPO_LIMITE_INSTRUCAO}'`)
      if (contexto !== SEM_CONTEXTO) {
        await cliente.query({
          text: 'SELECT nexo.definir_contexto($1, $2, $3, $4, $5)',
          values: [contexto.empresaId, contexto.filialId, contexto.utilizadorId, contexto.funcao, contexto.registoId],
        })
      }
      const resultado = await trabalho(restrito)
      activo = false
      await cliente.query('COMMIT')
      return resultado
    } catch (erro) {
      activo = false
      try {
        await cliente.query('ROLLBACK')
      } catch (erroRollback) {
        ligacaoEstragada = erroRollback instanceof Error ? erroRollback : new Error('falha no ROLLBACK')
        logger.error({ err: ligacaoEstragada }, 'ROLLBACK falhou; a ligação vai ser destruída')
      }
      throw erro
    } finally {
      // Com erro, o pg destrói a ligação em vez de a devolver ao pool.
      cliente.release(ligacaoEstragada)
    }
  }

  async function diagnosticar(): Promise<EstadoBase> {
    if (!pool) return { disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'nao_configurada' }
    let cliente: ClienteMinimo
    try {
      cliente = await pool.connect()
    } catch (erro) {
      logger.warn({ err: erro }, 'base de dados indisponível')
      return { disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'sem_ligacao' }
    }
    let estragada: Error | undefined
    try {
      // Corre como nexo_api, sem SET ROLE, numa transacção só de leitura.
      await cliente.query('BEGIN READ ONLY')
      const papel = await cliente.query(
        `SELECT r.rolsuper OR r.rolbypassrls OR r.rolinherit AS inseguro
           FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
      )
      const inseguro = papel.rows[0]?.inseguro !== false
      const existe = await cliente.query(`SELECT to_regprocedure('nexo.estado_base()') IS NOT NULL AS existe`)
      let versao: string | null = null
      if (existe.rows[0]?.existe) {
        const r = await cliente.query('SELECT versao FROM nexo.estado_base()')
        versao = (r.rows[0]?.versao as string | undefined) ?? null
      }
      await cliente.query('COMMIT')
      if (inseguro) return { disponivel: true, papelSeguro: false, versaoMigracao: versao, motivo: 'papel_inseguro' }
      if (!versao) return { disponivel: true, papelSeguro: true, versaoMigracao: null, motivo: 'migracoes_em_falta' }
      return { disponivel: true, papelSeguro: true, versaoMigracao: versao }
    } catch (erro) {
      logger.warn({ err: erro }, 'diagnóstico da base falhou')
      try {
        await cliente.query('ROLLBACK')
      } catch (e) {
        estragada = e instanceof Error ? e : new Error(sanitizar(String(e)))
      }
      return { disponivel: false, papelSeguro: null, versaoMigracao: null, motivo: 'sem_ligacao' }
    } finally {
      cliente.release(estragada)
    }
  }

  return {
    executarTransaccao,
    diagnosticar,
    encerrar: async () => {
      await pool?.end()
    },
  }
}
