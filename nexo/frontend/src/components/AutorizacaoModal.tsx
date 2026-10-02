import { useState } from 'react'
import { useDemo } from '../demo/contexto'
import type { Utilizador } from '../demo/tipos'
import { Aviso, Botao, Campo, Modal } from './ui'

/**
 * Pedido de autorização por PIN (🔑 na matriz de permissões). No protótipo o PIN
 * é fictício e comparado em claro; no produto é verificado localmente contra um
 * verificador com derivação lenta (D.13.5) e a autorização é revalidada no servidor.
 */
export function AutorizacaoModal({
  titulo,
  explicacao,
  podeAutorizar,
  aoAutorizar,
  aoFechar,
}: {
  titulo: string
  explicacao: string
  podeAutorizar: (u: Utilizador) => boolean
  aoAutorizar: (autorizador: Utilizador, motivo: string) => void
  aoFechar: () => void
}) {
  const { estado, utilizador } = useDemo()
  const candidatos = estado.utilizadores.filter((u) => u.id !== utilizador?.id && podeAutorizar(u))
  const [autorizadorId, setAutorizadorId] = useState(candidatos[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erros, setErros] = useState<{ pin?: string; motivo?: string }>({})

  const confirmar = () => {
    const autorizador = candidatos.find((u) => u.id === autorizadorId)
    const novos: typeof erros = {}
    if (!autorizador || pin !== autorizador.pinDemo) novos.pin = 'PIN incorrecto.'
    if (motivo.trim() === '') novos.motivo = 'Indique o motivo.'
    setErros(novos)
    if (autorizador && Object.keys(novos).length === 0) aoAutorizar(autorizador, motivo.trim())
  }

  return (
    <Modal titulo={titulo} aoFechar={aoFechar}>
      <p>{explicacao}</p>
      {candidatos.length === 0 ? (
        <Aviso tom="aviso">Nenhum outro utilizador tem permissão para autorizar.</Aviso>
      ) : (
        <form
          className="formulario"
          onSubmit={(e) => {
            e.preventDefault()
            confirmar()
          }}
        >
          <Campo rotulo="Quem autoriza">
            {(p) => (
              <select {...p} value={autorizadorId} onChange={(e) => setAutorizadorId(e.target.value)}>
                {candidatos.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="PIN de quem autoriza" erro={erros.pin} ajuda="PIN fictício: Carlos 1234, Marta 4321.">
            {(p) => (
              <input {...p} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
            )}
          </Campo>
          <Campo rotulo="Motivo" erro={erros.motivo}>
            {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          </Campo>
          <p className="nota">
            Simulação: o PIN só desbloqueia a aplicação neste aparelho. Não prova a identidade da pessoa (D.12.4.1).
          </p>
          <div className="linha-accoes">
            <Botao variante="secundario" onClick={aoFechar}>
              Cancelar
            </Botao>
            <Botao type="submit">Autorizar</Botao>
          </div>
        </form>
      )}
    </Modal>
  )
}
