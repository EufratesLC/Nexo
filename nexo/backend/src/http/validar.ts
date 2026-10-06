// Validação de pedidos com zod. O resultado validado fica em res.locals.validado; o pedido
// original não é alterado. Campos desconhecidos são recusados quando o esquema é estrito.

import type { RequestHandler } from 'express'
import type { z } from 'zod'
import { ErroApi } from './erros.js'

export interface EsquemasPedido {
  corpo?: z.ZodType
  consulta?: z.ZodType
  parametros?: z.ZodType
}

export interface Validado {
  corpo?: unknown
  consulta?: unknown
  parametros?: unknown
}

export function validar(esquemas: EsquemasPedido): RequestHandler {
  return (req, res, next) => {
    const campos: Record<string, string[]> = {}
    const validado: Validado = {}
    const partes: [keyof EsquemasPedido, unknown][] = [
      ['corpo', req.body],
      ['consulta', req.query],
      ['parametros', req.params],
    ]
    for (const [parte, valor] of partes) {
      const esquema = esquemas[parte]
      if (!esquema) continue
      const r = esquema.safeParse(valor ?? {})
      if (r.success) {
        validado[parte] = r.data
      } else {
        for (const issue of r.error.issues) {
          const chave = [parte, ...issue.path.map(String)].join('.')
          ;(campos[chave] ??= []).push(issue.message)
        }
      }
    }
    if (Object.keys(campos).length > 0) {
      next(new ErroApi(400, 'validacao', 'O pedido tem campos inválidos.', { campos }))
      return
    }
    res.locals.validado = validado
    next()
  }
}
