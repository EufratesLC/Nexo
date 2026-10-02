import { createContext, useContext } from 'react'
import type { EstadoDemo, Utilizador } from './tipos'

export interface ContextoDemo {
  estado: EstadoDemo
  utilizador: Utilizador | undefined
  /** Aplica uma transição; devolve a mensagem de erro, ou null se correu bem. */
  executar: (transicao: (e: EstadoDemo) => EstadoDemo) => string | null
  repor: () => void
}

export const DemoContext = createContext<ContextoDemo | null>(null)

export function useDemo(): ContextoDemo {
  const contexto = useContext(DemoContext)
  if (!contexto) throw new Error('useDemo tem de estar dentro de DemoProvider')
  return contexto
}
