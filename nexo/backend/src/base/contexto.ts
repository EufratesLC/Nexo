// Papéis de execução e contexto da transacção (H-01, arquitectura 3.1 e 3.2).
//
// - O papel SQL vem SEMPRE desta lista fixa. O cliente nunca indica um papel: o código escolhe
//   uma chave ("operador", "gestao", "sincronizacao") e o texto SQL sai daqui.
// - O contexto (empresa, filial, utilizador, função, registo) só pode ser um ContextoVerificado.
//   Desde a Etapa 3 há um único caminho a partir de um pedido: contextoDaSessao(), que só aceita
//   uma SessaoValidada, criada em src/base/identidade.ts com o que a BASE devolveu ao validar o
//   token da sessão (nexo.validar_sessao). Empresa, utilizador, função e filiais permitidas vêm
//   daí, nunca de valores enviados pelo navegador; o pedido só pode ESCOLHER uma das filiais
//   permitidas. Os testes usam contexto.testes.ts. (Regra verificada em testes/unidade/estatico.)

export const PAPEIS_EXECUCAO = {
  operador: 'nexo_operador',
  gestao: 'nexo_gestao',
  sincronizacao: 'nexo_sincronizacao',
} as const

export type PapelExecucao = keyof typeof PAPEIS_EXECUCAO

export const FUNCOES = ['proprietario', 'gestor', 'operador'] as const
export type Funcao = (typeof FUNCOES)[number]

export const MARCA_CONTEXTO: unique symbol = Symbol('nexo.ContextoVerificado')

export interface ContextoVerificado {
  readonly [MARCA_CONTEXTO]: true
  readonly empresaId: string
  readonly filialId: string | null
  readonly utilizadorId: string | null
  readonly funcao: Funcao | null
  readonly registoId: string | null
}

/** Transacção sem empresa: as políticas negam todas as linhas de negócio. */
export const SEM_CONTEXTO: unique symbol = Symbol('nexo.SemContexto')
export type ContextoTransaccao = ContextoVerificado | typeof SEM_CONTEXTO

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function sqlDoPapel(papel: PapelExecucao): string {
  if (!Object.hasOwn(PAPEIS_EXECUCAO, papel)) throw new Error('papel de execução desconhecido')
  return PAPEIS_EXECUCAO[papel]
}

/** Confirma, em tempo de execução, que o contexto foi criado pelo caminho autorizado. */
export function validarContexto(contexto: unknown): ContextoTransaccao {
  if (contexto === SEM_CONTEXTO) return SEM_CONTEXTO
  const c = contexto as Partial<ContextoVerificado> | null
  if (!c || typeof c !== 'object' || c[MARCA_CONTEXTO] !== true) throw new Error('contexto não verificado')
  if (!c.empresaId || !UUID.test(c.empresaId)) throw new Error('contexto sem empresa válida')
  for (const id of [c.filialId, c.utilizadorId, c.registoId]) {
    if (id !== null && (typeof id !== 'string' || !UUID.test(id))) throw new Error('identificador inválido no contexto')
  }
  if (c.funcao !== null && !FUNCOES.includes(c.funcao as Funcao)) throw new Error('função inválida no contexto')
  return c as ContextoVerificado
}

export const MARCA_SESSAO: unique symbol = Symbol('nexo.SessaoValidada')

/** Sessão confirmada pela base (nexo.validar_sessao / nexo.iniciar_sessao). */
export interface SessaoValidada {
  readonly [MARCA_SESSAO]: true
  readonly sessaoId: string
  readonly empresaId: string
  readonly utilizadorId: string
  readonly funcao: Funcao
  readonly nome: string
  readonly nomeUtilizador: string
  /** Filiais permitidas (o proprietário tem todas as da empresa). */
  readonly filiais: readonly string[]
  readonly expiraEm: Date
}

export class ErroFilialNaoPermitida extends Error {}

/**
 * Contexto de um pedido de utilizador. A filial pedida tem de estar entre as permitidas; sem
 * pedido, usa-se a primeira (no piloto há uma). Nunca aceita empresa, utilizador ou função do pedido.
 */
export function contextoDaSessao(sessao: SessaoValidada, filialPedida?: string): ContextoVerificado {
  if (!sessao || sessao[MARCA_SESSAO] !== true) throw new Error('sessão não validada pela base')
  if (filialPedida !== undefined && !sessao.filiais.includes(filialPedida)) throw new ErroFilialNaoPermitida('filial não permitida')
  const c: ContextoVerificado = {
    [MARCA_CONTEXTO]: true,
    empresaId: sessao.empresaId,
    filialId: filialPedida ?? sessao.filiais[0] ?? null,
    utilizadorId: sessao.utilizadorId,
    funcao: sessao.funcao,
    registoId: null,
  }
  validarContexto(c)
  return c
}

/** Papel de execução da função (arquitectura 2.1): operador → nexo_operador; os outros → nexo_gestao. */
export function papelDaFuncao(funcao: Funcao): PapelExecucao {
  return funcao === 'operador' ? 'operador' : 'gestao'
}
