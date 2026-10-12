// Contas da empresa (só o proprietário; H-02). Lista, criação e ficha de cada conta: função,
// filiais permitidas, desactivação/reactivação e novo código secreto. O código nunca é mostrado
// depois de gravado (nem o novo): o proprietário combina-o com o funcionário pessoalmente.

import { useCallback, useState, type FormEvent } from 'react'
import { Carregando, EstadoErro } from '../../components/estados'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, Etiqueta, EstadoVazio } from '../../components/ui'
import { useRecurso } from '../../lib/useRecurso'
import { errosDeCampos, ErroApi } from '../../servicos/http'
import {
  alterarUtilizador,
  criarUtilizador,
  definirCodigo,
  desactivarUtilizador,
  listarUtilizadores,
  obterUtilizador,
  reactivarUtilizador,
  type ContaUtilizador,
} from '../../servicos/administracao'
import { NOMES_FUNCAO, problemaCodigo, REGRA_NOME_UTILIZADOR, type Filial, type Funcao } from '../../servicos/autenticacao'
import { CampoCodigo, CampoTexto, ErroFormulario } from '../componentes'
import { formatarDataHora } from '../formatos'
import { useSessaoActiva } from '../useSessao'

function nomesFiliais(ids: string[], filiais: Filial[], funcao: Funcao): string {
  if (funcao === 'proprietario') return 'Todas'
  return ids.map((id) => filiais.find((f) => f.id === id)?.codigo ?? '?').join(', ') || '—'
}

export function ListaFuncionarios() {
  const s = useSessaoActiva()
  const [estado, repetir] = useRecurso(listarUtilizadores)
  return (
    <>
      <CabecalhoPagina
        titulo="Funcionários"
        descricao="Contas de acesso da empresa. Só o proprietário as cria e altera."
        accoes={
          <a className="botao botao-primario" href="#/funcionarios/novo">
            Nova conta
          </a>
        }
      />
      {estado.tipo === 'a_carregar' && <Carregando texto="A carregar as contas…" />}
      {estado.tipo === 'erro' && <EstadoErro erro={estado.erro} aoRepetir={repetir} />}
      {estado.tipo === 'pronto' && estado.dados.length <= 1 && (
        <EstadoVazio titulo="Ainda não há funcionários" accao={<a href="#/funcionarios/novo">Criar a primeira conta</a>}>
          Crie uma conta para cada pessoa que vai usar o Nexo. Cada uma entra com o código da empresa, o seu nome de utilizador e o seu
          código secreto.
        </EstadoVazio>
      )}
      {estado.tipo === 'pronto' && estado.dados.length > 0 && (
        <div className="tabela-contentor">
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Utilizador</th>
                <th>Função</th>
                <th>Filiais</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {estado.dados.map((u) => (
                <tr key={u.id}>
                  <td>
                    <a href={`#/funcionarios/${u.id}`}>{u.nome}</a>
                    {u.id === s.utilizador.id && <span className="texto-secundario"> (a sua conta)</span>}
                  </td>
                  <td>
                    <code>{u.nomeUtilizador}</code>
                  </td>
                  <td>{NOMES_FUNCAO[u.funcao]}</td>
                  <td>{nomesFiliais(u.filiais, s.filiais, u.funcao)}</td>
                  <td>{u.estado === 'activo' ? <Etiqueta tom="sucesso">Activa</Etiqueta> : <Etiqueta>Desactivada</Etiqueta>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function SeleccaoFiliais({ filiais, valor, aoMudar, erro }: { filiais: Filial[]; valor: string[]; aoMudar: (v: string[]) => void; erro?: string }) {
  return (
    <fieldset className={`grupo-opcoes ${erro ? 'campo-erro' : ''}`}>
      <legend>Filiais permitidas</legend>
      {filiais.map((f) => (
        <label key={f.id} className="caixa-seleccao">
          <input type="checkbox" checked={valor.includes(f.id)} onChange={(e) => aoMudar(e.target.checked ? [...valor, f.id] : valor.filter((x) => x !== f.id))} />
          {f.codigo} · {f.nome}
        </label>
      ))}
      {erro && <p className="campo-mensagem">{erro}</p>}
    </fieldset>
  )
}

function SeleccaoFuncao({ valor, aoMudar }: { valor: Funcao; aoMudar: (f: Funcao) => void }) {
  return (
    <Campo rotulo="Função" ajuda={valor === 'proprietario' ? 'Acesso total, incluindo contas e definições. Tem todas as filiais.' : valor === 'gestor' ? 'Gestão de stock, compras e relatórios (nas próximas etapas).' : 'Balcão e caixa (nas próximas etapas).'}>
      {(p) => (
        <select {...p} value={valor} onChange={(e) => aoMudar(e.target.value as Funcao)}>
          <option value="operador">Operador</option>
          <option value="gestor">Gestor</option>
          <option value="proprietario">Proprietário</option>
        </select>
      )}
    </Campo>
  )
}

export function NovoFuncionario() {
  const s = useSessaoActiva()
  const [v, setV] = useState({ nome: '', nomeUtilizador: '', funcao: 'operador' as Funcao, filiais: s.filiais.length === 1 ? [s.filiais[0].id] : ([] as string[]), codigo: '', confirmacao: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [criada, setCriada] = useState<ContaUtilizador | null>(null)
  const [aEnviar, setAEnviar] = useState(false)

  async function submeter(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!v.nome.trim()) n.nome = 'Indique o nome.'
    if (!REGRA_NOME_UTILIZADOR.test(v.nomeUtilizador.trim().toLowerCase())) n.nomeUtilizador = '3 a 32 caracteres: letras, algarismos, ponto, hífen e sublinhado.'
    if (v.funcao !== 'proprietario' && v.filiais.length === 0) n.filiais = 'Escolha pelo menos uma filial.'
    const p = problemaCodigo(v.codigo)
    if (p) n.codigoSecreto = p
    else if (v.codigo !== v.confirmacao) n.confirmacao = 'Os dois códigos não coincidem.'
    setErros(n)
    setErro(null)
    if (Object.keys(n).length) return
    setAEnviar(true)
    try {
      setCriada(await criarUtilizador({ nome: v.nome.trim(), nomeUtilizador: v.nomeUtilizador.trim().toLowerCase(), funcao: v.funcao, filiais: v.funcao === 'proprietario' ? [] : v.filiais, codigoSecreto: v.codigo }))
      setV((a) => ({ ...a, codigo: '', confirmacao: '' }))
    } catch (falha) {
      const campos = errosDeCampos(falha)
      if (falha instanceof ErroApi && falha.codigo === 'nome_utilizador_indisponivel') campos.nomeUtilizador = falha.message
      setErros(campos)
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  if (criada) {
    return (
      <>
        <CabecalhoPagina titulo="Conta criada" />
        <Aviso tom="sucesso" titulo={`${criada.nome} pode entrar`}>
          <ul>
            <li>
              Código da empresa: <code>{s.empresa.codigo}</code>
            </li>
            <li>
              Nome de utilizador: <code>{criada.nomeUtilizador}</code>
            </li>
            <li>Código secreto: o que combinou. O Nexo não o volta a mostrar.</li>
          </ul>
        </Aviso>
        <div className="linha-accoes">
          <a href="#/funcionarios">Voltar à lista</a>
          <Botao variante="secundario" onClick={() => setCriada(null)}>
            Criar outra conta
          </Botao>
        </div>
      </>
    )
  }

  return (
    <>
      <CabecalhoPagina titulo="Nova conta" descricao="O funcionário entra com o código da empresa, este nome de utilizador e o código secreto que definir aqui." />
      <form className="formulario" onSubmit={submeter} noValidate>
        <Cartao>
          <div className="grelha-formulario">
            <CampoTexto rotulo="Nome" valor={v.nome} aoMudar={(x) => setV({ ...v, nome: x })} erro={erros.nome} autoComplete="off" />
            <CampoTexto rotulo="Nome de utilizador" valor={v.nomeUtilizador} aoMudar={(x) => setV({ ...v, nomeUtilizador: x })} erro={erros.nomeUtilizador} autoComplete="off" autoCapitalize="off" spellCheck={false} ajuda="Pode repetir-se noutras empresas; aqui é único." />
            <SeleccaoFuncao valor={v.funcao} aoMudar={(f) => setV({ ...v, funcao: f })} />
            {v.funcao !== 'proprietario' ? <SeleccaoFiliais filiais={s.filiais} valor={v.filiais} aoMudar={(f) => setV({ ...v, filiais: f })} erro={erros.filiais} /> : <span />}
            <CampoCodigo rotulo="Código secreto" valor={v.codigo} aoMudar={(x) => setV({ ...v, codigo: x })} erro={erros.codigoSecreto} autoComplete="new-password" ajuda="Pelo menos 8 caracteres; não é um PIN." />
            <CampoCodigo rotulo="Repetir o código secreto" valor={v.confirmacao} aoMudar={(x) => setV({ ...v, confirmacao: x })} erro={erros.confirmacao} autoComplete="new-password" />
          </div>
        </Cartao>
        {v.funcao === 'proprietario' && (
          <Aviso tom="aviso">
            Um proprietário tem acesso total. Depois de entrar, deve mudar o código e registar o seu e-mail de recuperação: o código de um proprietário não se
            redefine por aqui.
          </Aviso>
        )}
        <Aviso tom="info">
          Combine o código com a pessoa directamente. Os registos identificam a <strong>conta</strong> usada; como o proprietário conhece o código que definiu,
          não provam qual pessoa o introduziu.
        </Aviso>
        <ErroFormulario erro={erro} />
        <div className="linha-accoes">
          <a href="#/funcionarios">Cancelar</a>
          <Botao type="submit" disabled={aEnviar}>
            {aEnviar ? 'A criar…' : 'Criar conta'}
          </Botao>
        </div>
      </form>
    </>
  )
}

export function FichaFuncionario({ id }: { id: string }) {
  const s = useSessaoActiva()
  const carregar = useCallback((sinal: AbortSignal) => obterUtilizador(id, sinal), [id])
  const [estado, repetir] = useRecurso(carregar)
  // A mensagem fica aqui: a ficha é recriada quando a conta é lida de novo depois de uma alteração.
  const [mensagem, setMensagem] = useState<string | null>(null)
  if (estado.tipo === 'a_carregar') return <Carregando texto="A carregar a conta…" />
  if (estado.tipo === 'erro') return <EstadoErro erro={estado.erro} aoRepetir={repetir} titulo="Conta indisponível" />
  return <FichaCarregada conta={estado.dados} propria={estado.dados.id === s.utilizador.id} filiais={s.filiais} aoMudar={repetir} mensagem={mensagem} setMensagem={setMensagem} />
}

function FichaCarregada({
  conta,
  propria,
  filiais,
  aoMudar,
  mensagem,
  setMensagem,
}: {
  conta: ContaUtilizador
  propria: boolean
  filiais: Filial[]
  aoMudar: () => void
  mensagem: string | null
  setMensagem: (m: string | null) => void
}) {
  const [perfil, setPerfil] = useState({ nome: conta.nome, funcao: conta.funcao, filiais: conta.filiais })
  const [codigo, setCodigo] = useState({ novo: '', confirmacao: '' })
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<unknown>(null)
  const [aEnviar, setAEnviar] = useState(false)

  async function executar(accao: () => Promise<unknown>, sucesso: string) {
    setErro(null)
    setMensagem(null)
    setAEnviar(true)
    try {
      await accao()
      setMensagem(sucesso)
      aoMudar()
    } catch (falha) {
      setErros(errosDeCampos(falha))
      setErro(falha)
    } finally {
      setAEnviar(false)
    }
  }

  async function guardarPerfil(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    if (!perfil.nome.trim()) n.nome = 'Indique o nome.'
    if (perfil.funcao !== 'proprietario' && perfil.filiais.length === 0) n.filiais = 'Escolha pelo menos uma filial.'
    setErros(n)
    if (Object.keys(n).length) return
    await executar(() => alterarUtilizador(conta.id, { nome: perfil.nome.trim(), funcao: perfil.funcao, filiais: perfil.funcao === 'proprietario' ? [] : perfil.filiais }), 'Alterações guardadas.')
  }

  async function guardarCodigo(e: FormEvent) {
    e.preventDefault()
    const n: Record<string, string> = {}
    const p = problemaCodigo(codigo.novo)
    if (p) n.codigoSecreto = p
    else if (codigo.novo !== codigo.confirmacao) n.confirmacao = 'Os dois códigos não coincidem.'
    setErros(n)
    if (Object.keys(n).length) return
    await executar(async () => {
      await definirCodigo(conta.id, codigo.novo)
      setCodigo({ novo: '', confirmacao: '' })
    }, 'Código redefinido. As sessões abertas desta conta terminaram.')
  }

  return (
    <>
      <CabecalhoPagina
        titulo={conta.nome}
        descricao={`${NOMES_FUNCAO[conta.funcao]} · utilizador ${conta.nomeUtilizador} · criada em ${formatarDataHora(conta.criadoEm)}`}
        accoes={<a href="#/funcionarios">Voltar à lista</a>}
      />
      {conta.estado === 'desactivado' && (
        <Aviso tom="aviso" titulo="Conta desactivada">
          Desactivada em {conta.desactivadoEm ? formatarDataHora(conta.desactivadoEm) : '—'}. Não consegue entrar e as sessões que tinha terminaram.
        </Aviso>
      )}
      {mensagem && <Aviso tom="sucesso">{mensagem}</Aviso>}
      <ErroFormulario erro={erro} />
      {propria ? (
        <Aviso tom="info">
          É a sua conta: a função, as filiais e o estado só podem ser alterados por outro proprietário. Para mudar o seu código, use{' '}
          <a href="#/meu-acesso">O meu acesso</a>.
        </Aviso>
      ) : (
        <>
          <form className="formulario" onSubmit={guardarPerfil} noValidate>
            <Cartao titulo="Perfil">
              <div className="grelha-formulario">
                <CampoTexto rotulo="Nome" valor={perfil.nome} aoMudar={(x) => setPerfil({ ...perfil, nome: x })} erro={erros.nome} />
                <SeleccaoFuncao valor={perfil.funcao} aoMudar={(f) => setPerfil({ ...perfil, funcao: f })} />
                {perfil.funcao !== 'proprietario' && <SeleccaoFiliais filiais={filiais} valor={perfil.filiais} aoMudar={(f) => setPerfil({ ...perfil, filiais: f })} erro={erros.filiais} />}
              </div>
              <div className="linha-accoes">
                <Botao type="submit" disabled={aEnviar}>
                  Guardar alterações
                </Botao>
              </div>
            </Cartao>
          </form>
          {conta.funcao !== 'proprietario' ? (
            <form className="formulario" onSubmit={guardarCodigo} noValidate>
              <Cartao titulo="Novo código secreto">
                <p className="texto-secundario">O código anterior não pode ser consultado. Ao guardar, deixa de funcionar e as sessões abertas desta conta terminam.</p>
                <div className="grelha-formulario">
                  <CampoCodigo rotulo="Código novo" valor={codigo.novo} aoMudar={(x) => setCodigo({ ...codigo, novo: x })} erro={erros.codigoSecreto} autoComplete="new-password" />
                  <CampoCodigo rotulo="Repetir o código novo" valor={codigo.confirmacao} aoMudar={(x) => setCodigo({ ...codigo, confirmacao: x })} erro={erros.confirmacao} autoComplete="new-password" />
                </div>
                <div className="linha-accoes">
                  <Botao type="submit" variante="secundario" disabled={aEnviar}>
                    Definir novo código
                  </Botao>
                </div>
              </Cartao>
            </form>
          ) : (
            <Aviso tom="info">O código de um proprietário recupera-se pelo e-mail de recuperação confirmado, ou com o suporte.</Aviso>
          )}
          <Cartao titulo="Acesso">
            {conta.estado === 'activo' ? (
              <Botao
                variante="perigo"
                disabled={aEnviar}
                onClick={() => {
                  if (window.confirm(`Desactivar a conta de ${conta.nome}? As sessões abertas terminam e deixa de conseguir entrar.`)) {
                    void executar(() => desactivarUtilizador(conta.id), 'Conta desactivada.')
                  }
                }}
              >
                Desactivar conta
              </Botao>
            ) : (
              <Botao variante="secundario" disabled={aEnviar} onClick={() => void executar(() => reactivarUtilizador(conta.id), 'Conta reactivada. As sessões antigas continuam terminadas.')}>
                Reactivar conta
              </Botao>
            )}
            <p className="nota">As contas nunca são apagadas: ficam desactivadas, e o histórico mantém-se.</p>
          </Cartao>
        </>
      )}
    </>
  )
}
