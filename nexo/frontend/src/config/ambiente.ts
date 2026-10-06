// Configuração do frontend (variáveis VITE_*, incluídas no código enviado ao navegador).
// NUNCA colocar aqui segredos, credenciais de base de dados nem chaves administrativas: tudo o
// que começa por VITE_ fica público. O vite.config.ts recusa construir se encontrar uma.

export type Modo = 'demonstracao' | 'api'

export interface ConfiguracaoFrontend {
  /** demonstracao: protótipo com dados fictícios (Etapa 1). api: só infraestrutura real. */
  modo: Modo
  /** Base da API. Por omissão "/api", servido pelo proxy do Vite em desenvolvimento. */
  apiUrl: string
  /** Tempo máximo de um pedido à API. */
  tempoLimiteMs: number
}

export class ErroConfiguracaoFrontend extends Error {}

export function lerConfiguracao(env: Record<string, string | undefined> = import.meta.env): ConfiguracaoFrontend {
  const modo = env.VITE_NEXO_MODO ?? 'demonstracao'
  if (modo !== 'demonstracao' && modo !== 'api') {
    throw new ErroConfiguracaoFrontend(`VITE_NEXO_MODO inválido: use "demonstracao" ou "api"`)
  }
  const apiUrl = (env.VITE_NEXO_API_URL ?? '/api').replace(/\/+$/, '')
  if (!apiUrl.startsWith('/') && !/^https?:\/\//.test(apiUrl)) {
    throw new ErroConfiguracaoFrontend('VITE_NEXO_API_URL tem de ser um caminho (/api) ou um URL http(s)')
  }
  const tempo = Number(env.VITE_NEXO_TEMPO_LIMITE_MS ?? 15000)
  if (!Number.isFinite(tempo) || tempo < 1000) throw new ErroConfiguracaoFrontend('VITE_NEXO_TEMPO_LIMITE_MS inválido')
  return { modo, apiUrl, tempoLimiteMs: tempo }
}

export const configuracao = lerConfiguracao()
