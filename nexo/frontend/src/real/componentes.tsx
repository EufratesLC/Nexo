// Componentes comuns dos ecrãs reais (formulários, acesso negado).

import { useState, type InputHTMLAttributes } from 'react'
import { Aviso, Campo, EstadoVazio } from '../components/ui'
import { ErroApi, mensagemDeErro } from '../servicos/http'
import { NOMES_FUNCAO, type Funcao } from '../servicos/autenticacao'

type PropsTexto = {
  rotulo: string
  valor: string
  aoMudar: (v: string) => void
  erro?: string
  ajuda?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

export function CampoTexto({ rotulo, valor, aoMudar, erro, ajuda, ...resto }: PropsTexto) {
  return (
    <Campo rotulo={rotulo} erro={erro} ajuda={ajuda}>
      {(p) => <input {...p} {...resto} value={valor} onChange={(e) => aoMudar(e.target.value)} />}
    </Campo>
  )
}

/** Código secreto: escondido por omissão, com botão para mostrar. Nunca guardado no navegador. */
export function CampoCodigo({ rotulo, valor, aoMudar, erro, ajuda, autoComplete = 'current-password', ...resto }: PropsTexto) {
  const [visivel, setVisivel] = useState(false)
  return (
    <Campo rotulo={rotulo} erro={erro} ajuda={ajuda}>
      {(p) => (
        <div className="grupo-entrada">
          <input
            {...p}
            {...resto}
            type={visivel ? 'text' : 'password'}
            autoComplete={autoComplete}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
          />
          <button type="button" className="botao botao-secundario botao-mostrar" aria-pressed={visivel} onClick={() => setVisivel((v) => !v)}>
            {visivel ? 'Esconder' : 'Mostrar'}
          </button>
        </div>
      )}
    </Campo>
  )
}

/** Erro de um envio de formulário (os erros por campo aparecem junto dos campos). */
export function ErroFormulario({ erro }: { erro: unknown }) {
  if (!erro) return null
  const api = erro instanceof ErroApi ? erro : null
  return (
    <Aviso tom="perigo" titulo={api?.codigo === 'validacao' ? 'Verifique os campos assinalados' : 'Não foi possível concluir'}>
      {mensagemDeErro(erro)}
      {api?.codigo === 'demasiadas_tentativas' && <p className="texto-secundario">Por segurança, as tentativas ficam suspensas durante alguns minutos.</p>}
    </Aviso>
  )
}

export function AcessoNegado({ funcao }: { funcao: Funcao }) {
  return (
    <EstadoVazio titulo="Sem acesso a esta página" accao={<a href="#/inicio">Voltar ao início</a>}>
      A função {NOMES_FUNCAO[funcao]} não tem acesso a esta página. O servidor recusa estas operações mesmo que sejam pedidas
      directamente.
    </EstadoVazio>
  )
}
