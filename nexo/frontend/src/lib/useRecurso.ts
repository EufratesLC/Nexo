// Carrega um recurso assíncrono com estados explícitos (a carregar, erro, dados) e permite
// repetir. Cancela o pedido anterior quando o componente sai ou quando se repete.

import { useCallback, useEffect, useState } from 'react'

export type EstadoRecurso<T> =
  | { tipo: 'a_carregar' }
  | { tipo: 'erro'; erro: unknown }
  | { tipo: 'pronto'; dados: T }

export function useRecurso<T>(carregar: (sinal: AbortSignal) => Promise<T>): [EstadoRecurso<T>, () => void] {
  const [estado, setEstado] = useState<EstadoRecurso<T>>({ tipo: 'a_carregar' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    const controlo = new AbortController()
    carregar(controlo.signal).then(
      (dados) => {
        if (!controlo.signal.aborted) setEstado({ tipo: 'pronto', dados })
      },
      (erro: unknown) => {
        if (!controlo.signal.aborted) setEstado({ tipo: 'erro', erro })
      },
    )
    return () => controlo.abort()
  }, [carregar, tentativa])

  const repetir = useCallback(() => {
    setEstado({ tipo: 'a_carregar' })
    setTentativa((n) => n + 1)
  }, [])
  return [estado, repetir]
}
