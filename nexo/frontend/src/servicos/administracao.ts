// Serviços reais de administração da empresa (Etapa 3). A API verifica todas as permissões; o
// frontend só esconde o que a função não pode usar.

import type { Empresa, Filial, Funcao } from './autenticacao'
import { pedido } from './http'

export interface ContaUtilizador {
  id: string
  nomeUtilizador: string
  nome: string
  funcao: Funcao
  estado: 'activo' | 'desactivado'
  filiais: string[]
  criadoEm: string
  desactivadoEm: string | null
}

export interface EntradaAuditoria {
  id: string
  criadoEm: string
  accao: string
  origem: string
  entidade: string
  entidadeId: string | null
  autor: { id: string; nome: string; nomeUtilizador: string } | null
  alvo: string | null
  antes: Record<string, unknown> | null
  depois: Record<string, unknown> | null
}

export async function obterEmpresa(sinal?: AbortSignal): Promise<{ empresa: Empresa; filiais: Filial[] }> {
  return (await pedido<{ empresa: Empresa; filiais: Filial[] }>('/v1/empresa', { sinal })).dados
}

export async function alterarEmpresa(dados: Partial<Pick<Empresa, 'nome' | 'nuit' | 'telefone' | 'endereco'>>): Promise<Empresa> {
  return (await pedido<{ empresa: Empresa }>('/v1/empresa', { metodo: 'PATCH', corpo: dados })).dados.empresa
}

export async function alterarFilial(id: string, nome: string): Promise<Filial> {
  return (await pedido<{ filial: Filial }>(`/v1/filiais/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: { nome } })).dados.filial
}

export async function listarUtilizadores(sinal?: AbortSignal): Promise<ContaUtilizador[]> {
  return (await pedido<{ utilizadores: ContaUtilizador[] }>('/v1/utilizadores', { sinal })).dados.utilizadores
}

export async function obterUtilizador(id: string, sinal?: AbortSignal): Promise<ContaUtilizador> {
  return (await pedido<{ utilizador: ContaUtilizador }>(`/v1/utilizadores/${encodeURIComponent(id)}`, { sinal })).dados.utilizador
}

export async function criarUtilizador(dados: { nome: string; nomeUtilizador: string; funcao: Funcao; filiais: string[]; codigoSecreto: string }): Promise<ContaUtilizador> {
  return (await pedido<{ utilizador: ContaUtilizador }>('/v1/utilizadores', { metodo: 'POST', corpo: dados })).dados.utilizador
}

export async function alterarUtilizador(id: string, dados: { nome?: string; funcao?: Funcao; filiais?: string[] }): Promise<ContaUtilizador> {
  return (await pedido<{ utilizador: ContaUtilizador }>(`/v1/utilizadores/${encodeURIComponent(id)}`, { metodo: 'PATCH', corpo: dados })).dados.utilizador
}

export async function desactivarUtilizador(id: string): Promise<ContaUtilizador> {
  return (await pedido<{ utilizador: ContaUtilizador }>(`/v1/utilizadores/${encodeURIComponent(id)}/desactivar`, { metodo: 'POST' })).dados.utilizador
}

export async function reactivarUtilizador(id: string): Promise<ContaUtilizador> {
  return (await pedido<{ utilizador: ContaUtilizador }>(`/v1/utilizadores/${encodeURIComponent(id)}/reactivar`, { metodo: 'POST' })).dados.utilizador
}

export async function definirCodigo(id: string, codigoSecreto: string): Promise<void> {
  await pedido(`/v1/utilizadores/${encodeURIComponent(id)}/codigo`, { metodo: 'PUT', corpo: { codigoSecreto } })
}

export async function listarAuditoria(opcoes: { antes?: string; limite?: number } = {}, sinal?: AbortSignal): Promise<EntradaAuditoria[]> {
  const q = new URLSearchParams({ limite: String(opcoes.limite ?? 50), ...(opcoes.antes ? { antes: opcoes.antes } : {}) })
  return (await pedido<{ entradas: EntradaAuditoria[] }>(`/v1/auditoria?${q}`, { sinal })).dados.entradas
}
