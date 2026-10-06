// Papéis de execução e contexto da transacção (H-01, arquitectura 3.1 e 3.2).
//
// - O papel SQL vem SEMPRE desta lista fixa. O cliente nunca indica um papel: o código escolhe
//   uma chave ("operador", "gestao", "sincronizacao") e o texto SQL sai daqui.
// - O contexto (empresa, filial, utilizador, função, registo) só pode ser um ContextoVerificado.
//   Nesta etapa NÃO existe nenhuma função que o crie a partir de um pedido: na Etapa 3, o
//   middleware de identidade criá-lo-á a partir do JWT verificado e do membro lido na base,
//   nunca de valores enviados pelo navegador. Os testes usam contexto.testes.ts.

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
