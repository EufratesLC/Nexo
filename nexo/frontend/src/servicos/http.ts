// Cliente HTTP único para a API do Nexo.
//
// - Junta a base da API, envia JSON, identifica cada pedido (X-Nexo-Pedido) e aplica tempo limite.
// - Converte qualquer falha num ErroApi com um código estável:
//     erros da API ({ erro: { codigo, mensagem } }), sem_ligacao, tempo_esgotado, resposta_invalida.
// - No modo de demonstração, recusa pedidos que escrevem (POST/PUT/PATCH/DELETE): a demonstração
//   nunca escreve na base de desenvolvimento.
// - Sessão (Etapa 3): o token vive num cookie HttpOnly posto pela API; o JavaScript nunca o vê nem
//   o guarda. Os pedidos levam o cookie só para a mesma origem (credentials: 'same-origin'; em
//   desenvolvimento a API está atrás do proxy do Vite) e o cabeçalho X-Nexo-Cliente, que a API
//   exige nas escritas (protecção contra pedidos forjados por outros sites).
// - Quando a API diz que a sessão terminou (401), avisa quem estiver a ouvir (aoSessaoTerminar).

import { configuracao, type ConfiguracaoFrontend } from '../config/ambiente'
import { novoId } from '../lib/ids'

export class ErroApi extends Error {
  readonly codigo: string
  readonly estado: number | null
  readonly pedidoId: string
  readonly detalhes?: Record<string, unknown>

  constructor(codigo: string, mensagem: string, estado: number | null, pedidoId: string, detalhes?: Record<string, unknown>) {
    super(mensagem)
    this.name = 'ErroApi'
    this.codigo = codigo
    this.estado = estado
    this.pedidoId = pedidoId
    this.detalhes = detalhes
  }
}

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface OpcoesPedido {
  metodo?: Metodo
  corpo?: unknown
  sinal?: AbortSignal
  /** Aceitar estas respostas não-2xx como resultado (ex.: 503 da verificação da base). */
  aceitarEstados?: number[]
  /** Não avisar o fim da sessão (ex.: a própria verificação da sessão ao abrir a aplicação). */
  semAvisoDeSessao?: boolean
}

type OuvinteSessao = (codigo: 'sessao_terminada' | 'nao_autenticado') => void
const ouvintesSessao = new Set<OuvinteSessao>()

/** Avisa quando um pedido recebe 401 de sessão terminada. Devolve a função para deixar de ouvir. */
export function aoSessaoTerminar(ouvinte: OuvinteSessao): () => void {
  ouvintesSessao.add(ouvinte)
  return () => ouvintesSessao.delete(ouvinte)
}

export interface Resposta<T> {
  estado: number
  dados: T
  pedidoId: string
}

const MENSAGENS: Record<string, string> = {
  sem_ligacao: 'Não foi possível contactar a API. Verifique a ligação e se a API está a correr.',
  tempo_esgotado: 'A API demorou demasiado a responder.',
  resposta_invalida: 'A API devolveu uma resposta inesperada.',
  modo_demonstracao: 'No modo de demonstração não se enviam alterações à API.',
}

export function criarClienteHttp(config: ConfiguracaoFrontend, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  return async function pedido<T>(caminho: string, opcoes: OpcoesPedido = {}): Promise<Resposta<T>> {
    const metodo = opcoes.metodo ?? 'GET'
    const pedidoId = novoId()
    if (config.modo === 'demonstracao' && metodo !== 'GET') {
      throw new ErroApi('modo_demonstracao', MENSAGENS.modo_demonstracao, null, pedidoId)
    }
    const controlo = new AbortController()
    const temporizador = setTimeout(() => controlo.abort(new DOMException('tempo', 'TimeoutError')), config.tempoLimiteMs)
    const aoCancelar = () => controlo.abort(opcoes.sinal?.reason)
    opcoes.sinal?.addEventListener('abort', aoCancelar, { once: true })

    let resposta: Response
    try {
      resposta = await fetchImpl(`${config.apiUrl}${caminho}`, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          'X-Nexo-Pedido': pedidoId,
          'X-Nexo-Cliente': 'web',
          ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
        signal: controlo.signal,
        credentials: config.modo === 'api' ? 'same-origin' : 'omit',
      })
    } catch (erro) {
      if (opcoes.sinal?.aborted) throw erro
      const codigo = controlo.signal.aborted ? 'tempo_esgotado' : 'sem_ligacao'
      throw new ErroApi(codigo, MENSAGENS[codigo], null, pedidoId)
    } finally {
      clearTimeout(temporizador)
      opcoes.sinal?.removeEventListener('abort', aoCancelar)
    }

    const idServidor = resposta.headers.get('X-Nexo-Pedido') ?? pedidoId
    let corpo: unknown = null
    const texto = await resposta.text()
    if (texto) {
      try {
        corpo = JSON.parse(texto)
      } catch {
        // O proxy de desenvolvimento devolve HTML/texto quando a API não está a correr.
        throw new ErroApi(resposta.status >= 500 ? 'sem_ligacao' : 'resposta_invalida', MENSAGENS[resposta.status >= 500 ? 'sem_ligacao' : 'resposta_invalida'], resposta.status, idServidor)
      }
    }

    if (resposta.ok || opcoes.aceitarEstados?.includes(resposta.status)) {
      return { estado: resposta.status, dados: corpo as T, pedidoId: idServidor }
    }
    const erro = (corpo as { erro?: { codigo?: unknown; mensagem?: unknown; detalhes?: unknown } } | null)?.erro
    if (erro && typeof erro.codigo === 'string' && typeof erro.mensagem === 'string') {
      if (resposta.status === 401 && (erro.codigo === 'sessao_terminada' || erro.codigo === 'nao_autenticado') && !opcoes.semAvisoDeSessao) {
        for (const ouvinte of ouvintesSessao) ouvinte(erro.codigo)
      }
      throw new ErroApi(erro.codigo, erro.mensagem, resposta.status, idServidor, erro.detalhes as Record<string, unknown> | undefined)
    }
    const codigo = resposta.status >= 500 ? 'sem_ligacao' : 'resposta_invalida'
    throw new ErroApi(codigo, MENSAGENS[codigo], resposta.status, idServidor)
  }
}

/** Mensagem para o utilizador a partir de qualquer erro, sem detalhes internos. */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.message
  return 'Ocorreu um erro inesperado.'
}

/** Erros de validação por campo ({ "corpo.nome": ["…"] } → { nome: "…" }). */
export function errosDeCampos(erro: unknown): Record<string, string> {
  if (!(erro instanceof ErroApi) || erro.codigo !== 'validacao') return {}
  const campos = (erro.detalhes?.campos ?? {}) as Record<string, string[]>
  return Object.fromEntries(Object.entries(campos).map(([k, v]) => [k.replace(/^corpo\./, ''), v.join(' ')]))
}

/** Cliente da aplicação, configurado pelas variáveis VITE_*. */
export const pedido = criarClienteHttp(configuracao)
