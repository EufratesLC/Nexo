// Contexto e hooks da sessão real (o fornecedor está em sessao.tsx).

import { createContext, useContext } from 'react'
import type { Sessao } from '../servicos/autenticacao'

export type EstadoSessao =
  | { tipo: 'a_verificar' }
  | { tipo: 'sem_sessao'; motivo?: 'terminada' | 'saiu' }
  | { tipo: 'erro'; erro: unknown }
  | { tipo: 'com_sessao'; sessao: Sessao }

export interface ContextoSessao {
  estado: EstadoSessao
  /** Depois de entrar ou registar: a API já devolveu a sessão. */
  iniciar(sessao: Sessao): void
  sair(): Promise<void>
  /** Lê de novo a sessão (ex.: depois de confirmar o e-mail de recuperação). */
  actualizar(): Promise<void>
}

export const Contexto = createContext<ContextoSessao | null>(null)

export function useSessao(): ContextoSessao {
  const c = useContext(Contexto)
  if (!c) throw new Error('useSessao fora de SessaoProvider')
  return c
}

/** A sessão activa (só nos ecrãs protegidos). */
export function useSessaoActiva(): Sessao {
  const { estado } = useSessao()
  if (estado.tipo !== 'com_sessao') throw new Error('ecrã protegido sem sessão')
  return estado.sessao
}
