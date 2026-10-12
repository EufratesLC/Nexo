// Registo à espera da confirmação do e-mail (revisão de 08/10/2026). Sem sessão: a conta só fica
// activa quando o proprietário abrir o link. Permite reenviar o link (resposta neutra, com limites
// na API e na base) e corrigir o e-mail indicado, com o código secreto.

import { useState, type FormEvent } from 'react'
import { Aviso, Botao, Cartao } from '../../components/ui'
import { errosDeCampos } from '../../servicos/http'
import { corrigirEmailActivacao, reenviarActivacao } from '../../servicos/autenticacao'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { lerMensagemRegisto } from '../memoria'

export function RegistoPendente({ parametros }: { parametros: URLSearchParams }) {
  const codigoEmpresa = parametros.get('empresa') ?? ''
  const nomeUtilizador = parametros.get('utilizador') ?? ''
  const [mensagemRegisto] = useState(lerMensagemRegisto)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<unknown>(null)
  const [aEnviar, setAEnviar] = useState(false)
  const [correccao, setCorreccao] = useState({ email: '', codigo: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erroCorreccao, setErroCorreccao] = useState<unknown>(null)

  async function reenviar() {
    setErro(null)
    setAviso(null)
    setAEnviar(true)
    try {
      setAviso(await reenviarActivacao({ codigoEmpresa, nomeUtilizador }))
    } catch (falha) {
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  async function corrigir(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correccao.email.trim())) n.email = 'Indique um e-mail válido.'
    if (!correccao.codigo) n.codigoSecreto = 'Indique o código secreto que escolheu no registo.'
    setErros(n)
    setErroCorreccao(null)
    setAviso(null)
    if (Object.keys(n).length) return
    setAEnviar(true)
    try {
      setAviso(await corrigirEmailActivacao({ codigoEmpresa, nomeUtilizador, codigoSecreto: correccao.codigo, email: correccao.email.trim() }))
      setCorreccao({ email: '', codigo: '' })
    } catch (falha) {
      setErros(errosDeCampos(falha))
      setErroCorreccao(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <main className="login login-real">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Confirme o seu e-mail</h1>
        <Aviso tom="info" titulo="Falta um passo para activar a conta">
          {mensagemRegisto ?? 'Enviámos um link de confirmação para o e-mail indicado no registo. A conta fica activa quando o abrir.'}
        </Aviso>
        <Cartao>
          <ol className="lista-passos">
            <li>Abra o e-mail com o assunto "Nexo — confirme o seu e-mail de recuperação" (veja também a pasta de spam).</li>
            <li>Abra o link. É de utilização única e expira em 48 horas.</li>
            <li>
              Depois entre com o código da empresa <code>{codigoEmpresa || '—'}</code>, o nome de utilizador <code>{nomeUtilizador || '—'}</code> e o seu código
              secreto.
            </li>
          </ol>
          <p className="nota">Até confirmar, não é possível entrar. Este e-mail também serve para recuperar o acesso se perder o código.</p>
        </Cartao>
        {aviso && <Aviso tom="sucesso">{aviso}</Aviso>}
        <ErroFormulario erro={erro} />
        <div className="linha-accoes">
          <a href="#/entrar">Já confirmei — entrar</a>
          <Botao variante="secundario" disabled={aEnviar || !codigoEmpresa || !nomeUtilizador} onClick={() => void reenviar()}>
            Reenviar o e-mail
          </Botao>
        </div>
        <form className="formulario cartao" onSubmit={corrigir} noValidate>
          <h2 className="titulo-cartao">Enganou-se no e-mail?</h2>
          <p className="texto-secundario">Indique o e-mail certo e o código secreto que escolheu no registo. O link anterior deixa de valer.</p>
          <CampoTexto rotulo="E-mail certo" valor={correccao.email} aoMudar={(x) => setCorreccao({ ...correccao, email: x })} erro={erros.email} type="email" autoComplete="email" />
          <CampoCodigo rotulo="Código secreto" valor={correccao.codigo} aoMudar={(x) => setCorreccao({ ...correccao, codigo: x })} erro={erros.codigoSecreto} />
          <ErroFormulario erro={erroCorreccao} />
          <Botao type="submit" variante="secundario" disabled={aEnviar || !codigoEmpresa || !nomeUtilizador}>
            Enviar para o e-mail certo
          </Botao>
        </form>
      </div>
    </main>
  )
}
