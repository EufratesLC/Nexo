// Protecção das rotas no servidor (Etapa 3). Esconder botões no frontend não autoriza nada: cada
// rota protegida passa por exigirSessao e, quando aplicável, por exigirFuncao.
//
// - exigirSessao: lê o cookie HttpOnly, valida o token NA BASE (nexo.validar_sessao: não revogada,
//   não expirada, sem inactividade excessiva, conta activa) e guarda a SessaoValidada no pedido.
//   Uma empresa ou filial indicada no pedido (X-Nexo-Empresa, X-Nexo-Filial) tem de corresponder à
//   sessão; nunca a substitui.
// - exigirFuncao: matriz de permissões por função, verificada antes de tocar na base.
// - exigirClienteConfiavel: os pedidos que alteram dados levam X-Nexo-Cliente. Um formulário ou um
//   pedido de outro site não consegue enviar esse cabeçalho sem autorização CORS (que só existe para
//   as origens configuradas); com o cookie SameSite=Strict, protege contra pedidos forjados (CSRF).

import type { RequestHandler } from 'express'
import { contextoDaSessao, ErroFilialNaoPermitida, type Funcao, type SessaoValidada } from '../base/contexto.js'
import type { ConfiguracaoSessao } from '../config/ambiente.js'
import { ErroApi } from '../http/erros.js'
import type { ServicoIdentidade } from '../servicos/identidade.js'
import { cookieApagado, lerCookie, nomeCookie } from './cookies.js'

declare module 'express-serve-static-core' {
  interface Request {
    sessao?: SessaoValidada
  }
}

export const NOMES_FUNCAO: Record<Funcao, string> = { proprietario: 'Proprietário', gestor: 'Gestor', operador: 'Operador' }

export function tokenDoPedido(cabecalhoCookie: string | undefined, config: ConfiguracaoSessao): string | undefined {
  return lerCookie(cabecalhoCookie, nomeCookie(config))
}

export function exigirSessao(identidade: ServicoIdentidade, config: ConfiguracaoSessao): RequestHandler {
  return async (req, res, next) => {
    const token = tokenDoPedido(req.headers.cookie, config)
    if (!token) throw new ErroApi(401, 'nao_autenticado', 'Entre na sua conta para continuar.')
    const sessao = await identidade.validarSessao(token)
    if (!sessao) {
      res.setHeader('Set-Cookie', cookieApagado(config))
      throw new ErroApi(401, 'sessao_terminada', 'A sua sessão terminou. Entre de novo.')
    }
    const empresaPedida = req.get('x-nexo-empresa')
    if (empresaPedida !== undefined && empresaPedida !== sessao.empresaId) {
      throw new ErroApi(403, 'empresa_nao_permitida', 'A sessão não dá acesso à empresa indicada.')
    }
    const filialPedida = req.get('x-nexo-filial')
    try {
      contextoDaSessao(sessao, filialPedida)
    } catch (erro) {
      if (erro instanceof ErroFilialNaoPermitida) throw new ErroApi(403, 'filial_nao_permitida', 'A sua conta não tem acesso à filial indicada.')
      throw erro
    }
    req.sessao = sessao
    next()
  }
}

/** A sessão já validada por exigirSessao. */
export function sessaoDe(req: { sessao?: SessaoValidada }): SessaoValidada {
  if (!req.sessao) throw new Error('rota sem exigirSessao')
  return req.sessao
}

export function exigirFuncao(...funcoes: Funcao[]): RequestHandler {
  return (req, _res, next) => {
    const sessao = sessaoDe(req)
    if (!funcoes.includes(sessao.funcao)) {
      throw new ErroApi(403, 'permissao_negada', `A função ${NOMES_FUNCAO[sessao.funcao]} não tem permissão para esta operação.`)
    }
    next()
  }
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const exigirClienteConfiavel: RequestHandler = (req, _res, next) => {
  if (!METODOS_SEGUROS.has(req.method) && req.get('x-nexo-cliente') !== 'web') {
    throw new ErroApi(403, 'pedido_nao_confiavel', 'Pedido recusado: falta a identificação do cliente da aplicação.')
  }
  next()
}
