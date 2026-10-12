// Encaminhamento por hash do modo real, com parâmetros (#/recuperar-acesso?token=…).
//
// Os tokens dos links de e-mail chegam no FRAGMENTO, que o navegador nunca envia ao servidor. O
// ecrã lê-o uma vez e retira-o da barra de endereço (retirarParametros), para não ficar no
// histórico nem ser copiado por engano.

import { useEffect, useState } from 'react'

export interface Rota {
  caminho: string[]
  parametros: URLSearchParams
}

function lerRota(): Rota {
  const bruto = window.location.hash.replace(/^#\/?/, '')
  const [caminho = '', consulta = ''] = bruto.split('?')
  return { caminho: caminho === '' ? [] : caminho.split('/').map(decodeURIComponent), parametros: new URLSearchParams(consulta) }
}

export function useRotaReal(): Rota {
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

/** Remove os parâmetros (ex.: o token) do endereço sem recarregar nem criar entrada no histórico. */
export function retirarParametros(caminho: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${caminho}`)
}
