// Encaminhamento mínimo por hash (#/balcao, #/vendas/123). Suficiente para o
// protótipo; a escolha de biblioteca de rotas fica para a Etapa 2.

import { useEffect, useState } from 'react'

function lerRota(): string[] {
  const caminho = window.location.hash.replace(/^#\/?/, '')
  return caminho === '' ? [] : caminho.split('/').map(decodeURIComponent)
}

export function useRota(): string[] {
  const [rota, setRota] = useState(lerRota)
  useEffect(() => {
    const aoMudar = () => {
      setRota(lerRota())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', aoMudar)
    return () => window.removeEventListener('hashchange', aoMudar)
  }, [])
  return rota
}

export function navegar(caminho: string): void {
  window.location.hash = caminho.startsWith('/') ? caminho : `/${caminho}`
}
