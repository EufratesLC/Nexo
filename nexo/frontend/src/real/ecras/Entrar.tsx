// Login real: código da empresa + nome de utilizador + código secreto (H-02). O código da empresa
// selecciona a empresa; a API confirma a conta, o estado e a função. O código da empresa pode ficar
// lembrado neste aparelho (não é segredo); o código secreto nunca fica guardado.

import { useState, type FormEvent } from 'react'
import { Aviso, Botao } from '../../components/ui'
import { enderecoRegistoPendente, entrar } from '../../servicos/autenticacao'
import { ErroApi } from '../../servicos/http'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { useSessao } from '../useSessao'

const CHAVE_EMPRESA = 'nexo.codigoEmpresa'

function lerLembrado(): string {
  try {
    return localStorage.getItem(CHAVE_EMPRESA) ?? ''
  } catch {
    return ''
  }
}

export function Entrar({ aviso }: { aviso?: 'terminada' | 'saiu' }) {
  const { iniciar } = useSessao()
  const [codigoEmpresa, setCodigoEmpresa] = useState(lerLembrado)
  const [nomeUtilizador, setNomeUtilizador] = useState('')
  const [codigoSecreto, setCodigoSecreto] = useState('')
  const [lembrar, setLembrar] = useState(() => lerLembrado() !== '')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const novos: Record<string, string> = {}
    if (!codigoEmpresa.trim()) novos.codigoEmpresa = 'Indique o código da empresa.'
    if (!nomeUtilizador.trim()) novos.nomeUtilizador = 'Indique o nome de utilizador.'
    if (!codigoSecreto) novos.codigoSecreto = 'Indique o código secreto.'
    setErros(novos)
    setErro(null)
    if (Object.keys(novos).length) return
    setAEnviar(true)
    try {
      const sessao = await entrar({ codigoEmpresa: codigoEmpresa.trim(), nomeUtilizador: nomeUtilizador.trim(), codigoSecreto })
      try {
        if (lembrar) localStorage.setItem(CHAVE_EMPRESA, codigoEmpresa.trim().toLowerCase())
        else localStorage.removeItem(CHAVE_EMPRESA)
      } catch {
        // armazenamento indisponível: só não fica lembrado
      }
      setCodigoSecreto('')
      iniciar(sessao)
      window.location.hash = '#/inicio'
    } catch (falha) {
      setErro(falha)
      setCodigoSecreto('')
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <main className="login login-real">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Entrar</h1>
        {aviso === 'terminada' && (
          <Aviso tom="aviso" titulo="A sua sessão terminou">
            Expirou, foi terminada noutro lado, o código de acesso mudou ou a conta foi desactivada. Entre de novo.
          </Aviso>
        )}
        {aviso === 'saiu' && <Aviso tom="sucesso">Saiu da sua conta.</Aviso>}
        <form className="formulario cartao" onSubmit={submeter} noValidate>
          <CampoTexto
            rotulo="Código da empresa"
            valor={codigoEmpresa}
            aoMudar={setCodigoEmpresa}
            erro={erros.codigoEmpresa}
            ajuda="Dado pelo proprietário da empresa (ex.: loja-do-bairro)."
            autoComplete="organization"
            autoCapitalize="off"
            spellCheck={false}
            name="codigoEmpresa"
          />
          <CampoTexto
            rotulo="Nome de utilizador"
            valor={nomeUtilizador}
            aoMudar={setNomeUtilizador}
            erro={erros.nomeUtilizador}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            name="nomeUtilizador"
          />
          <CampoCodigo rotulo="Código secreto" valor={codigoSecreto} aoMudar={setCodigoSecreto} erro={erros.codigoSecreto} name="codigoSecreto" />
          <label className="caixa-seleccao">
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
            Lembrar o código da empresa neste aparelho
          </label>
          <ErroFormulario erro={erro} />
          {erro instanceof ErroApi && erro.codigo === 'activacao_pendente' && (
            <a href={enderecoRegistoPendente(codigoEmpresa.trim().toLowerCase(), nomeUtilizador.trim().toLowerCase())}>Reenviar o e-mail de confirmação</a>
          )}
          <Botao type="submit" disabled={aEnviar} className="botao-largo">
            {aEnviar ? 'A entrar…' : 'Entrar'}
          </Botao>
        </form>
        <ul className="lista-ligacoes">
          <li>
            Funcionário sem acesso? <strong>Peça ao proprietário um novo código.</strong>
          </li>
          <li>
            <a href="#/recuperar">Proprietário: esqueci o código de acesso</a>
          </li>
          <li>
            <a href="#/criar-empresa">Criar uma empresa nova</a>
          </li>
          <li>
            <a href="#/sistema">Estado do sistema</a>
          </li>
        </ul>
      </div>
    </main>
  )
}
