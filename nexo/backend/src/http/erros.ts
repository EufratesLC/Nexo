// Formato único dos erros da API (arquitectura 6.1):
//   { "erro": { "codigo": "…", "mensagem": "…", "detalhes": {…}, "pedidoId": "…" } }
// Erros inesperados nunca expõem a mensagem interna nem a pilha ao cliente.

import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ErroBaseIndisponivel } from '../base/acesso.js'

export class ErroApi extends Error {
  readonly estado: number
  readonly codigo: string
  readonly detalhes?: Record<string, unknown>

  constructor(estado: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) {
    super(mensagem)
    this.name = 'ErroApi'
    this.estado = estado
    this.codigo = codigo
    this.detalhes = detalhes
  }
}

export const naoEncontrado: RequestHandler = (_req, _res, next) => {
  next(new ErroApi(404, 'nao_encontrado', 'O recurso pedido não existe.'))
}

export const tratarErros: ErrorRequestHandler = (erro, req, res, _next) => {
  const pedidoId = res.locals.pedidoId as string | undefined
  let api: ErroApi
  if (erro instanceof ErroApi) {
    api = erro
  } else if (erro instanceof ErroBaseIndisponivel) {
    api = new ErroApi(503, 'indisponivel', 'O serviço está ocupado ou sem acesso à base de dados. Tente de novo dentro de momentos.')
  } else if (corpoInvalido(erro)) {
    api = new ErroApi(400, 'pedido_invalido', 'O corpo do pedido não é JSON válido.')
  } else if (corpoGrande(erro)) {
    api = new ErroApi(413, 'pedido_demasiado_grande', 'O corpo do pedido excede o limite.')
  } else {
    api = new ErroApi(500, 'erro_interno', 'Ocorreu um erro inesperado. Indique o identificador do pedido ao suporte.')
  }
  const log = req.log ?? res.locals.log
  if (api.estado >= 500) log?.error({ err: erro }, 'erro no pedido')
  else log?.info({ codigo: api.codigo, estado: api.estado }, 'pedido recusado')

  if (res.headersSent) return
  res.status(api.estado).json({
    erro: { codigo: api.codigo, mensagem: api.message, ...(api.detalhes ? { detalhes: api.detalhes } : {}), pedidoId },
  })
}

function corpoInvalido(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && (erro as { type?: string }).type === 'entity.parse.failed'
}

function corpoGrande(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && (erro as { type?: string }).type === 'entity.too.large'
}
