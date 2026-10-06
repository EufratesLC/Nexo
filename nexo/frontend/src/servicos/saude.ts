// Serviços reais de diagnóstico da API (só leitura). Não usam dados de demonstração.

import { pedido } from './http'

export interface SaudeApi {
  estado: 'ok'
  servico: string
  ambiente: string
}

export interface SaudeBase {
  estado: 'ok' | 'indisponivel'
  base: {
    disponivel: boolean
    papelSeguro: boolean | null
    versaoMigracao: string | null
    motivo?: 'nao_configurada' | 'sem_ligacao' | 'papel_inseguro' | 'migracoes_em_falta'
  }
}

export async function obterSaudeApi(sinal?: AbortSignal): Promise<SaudeApi> {
  return (await pedido<SaudeApi>('/v1/saude', { sinal })).dados
}

export async function obterSaudeBase(sinal?: AbortSignal): Promise<SaudeBase> {
  // 503 é uma resposta válida: a API diz que a base não está pronta e porquê.
  return (await pedido<SaudeBase>('/v1/saude/base', { sinal, aceitarEstados: [503] })).dados
}
