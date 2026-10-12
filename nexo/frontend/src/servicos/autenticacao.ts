// Serviços reais de autenticação (Etapa 3). O token da sessão nunca passa por aqui: a API põe-no
// num cookie HttpOnly. Os tokens dos links de e-mail são enviados no CORPO dos pedidos (nunca no URL).

import { pedido } from './http'

export type Funcao = 'proprietario' | 'gestor' | 'operador'

export const NOMES_FUNCAO: Record<Funcao, string> = { proprietario: 'Proprietário', gestor: 'Gestor', operador: 'Operador' }

export interface Empresa {
  id: string
  codigo: string
  nome: string
  nuit: string | null
  telefone: string | null
  endereco: string | null
}

export interface Filial {
  id: string
  codigo: string
  nome: string
}

export interface EmailRecuperacao {
  email: string | null
  confirmadoEm: string | null
  emailPendente: string | null
}

export interface Sessao {
  utilizador: { id: string; nome: string; nomeUtilizador: string; funcao: Funcao }
  empresa: Empresa
  filiais: Filial[]
  filialActual: Filial | null
  expiraEm: string
  emailRecuperacao: EmailRecuperacao | null
}

export async function obterSessao(sinal?: AbortSignal): Promise<Sessao> {
  return (await pedido<Sessao>('/v1/autenticacao/sessao', { sinal, semAvisoDeSessao: true })).dados
}

export async function entrar(dados: { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string }): Promise<Sessao> {
  return (await pedido<Sessao>('/v1/autenticacao/entrar', { metodo: 'POST', corpo: dados, semAvisoDeSessao: true })).dados
}

export async function sair(): Promise<void> {
  await pedido('/v1/autenticacao/sair', { metodo: 'POST', semAvisoDeSessao: true })
}

export interface DadosRegisto {
  codigoEmpresa: string
  nomeEmpresa: string
  nuit?: string
  telefone?: string
  nome: string
  nomeUtilizador: string
  email: string
  codigoSecreto: string
}

export interface RegistoPendente {
  activacaoPendente: true
  codigoEmpresa: string
  nomeUtilizador: string
  mensagem: string
}

/** Cria a empresa com o proprietário PENDENTE: não há sessão até o e-mail ser confirmado. */
export async function registar(dados: DadosRegisto): Promise<RegistoPendente> {
  return (await pedido<RegistoPendente>('/v1/autenticacao/registo', { metodo: 'POST', corpo: dados, semAvisoDeSessao: true })).dados
}

/** Confirma o e-mail; contaActivada indica que o registo pendente ficou activo. */
export async function confirmarEmail(token: string): Promise<{ contaActivada: boolean }> {
  return (await pedido<{ confirmado: true; contaActivada: boolean }>('/v1/autenticacao/email/confirmar', { metodo: 'POST', corpo: { token }, semAvisoDeSessao: true })).dados
}

export async function reenviarActivacao(dados: { codigoEmpresa: string; nomeUtilizador: string }): Promise<string> {
  return (await pedido<{ mensagem: string }>('/v1/autenticacao/activacao/reenviar', { metodo: 'POST', corpo: dados, semAvisoDeSessao: true })).dados.mensagem
}

export async function corrigirEmailActivacao(dados: { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string; email: string }): Promise<string> {
  return (await pedido<{ mensagem: string }>('/v1/autenticacao/activacao/email', { metodo: 'POST', corpo: dados, semAvisoDeSessao: true })).dados.mensagem
}

/** Endereço do ecrã de registo pendente (código da empresa e utilizador não são segredos). */
export function enderecoRegistoPendente(codigoEmpresa: string, nomeUtilizador: string): string {
  return `#/registo-pendente?${new URLSearchParams({ empresa: codigoEmpresa, utilizador: nomeUtilizador })}`
}

export async function pedirRecuperacao(dados: { codigoEmpresa: string; nomeUtilizador: string }): Promise<string> {
  return (await pedido<{ mensagem: string }>('/v1/autenticacao/recuperacao', { metodo: 'POST', corpo: dados, semAvisoDeSessao: true })).dados.mensagem
}

export async function concluirRecuperacao(token: string, codigoNovo: string): Promise<void> {
  await pedido('/v1/autenticacao/recuperacao/concluir', { metodo: 'POST', corpo: { token, codigoNovo }, semAvisoDeSessao: true })
}

export async function alterarCodigo(codigoActual: string, codigoNovo: string): Promise<void> {
  await pedido('/v1/autenticacao/codigo', { metodo: 'POST', corpo: { codigoActual, codigoNovo } })
}

export async function definirEmailRecuperacao(codigoActual: string, email: string): Promise<string> {
  return (await pedido<{ mensagem: string }>('/v1/autenticacao/email', { metodo: 'POST', corpo: { codigoActual, email } })).dados.mensagem
}

export async function reenviarConfirmacao(): Promise<string> {
  return (await pedido<{ mensagem: string }>('/v1/autenticacao/email/reenviar', { metodo: 'POST' })).dados.mensagem
}

// Regras partilhadas com a API (a API volta sempre a validar).
export const REGRA_CODIGO_EMPRESA = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/
export const REGRA_NOME_UTILIZADOR = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/
export const CODIGO_MIN = 8

export function problemaCodigo(codigo: string): string | undefined {
  const n = [...codigo.normalize('NFC')].length
  if (n < CODIGO_MIN) return `Use pelo menos ${CODIGO_MIN} caracteres (pode ser uma frase).`
  if (n > 128) return 'Use no máximo 128 caracteres.'
  return undefined
}
