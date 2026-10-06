import { useEffect, useState } from 'react'
import { activarActualizacao, aoMudarActualizacao } from '../pwa/registar'
import { Botao } from './ui'

/** Faixa que aparece quando uma versão nova da aplicação está instalada e à espera. */
export function AvisoActualizacao() {
  const [pronta, setPronta] = useState(false)
  useEffect(() => aoMudarActualizacao(setPronta), [])
  if (!pronta) return null
  return (
    <div className="faixa-actualizacao" role="status">
      Há uma versão nova da aplicação pronta.
      <Botao variante="secundario" onClick={activarActualizacao}>
        Actualizar agora
      </Botao>
    </div>
  )
}
