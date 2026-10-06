// Identificação de cada pedido nos logs. Aceita o cabeçalho X-Nexo-Pedido do cliente só se for
// um UUID (para correlacionar com o navegador); caso contrário gera um novo. Devolve-o sempre.

import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Logger } from '../registo/logger.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

declare module 'express-serve-static-core' {
  interface Request {
    log?: Logger
    pedidoId?: string
  }
}

export function identificarPedidos(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const recebido = req.get('x-nexo-pedido')
    const pedidoId = recebido && UUID.test(recebido) ? recebido.toLowerCase() : randomUUID()
    const inicio = process.hrtime.bigint()
    req.pedidoId = pedidoId
    req.log = logger.child({ pedidoId })
    res.locals.pedidoId = pedidoId
    res.locals.log = req.log
    res.setHeader('X-Nexo-Pedido', pedidoId)
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - inicio) / 1e6
      // Só o caminho, sem a query (pode conter dados) nem cabeçalhos.
      req.log?.info({ metodo: req.method, caminho: req.originalUrl.split('?')[0], estado: res.statusCode, ms: Math.round(ms * 10) / 10 }, 'pedido')
    })
    next()
  }
}
