// Encerramento ordenado: deixa de aceitar pedidos, espera pelos que estão a decorrer, fecha as
// ligações à base e só depois termina. Se demorar demasiado, termina à força.

import type { Server } from 'node:http'
import type { AcessoBase } from './base/acesso.js'
import type { Logger } from './registo/logger.js'

export function criarEncerramento(opcoes: {
  servidor: Server
  base: AcessoBase
  logger: Logger
  sair: (codigo: number) => void
  tempoLimiteMs?: number
}): (motivo: string) => Promise<void> {
  const { servidor, base, logger, sair, tempoLimiteMs = 10_000 } = opcoes
  let emCurso: Promise<void> | null = null

  return (motivo) => {
    if (emCurso) return emCurso
    logger.info({ motivo }, 'a encerrar')
    const forcar = setTimeout(() => {
      logger.error('encerramento demorou demasiado; a terminar')
      sair(1)
    }, tempoLimiteMs)
    forcar.unref()

    emCurso = new Promise<void>((resolver) => {
      servidor.close(async (erro) => {
        if (erro) logger.error({ err: erro }, 'erro ao fechar o servidor HTTP')
        try {
          await base.encerrar()
        } catch (e) {
          logger.error({ err: e }, 'erro ao fechar as ligações à base')
        }
        clearTimeout(forcar)
        logger.info('encerrado')
        sair(erro ? 1 : 0)
        resolver()
      })
      // Ligações keep-alive inactivas não devem atrasar o encerramento.
      servidor.closeIdleConnections()
    })
    return emCurso
  }
}
