// Registo público (decisão de 08/10/2026): cria a empresa, a filial principal (F01) e a conta do
// proprietário numa só operação no servidor. A conta fica PENDENTE até o e-mail ser confirmado:
// não há sessão no registo; segue-se o ecrã "Confirme o seu e-mail".

import { useState, type FormEvent } from 'react'
import { Aviso, Botao, Cartao } from '../../components/ui'
import { errosDeCampos, ErroApi } from '../../servicos/http'
import { enderecoRegistoPendente, problemaCodigo, registar, REGRA_CODIGO_EMPRESA, REGRA_NOME_UTILIZADOR } from '../../servicos/autenticacao'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { sugerirCodigo } from '../formatos'
import { guardarMensagemRegisto } from '../memoria'

export function CriarEmpresa() {
  const [v, setV] = useState({ nomeEmpresa: '', codigoEmpresa: '', nuit: '', telefone: '', nome: '', nomeUtilizador: '', email: '', codigoSecreto: '', confirmacao: '' })
  const [codigoTocado, setCodigoTocado] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [aEnviar, setAEnviar] = useState(false)
  const mudar = (campo: keyof typeof v) => (valor: string) =>
    setV((a) => ({ ...a, [campo]: valor, ...(campo === 'nomeEmpresa' && !codigoTocado ? { codigoEmpresa: sugerirCodigo(valor) } : {}) }))

  function validar(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!v.nomeEmpresa.trim()) e.nomeEmpresa = 'Indique o nome da empresa.'
    if (!REGRA_CODIGO_EMPRESA.test(v.codigoEmpresa.trim().toLowerCase())) e.codigoEmpresa = '3 a 20 caracteres: letras, algarismos e hífen (sem começar nem acabar em hífen).'
    if (v.nuit.trim() && !/^[0-9]{9}$/.test(v.nuit.trim())) e.nuit = 'O NUIT tem 9 algarismos.'
    if (v.telefone.trim() && !/^\+?[0-9 ]{7,20}$/.test(v.telefone.trim())) e.telefone = 'Telefone inválido.'
    if (!v.nome.trim()) e.nome = 'Indique o seu nome.'
    if (!REGRA_NOME_UTILIZADOR.test(v.nomeUtilizador.trim().toLowerCase())) e.nomeUtilizador = '3 a 32 caracteres: letras, algarismos, ponto, hífen e sublinhado.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = 'Indique um e-mail válido.'
    const p = problemaCodigo(v.codigoSecreto)
    if (p) e.codigoSecreto = p
    else if (v.codigoSecreto !== v.confirmacao) e.confirmacao = 'Os dois códigos não coincidem.'
    return e
  }

  async function submeter(ev: FormEvent) {
    ev.preventDefault()
    const e = validar()
    setErros(e)
    setErro(null)
    if (Object.keys(e).length) return
    setAEnviar(true)
    try {
      const r = await registar({
        codigoEmpresa: v.codigoEmpresa.trim().toLowerCase(),
        nomeEmpresa: v.nomeEmpresa.trim(),
        ...(v.nuit.trim() ? { nuit: v.nuit.trim() } : {}),
        ...(v.telefone.trim() ? { telefone: v.telefone.trim() } : {}),
        nome: v.nome.trim(),
        nomeUtilizador: v.nomeUtilizador.trim().toLowerCase(),
        email: v.email.trim(),
        codigoSecreto: v.codigoSecreto,
      })
      guardarMensagemRegisto(r.mensagem)
      window.location.hash = enderecoRegistoPendente(r.codigoEmpresa, r.nomeUtilizador)
    } catch (falha) {
      setErros(errosDeCampos(falha))
      if (falha instanceof ErroApi && falha.codigo === 'codigo_empresa_indisponivel') setErros({ codigoEmpresa: falha.message })
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <main className="login login-real">
      <div className="login-caixa login-caixa-larga">
        <span className="marca marca-grande">Nexo</span>
        <h1>Criar empresa</h1>
        <p className="texto-secundario">Fica como proprietário. A conta fica activa quando confirmar o e-mail; depois cria as contas dos funcionários e combina com eles os códigos de acesso.</p>
        <form className="formulario" onSubmit={submeter} noValidate>
          <Cartao titulo="Empresa">
            <div className="grelha-formulario">
              <CampoTexto rotulo="Nome comercial" valor={v.nomeEmpresa} aoMudar={mudar('nomeEmpresa')} erro={erros.nomeEmpresa} autoComplete="organization" />
              <CampoTexto
                rotulo="Código da empresa"
                valor={v.codigoEmpresa}
                aoMudar={(x) => {
                  setCodigoTocado(true)
                  mudar('codigoEmpresa')(x)
                }}
                erro={erros.codigoEmpresa}
                ajuda="Usado por todos para entrar. Não é segredo e não pode ser mudado depois."
                autoCapitalize="off"
                spellCheck={false}
              />
              <CampoTexto rotulo="NUIT (opcional)" valor={v.nuit} aoMudar={mudar('nuit')} erro={erros.nuit} inputMode="numeric" />
              <CampoTexto rotulo="Telefone (opcional)" valor={v.telefone} aoMudar={mudar('telefone')} erro={erros.telefone} inputMode="tel" autoComplete="tel" />
            </div>
            <p className="nota">A filial principal (F01) é criada automaticamente.</p>
          </Cartao>
          <Cartao titulo="Proprietário">
            <div className="grelha-formulario">
              <CampoTexto rotulo="O seu nome" valor={v.nome} aoMudar={mudar('nome')} erro={erros.nome} autoComplete="name" />
              <CampoTexto rotulo="Nome de utilizador" valor={v.nomeUtilizador} aoMudar={mudar('nomeUtilizador')} erro={erros.nomeUtilizador} autoComplete="username" autoCapitalize="off" spellCheck={false} />
              <CampoTexto
                rotulo="E-mail de recuperação"
                valor={v.email}
                aoMudar={mudar('email')}
                erro={erros.email}
                ajuda="Enviamos um link para o confirmar. Só serve para recuperar o acesso."
                type="email"
                autoComplete="email"
              />
              <span />
              <CampoCodigo rotulo="Código secreto" valor={v.codigoSecreto} aoMudar={mudar('codigoSecreto')} erro={erros.codigoSecreto} autoComplete="new-password" ajuda="Pelo menos 8 caracteres. Uma frase curta é mais fácil de lembrar." />
              <CampoCodigo rotulo="Repetir o código secreto" valor={v.confirmacao} aoMudar={mudar('confirmacao')} erro={erros.confirmacao} autoComplete="new-password" />
            </div>
          </Cartao>
          <ErroFormulario erro={erro} />
          <Aviso tom="info">O código secreto é guardado só como um resumo irreversível: ninguém o consegue consultar, nem o suporte.</Aviso>
          <div className="linha-accoes">
            <a href="#/entrar">Já tenho conta</a>
            <Botao type="submit" disabled={aEnviar}>
              {aEnviar ? 'A criar…' : 'Criar empresa'}
            </Botao>
          </div>
        </form>
      </div>
    </main>
  )
}
