// Registo de eventos estruturado (JSON numa linha). Os segredos são retirados por caminho
// (CAMINHOS_REDIGIDOS) e as mensagens de erro passam por sanitizar().

import { pino, type Logger } from 'pino'
import { CAMINHOS_REDIGIDOS, sanitizar } from './sanitizar.js'

export type { Logger }

export function criarLogger(nivel: string, destino?: pino.DestinationStream): Logger {
  return pino(
    {
      level: nivel,
      base: { servico: 'nexo-api' },
      redact: { paths: CAMINHOS_REDIGIDOS, censor: '<omitido>' },
      serializers: { err: serializarErro },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destino,
  )
}

/** Erros nos logs: tipo, código e mensagem limpa. A pilha só fora de produção. */
export function serializarErro(erro: unknown): Record<string, unknown> {
  if (!(erro instanceof Error)) return { mensagem: sanitizar(String(erro)) }
  const comCodigo = erro as Error & { code?: unknown }
  const r: Record<string, unknown> = { tipo: erro.name, mensagem: sanitizar(erro.message) }
  if (typeof comCodigo.code === 'string') r.codigo = comCodigo.code
  if (process.env.NEXO_AMBIENTE !== 'producao' && erro.stack) r.pilha = sanitizar(erro.stack)
  return r
}
