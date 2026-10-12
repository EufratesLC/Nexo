// O meu acesso: alterar o próprio código (todas as funções; exige o actual) e, para proprietários,
// o e-mail de recuperação (registar, mudar, reenviar a confirmação).

import { useState, type FormEvent } from 'react'
import { Aviso, Botao, CabecalhoPagina, Cartao, Etiqueta } from '../../components/ui'
import { errosDeCampos, ErroApi, mensagemDeErro } from '../../servicos/http'
import { alterarCodigo, definirEmailRecuperacao, problemaCodigo, reenviarConfirmacao } from '../../servicos/autenticacao'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { formatarDataHora } from '../formatos'
import { useSessao, useSessaoActiva } from '../useSessao'

export function MeuAcesso() {
  const s = useSessaoActiva()
  return (
    <>
      <CabecalhoPagina titulo="O meu acesso" descricao={`${s.utilizador.nome} · utilizador ${s.utilizador.nomeUtilizador} · empresa ${s.empresa.codigo}`} />
      <AlterarCodigo />
      {s.utilizador.funcao === 'proprietario' && <EmailRecuperacao />}
    </>
  )
}

function AlterarCodigo() {
  const [v, setV] = useState({ actual: '', novo: '', confirmacao: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [ok, setOk] = useState(false)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!v.actual) n.actual = 'Indique o código actual.'
    const p = problemaCodigo(v.novo)
    if (p) n.codigoNovo = p
    else if (v.novo === v.actual) n.codigoNovo = 'O código novo tem de ser diferente do actual.'
    else if (v.novo !== v.confirmacao) n.confirmacao = 'Os dois códigos não coincidem.'
    setErros(n)
    setErro(null)
    setOk(false)
    if (Object.keys(n).length) return
    setAEnviar(true)
    try {
      await alterarCodigo(v.actual, v.novo)
      setV({ actual: '', novo: '', confirmacao: '' })
      setOk(true)
    } catch (falha) {
      const campos = errosDeCampos(falha)
      if (falha instanceof ErroApi && falha.codigo === 'codigo_actual_incorrecto') campos.actual = falha.message
      setErros(campos)
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <form className="formulario" onSubmit={submeter} noValidate>
      <Cartao titulo="Alterar o meu código secreto">
        <div className="grelha-formulario">
          <CampoCodigo rotulo="Código actual" valor={v.actual} aoMudar={(x) => setV({ ...v, actual: x })} erro={erros.actual} />
          <span />
          <CampoCodigo rotulo="Código novo" valor={v.novo} aoMudar={(x) => setV({ ...v, novo: x })} erro={erros.codigoNovo} autoComplete="new-password" ajuda="Pelo menos 8 caracteres; pode ser uma frase." />
          <CampoCodigo rotulo="Repetir o código novo" valor={v.confirmacao} aoMudar={(x) => setV({ ...v, confirmacao: x })} erro={erros.confirmacao} autoComplete="new-password" />
        </div>
        {ok && <Aviso tom="sucesso">Código alterado. As suas outras sessões (noutros aparelhos) terminaram; esta continua.</Aviso>}
        <ErroFormulario erro={erro} />
        <div className="linha-accoes">
          <Botao type="submit" disabled={aEnviar}>
            {aEnviar ? 'A guardar…' : 'Alterar código'}
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}

function EmailRecuperacao() {
  const s = useSessaoActiva()
  const { actualizar } = useSessao()
  const estado = s.emailRecuperacao
  const [v, setV] = useState({ email: '', actual: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) n.email = 'Indique um e-mail válido.'
    if (!v.actual) n.actual = 'Indique o código actual.'
    setErros(n)
    setErro(null)
    setMensagem(null)
    if (Object.keys(n).length) return
    setAEnviar(true)
    try {
      setMensagem(await definirEmailRecuperacao(v.actual, v.email.trim()))
      setV({ email: '', actual: '' })
      void actualizar()
    } catch (falha) {
      const campos = errosDeCampos(falha)
      if (falha instanceof ErroApi && falha.codigo === 'codigo_actual_incorrecto') campos.actual = falha.message
      setErros(campos)
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  async function reenviar() {
    setErro(null)
    setMensagem(null)
    try {
      setMensagem(await reenviarConfirmacao())
    } catch (falha) {
      setErro(falha)
    }
  }

  return (
    <form className="formulario" onSubmit={submeter} noValidate>
      <Cartao titulo="E-mail de recuperação">
        <p className="texto-secundario">Só serve para recuperar o acesso se perder o código. Os funcionários não têm e-mail: o proprietário define os seus códigos.</p>
        <ul className="lista-estado">
          <li>
            <span>Confirmado</span>
            {estado?.email ? (
              <span>
                <Etiqueta tom="sucesso">{estado.email}</Etiqueta> {estado.confirmadoEm && <small>desde {formatarDataHora(estado.confirmadoEm)}</small>}
              </span>
            ) : (
              <Etiqueta tom="aviso">Nenhum</Etiqueta>
            )}
          </li>
          {estado?.emailPendente && (
            <li>
              <span>À espera de confirmação</span>
              <span>
                {estado.emailPendente}{' '}
                <Botao variante="discreto" onClick={() => void reenviar()}>
                  Reenviar link
                </Botao>
              </span>
            </li>
          )}
        </ul>
        <div className="grelha-formulario">
          <CampoTexto rotulo={estado?.email ? 'Mudar para outro e-mail' : 'E-mail'} valor={v.email} aoMudar={(x) => setV({ ...v, email: x })} erro={erros.email} type="email" autoComplete="email" />
          <CampoCodigo rotulo="Código actual (para confirmar que é você)" valor={v.actual} aoMudar={(x) => setV({ ...v, actual: x })} erro={erros.actual} />
        </div>
        {mensagem && <Aviso tom="sucesso">{mensagem}</Aviso>}
        {erro !== null && (erro instanceof ErroApi && erro.codigo === 'sem_email_pendente' ? <Aviso tom="aviso">{mensagemDeErro(erro)}</Aviso> : <ErroFormulario erro={erro} />)}
        <div className="linha-accoes">
          <Botao type="submit" variante="secundario" disabled={aEnviar}>
            Enviar link de confirmação
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}
