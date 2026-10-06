// Componentes comuns para estados de carregamento e de erro. O estado vazio continua em ui.tsx
// (EstadoVazio), usado desde a Etapa 1.

import { ErroApi, mensagemDeErro } from '../servicos/http'
import { Botao } from './ui'

export function Carregando({ texto = 'A carregar…' }: { texto?: string }) {
  return (
    <div className="estado-carregando" role="status" aria-live="polite">
      <span className="indicador-carregamento" aria-hidden="true" />
      {texto}
    </div>
  )
}

export function EstadoErro({ erro, titulo = 'Não foi possível carregar', aoRepetir }: { erro: unknown; titulo?: string; aoRepetir?: () => void }) {
  const api = erro instanceof ErroApi ? erro : null
  return (
    <div className="estado-erro" role="alert">
      <strong>{titulo}</strong>
      <p>{mensagemDeErro(erro)}</p>
      {api && (
        <p className="texto-secundario">
          Código: {api.codigo}
          {api.estado ? ` · HTTP ${api.estado}` : ''} · Pedido: <code>{api.pedidoId}</code>
        </p>
      )}
      {aoRepetir && (
        <Botao variante="secundario" onClick={aoRepetir}>
          Tentar de novo
        </Botao>
      )}
    </div>
  )
}
