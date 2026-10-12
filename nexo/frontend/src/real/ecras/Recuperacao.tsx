// Recuperação do acesso do PROPRIETÁRIO (decisão de 08/10/2026) e confirmação do e-mail.
//
// - Pedir: código da empresa + nome de utilizador. A resposta é sempre a mesma, exista ou não a conta.
// - Definir o novo código: pelo link do e-mail (token no fragmento #). O ecrã lê o token, retira-o
//   do endereço e envia-o à API no corpo. O código anterior nunca é mostrado.
// - Confirmar o e-mail: idem, com o link de confirmação.

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Carregando } from '../../components/estados'
import { Aviso, Botao } from '../../components/ui'
import { ErroApi, mensagemDeErro } from '../../servicos/http'
import { concluirRecuperacao, confirmarEmail, pedirRecuperacao, problemaCodigo } from '../../servicos/autenticacao'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { retirarParametros } from '../rotas'

export function PedirRecuperacao() {
  const [codigoEmpresa, setCodigoEmpresa] = useState(() => {
    try {
      return localStorage.getItem('nexo.codigoEmpresa') ?? ''
    } catch {
      return ''
    }
  })
  const [nomeUtilizador, setNomeUtilizador] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [resposta, setResposta] = useState<string | null>(null)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const novos: Record<string, string> = {}
    if (!codigoEmpresa.trim()) novos.codigoEmpresa = 'Indique o código da empresa.'
    if (!nomeUtilizador.trim()) novos.nomeUtilizador = 'Indique o nome de utilizador.'
    setErros(novos)
    setErro(null)
    if (Object.keys(novos).length) return
    setAEnviar(true)
    try {
      setResposta(await pedirRecuperacao({ codigoEmpresa: codigoEmpresa.trim(), nomeUtilizador: nomeUtilizador.trim() }))
    } catch (falha) {
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <main className="login login-real">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Recuperar o acesso</h1>
        <Aviso tom="info">
          Só para <strong>proprietários</strong> com e-mail de recuperação confirmado. Funcionários: peçam um novo código ao proprietário.
        </Aviso>
        {resposta ? (
          <Aviso tom="sucesso" titulo="Pedido recebido">
            {resposta}
          </Aviso>
        ) : (
          <form className="formulario cartao" onSubmit={submeter} noValidate>
            <CampoTexto rotulo="Código da empresa" valor={codigoEmpresa} aoMudar={setCodigoEmpresa} erro={erros.codigoEmpresa} autoCapitalize="off" spellCheck={false} />
            <CampoTexto rotulo="Nome de utilizador" valor={nomeUtilizador} aoMudar={setNomeUtilizador} erro={erros.nomeUtilizador} autoComplete="username" autoCapitalize="off" spellCheck={false} />
            <ErroFormulario erro={erro} />
            <Botao type="submit" disabled={aEnviar} className="botao-largo">
              {aEnviar ? 'A enviar…' : 'Enviar link de recuperação'}
            </Botao>
          </form>
        )}
        <p className="nota">
          Perdeu também o acesso ao e-mail? Contacte o suporte do Nexo: a recuperação assistida exige confirmar a identidade e o vínculo à
          empresa.
        </p>
        <a href="#/entrar">Voltar a entrar</a>
      </div>
    </main>
  )
}

/** Lê o token do fragmento uma vez e retira-o do endereço. */
function useTokenDoLink(parametros: URLSearchParams, caminho: string): string {
  const [token] = useState(() => parametros.get('token') ?? '')
  useEffect(() => {
    if (parametros.has('token')) retirarParametros(caminho)
  }, [parametros, caminho])
  return token
}

export function DefinirNovoCodigo({ parametros }: { parametros: URLSearchParams }) {
  const token = useTokenDoLink(parametros, 'recuperar-acesso')
  const [codigo, setCodigo] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [feito, setFeito] = useState(false)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const novos: Record<string, string> = {}
    const p = problemaCodigo(codigo)
    if (p) novos.codigo = p
    else if (codigo !== confirmacao) novos.confirmacao = 'Os dois códigos não coincidem.'
    setErros(novos)
    setErro(null)
    if (Object.keys(novos).length) return
    setAEnviar(true)
    try {
      await concluirRecuperacao(token, codigo)
      setFeito(true)
    } catch (falha) {
      if (falha instanceof ErroApi && falha.codigo === 'validacao') setErros({ codigo: mensagemDeErro(falha) })
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <main className="login login-real">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Definir um novo código de acesso</h1>
        {!token ? (
          <Aviso tom="perigo" titulo="Link incompleto">
            Abra o link exactamente como chegou no e-mail, ou <a href="#/recuperar">peça um novo</a>.
          </Aviso>
        ) : feito ? (
          <Aviso tom="sucesso" titulo="Código redefinido">
            O código anterior deixou de funcionar e todas as sessões abertas terminaram. <a href="#/entrar">Entrar com o novo código</a>.
          </Aviso>
        ) : (
          <form className="formulario cartao" onSubmit={submeter} noValidate>
            <p className="texto-secundario">O código anterior não é mostrado. Ao guardar, deixa de funcionar e todas as sessões da conta terminam.</p>
            <CampoCodigo rotulo="Código novo" valor={codigo} aoMudar={setCodigo} erro={erros.codigo} autoComplete="new-password" />
            <CampoCodigo rotulo="Repetir o código novo" valor={confirmacao} aoMudar={setConfirmacao} erro={erros.confirmacao} autoComplete="new-password" />
            <ErroFormulario erro={erro} />
            {erro instanceof ErroApi && erro.codigo === 'link_invalido' && <a href="#/recuperar">Pedir um link novo</a>}
            <Botao type="submit" disabled={aEnviar} className="botao-largo">
              {aEnviar ? 'A guardar…' : 'Guardar o código novo'}
            </Botao>
          </form>
        )}
      </div>
    </main>
  )
}

export function ConfirmarEmail({ parametros, comSessao, aoConfirmar }: { parametros: URLSearchParams; comSessao: boolean; aoConfirmar: () => void }) {
  const token = useTokenDoLink(parametros, 'confirmar-email')
  const [estado, setEstado] = useState<'a_confirmar' | 'ok' | 'activada' | { erro: unknown }>(token ? 'a_confirmar' : { erro: new ErroApi('link_invalido', 'O link está incompleto.', null, '') })
  const enviado = useRef(false)
  useEffect(() => {
    if (!token || enviado.current) return
    enviado.current = true
    confirmarEmail(token).then(
      (r) => {
        setEstado(r.contaActivada ? 'activada' : 'ok')
        aoConfirmar()
      },
      (erro: unknown) => setEstado({ erro }),
    )
  }, [token, aoConfirmar])

  return (
    <main className="login login-real">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Confirmar o e-mail de recuperação</h1>
        {estado === 'a_confirmar' && <Carregando texto="A confirmar…" />}
        {estado === 'ok' && <Aviso tom="sucesso" titulo="E-mail confirmado">Já pode recuperar o acesso por este e-mail, se precisar.</Aviso>}
        {estado === 'activada' && (
          <Aviso tom="sucesso" titulo="Conta activada">
            O e-mail ficou confirmado e a conta está activa. Já pode entrar com o código da empresa, o nome de utilizador e o código secreto.
          </Aviso>
        )}
        {typeof estado === 'object' && (
          <Aviso tom="perigo" titulo="Não foi possível confirmar">
            {mensagemDeErro(estado.erro)} {comSessao ? 'Pode pedir um novo link em "O meu acesso".' : 'Entre na sua conta para pedir um novo link.'}
          </Aviso>
        )}
        <a href={comSessao ? '#/meu-acesso' : '#/entrar'}>{comSessao ? 'Ir para "O meu acesso"' : 'Entrar'}</a>
        {typeof estado === 'object' && !comSessao && <a href="#/entrar">Registo por confirmar? Entre com os seus dados para pedir um novo link.</a>}
      </div>
    </main>
  )
}
