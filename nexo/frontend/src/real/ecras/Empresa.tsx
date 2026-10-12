// Dados da empresa e da filial. Todos vêem; só o proprietário altera (a API verifica). O piloto tem
// uma filial; o modelo e a API já validam a filial escolhida (preparação para várias).

import { useState, type FormEvent } from 'react'
import { Carregando, EstadoErro } from '../../components/estados'
import { Aviso, Botao, CabecalhoPagina, Cartao } from '../../components/ui'
import { useRecurso } from '../../lib/useRecurso'
import { errosDeCampos } from '../../servicos/http'
import { alterarEmpresa, alterarFilial, obterEmpresa } from '../../servicos/administracao'
import type { Empresa, Filial } from '../../servicos/autenticacao'
import { CampoTexto, ErroFormulario } from '../componentes'
import { useSessao, useSessaoActiva } from '../useSessao'

export function EmpresaFilial() {
  const s = useSessaoActiva()
  const [estado, repetir] = useRecurso(obterEmpresa)
  const dono = s.utilizador.funcao === 'proprietario'
  return (
    <>
      <CabecalhoPagina titulo="Empresa e filial" descricao={dono ? 'Dados da empresa. Só o proprietário os altera.' : 'Dados da empresa (só leitura).'} />
      {estado.tipo === 'a_carregar' && <Carregando />}
      {estado.tipo === 'erro' && <EstadoErro erro={estado.erro} aoRepetir={repetir} />}
      {estado.tipo === 'pronto' &&
        (dono ? (
          <>
            <FormEmpresa empresa={estado.dados.empresa} />
            {estado.dados.filiais.map((f) => (
              <FormFilial key={f.id} filial={f} />
            ))}
          </>
        ) : (
          <Cartao titulo={estado.dados.empresa.nome}>
            <ul className="lista-estado">
              <li>
                <span>Código da empresa</span>
                <code>{estado.dados.empresa.codigo}</code>
              </li>
              {estado.dados.filiais.map((f) => (
                <li key={f.id}>
                  <span>Filial</span>
                  <span>
                    {f.codigo} · {f.nome}
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        ))}
    </>
  )
}

function FormEmpresa({ empresa }: { empresa: Empresa }) {
  const { actualizar } = useSessao()
  const [v, setV] = useState({ nome: empresa.nome, nuit: empresa.nuit ?? '', telefone: empresa.telefone ?? '', endereco: empresa.endereco ?? '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [ok, setOk] = useState(false)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!v.nome.trim()) n.nome = 'Indique o nome.'
    if (v.nuit.trim() && !/^[0-9]{9}$/.test(v.nuit.trim())) n.nuit = 'O NUIT tem 9 algarismos.'
    if (v.telefone.trim() && !/^\+?[0-9 ]{7,20}$/.test(v.telefone.trim())) n.telefone = 'Telefone inválido.'
    setErros(n)
    setErro(null)
    setOk(false)
    if (Object.keys(n).length) return
    setAEnviar(true)
    try {
      await alterarEmpresa({ nome: v.nome.trim(), nuit: v.nuit.trim() || null, telefone: v.telefone.trim() || null, endereco: v.endereco.trim() || null })
      setOk(true)
      void actualizar()
    } catch (falha) {
      setErros(errosDeCampos(falha))
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <form className="formulario" onSubmit={submeter} noValidate>
      <Cartao titulo="Empresa">
        <p className="texto-secundario">
          Código da empresa: <code>{empresa.codigo}</code> — os funcionários usam-no para entrar. Não pode ser alterado.
        </p>
        <div className="grelha-formulario">
          <CampoTexto rotulo="Nome comercial" valor={v.nome} aoMudar={(x) => setV({ ...v, nome: x })} erro={erros.nome} />
          <CampoTexto rotulo="NUIT" valor={v.nuit} aoMudar={(x) => setV({ ...v, nuit: x })} erro={erros.nuit} inputMode="numeric" />
          <CampoTexto rotulo="Telefone" valor={v.telefone} aoMudar={(x) => setV({ ...v, telefone: x })} erro={erros.telefone} inputMode="tel" />
          <CampoTexto rotulo="Endereço" valor={v.endereco} aoMudar={(x) => setV({ ...v, endereco: x })} erro={erros.endereco} />
        </div>
        {ok && <Aviso tom="sucesso">Dados guardados.</Aviso>}
        <ErroFormulario erro={erro} />
        <div className="linha-accoes">
          <Botao type="submit" disabled={aEnviar}>
            Guardar
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}

function FormFilial({ filial }: { filial: Filial }) {
  const { actualizar } = useSessao()
  const [nome, setNome] = useState(filial.nome)
  const [erroNome, setErroNome] = useState<string | undefined>()
  const [erro, setErro] = useState<unknown>(null)
  const [ok, setOk] = useState(false)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setOk(false)
    setErroNome(nome.trim() ? undefined : 'Indique o nome da filial.')
    if (!nome.trim()) return
    setAEnviar(true)
    try {
      await alterarFilial(filial.id, nome.trim())
      setOk(true)
      void actualizar()
    } catch (falha) {
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  return (
    <form className="formulario" onSubmit={submeter} noValidate>
      <Cartao titulo={`Filial ${filial.codigo}`}>
        <CampoTexto rotulo="Nome da filial" valor={nome} aoMudar={setNome} erro={erroNome} />
        <p className="nota">No piloto há uma filial por empresa. O modelo já está preparado para várias.</p>
        {ok && <Aviso tom="sucesso">Nome guardado.</Aviso>}
        <ErroFormulario erro={erro} />
        <div className="linha-accoes">
          <Botao type="submit" variante="secundario" disabled={aEnviar}>
            Guardar
          </Botao>
        </div>
      </Cartao>
    </form>
  )
}
