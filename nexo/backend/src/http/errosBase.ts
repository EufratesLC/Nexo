// Tradução de erros do PostgreSQL em erros da API. A base é a última barreira (restrições,
// privilégios, políticas); a API verifica antes, mas se a base recusar, o cliente recebe um erro
// claro e estável, nunca a mensagem do driver.

import { ErroApi } from './erros.js'

interface ErroPg {
  code?: string
  constraint?: string
}

export function erroDaBase(erro: unknown): ErroApi | null {
  const e = erro as ErroPg
  if (!e || typeof e.code !== 'string') return null
  if (e.code === '23505' && e.constraint === 'empresas_codigo_unico') {
    return new ErroApi(409, 'codigo_empresa_indisponivel', 'Este código de empresa já está a ser usado. Escolha outro.')
  }
  if (e.code === '23505' && e.constraint === 'utilizadores_empresa_id_nome_utilizador_key') {
    return new ErroApi(409, 'nome_utilizador_indisponivel', 'Já existe uma conta com este nome de utilizador nesta empresa.')
  }
  if (e.code === '23514' && e.constraint === 'utilizadores_proprietario_activo') {
    return new ErroApi(409, 'ultimo_proprietario', 'A empresa tem de ter sempre pelo menos um proprietário activo.')
  }
  if (e.code === '23503') return new ErroApi(422, 'referencia_invalida', 'Um dos elementos indicados não existe nesta empresa.')
  if (e.code === '23514' || e.code === '22023' || e.code === '22001') {
    return new ErroApi(400, 'validacao', 'Os dados não cumprem as regras.')
  }
  if (e.code === 'P0002') return new ErroApi(404, 'nao_encontrado', 'O recurso pedido não existe.')
  // Privilégio ou política: a operação não é permitida para esta conta.
  if (e.code === '42501') return new ErroApi(403, 'permissao_negada', 'A sua conta não tem permissão para esta operação.')
  return null
}

/** Executa e converte erros conhecidos da base; os outros seguem como erro interno. */
export async function comErrosDaBase<T>(trabalho: () => Promise<T>): Promise<T> {
  try {
    return await trabalho()
  } catch (erro) {
    throw erroDaBase(erro) ?? erro
  }
}
