// Criação de contextos SÓ para testes automáticos. Recusa-se a funcionar fora do ambiente
// "teste", para não se tornar um atalho que confie em valores vindos de um pedido.

import { MARCA_CONTEXTO, validarContexto, type ContextoVerificado, type Funcao } from './contexto.js'

export function contextoDeTeste(dados: {
  empresaId: string
  filialId?: string | null
  utilizadorId?: string | null
  funcao?: Funcao | null
  registoId?: string | null
}): ContextoVerificado {
  if (process.env.NEXO_AMBIENTE !== 'teste') {
    throw new Error('contextoDeTeste só pode ser usado com NEXO_AMBIENTE=teste')
  }
  const c: ContextoVerificado = {
    [MARCA_CONTEXTO]: true,
    empresaId: dados.empresaId,
    filialId: dados.filialId ?? null,
    utilizadorId: dados.utilizadorId ?? null,
    funcao: dados.funcao ?? null,
    registoId: dados.registoId ?? null,
  }
  validarContexto(c)
  return c
}
