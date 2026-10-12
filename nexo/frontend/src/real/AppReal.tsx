// Aplicação real (VITE_NEXO_MODO=api, Etapa 3): autenticação online, empresa, filial, funcionários,
// o meu acesso e auditoria. Sem dados fictícios e sem módulos comerciais (vendas, stock e
// relatórios reais chegam nas etapas seguintes). A demonstração (Etapa 1) é outra árvore (App.tsx).

import { useEffect, type ReactNode } from 'react'
import { Carregando, EstadoErro } from '../components/estados'
import { EstadoVazio } from '../components/ui'
import { EstadoSistema } from '../features/sistema/EstadoSistema'
import { AcessoNegado } from './componentes'
import { Auditoria } from './ecras/Auditoria'
import { CriarEmpresa } from './ecras/CriarEmpresa'
import { EmpresaFilial } from './ecras/Empresa'
import { Entrar } from './ecras/Entrar'
import { FichaFuncionario, ListaFuncionarios, NovoFuncionario } from './ecras/Funcionarios'
import { Inicio } from './ecras/Inicio'
import { MeuAcesso } from './ecras/MeuAcesso'
import { ConfirmarEmail, DefinirNovoCodigo, PedirRecuperacao } from './ecras/Recuperacao'
import { RegistoPendente } from './ecras/RegistoPendente'
import { useRotaReal } from './rotas'
import { SessaoProvider } from './sessao'
import { useSessao } from './useSessao'
import { ShellReal } from './ShellReal'

const PUBLICAS = new Set(['entrar', 'criar-empresa', 'registo-pendente', 'recuperar', 'recuperar-acesso', 'confirmar-email', 'sistema'])

function Encaminhador() {
  const { estado, actualizar } = useSessao()
  const { caminho, parametros } = useRotaReal()
  const [modulo = '', id] = caminho
  const comSessao = estado.tipo === 'com_sessao'

  // Sem sessão, os ecrãs protegidos levam ao login; com sessão, o login leva ao início.
  useEffect(() => {
    if (estado.tipo === 'sem_sessao' && !PUBLICAS.has(modulo)) window.location.hash = '#/entrar'
    else if (comSessao && (modulo === '' || modulo === 'entrar' || modulo === 'criar-empresa' || modulo === 'registo-pendente')) window.location.hash = '#/inicio'
  }, [estado.tipo, comSessao, modulo])

  if (estado.tipo === 'a_verificar') return <Carregando texto="A verificar a sessão…" />
  if (estado.tipo === 'erro') {
    return (
      <main className="login login-real">
        <div className="login-caixa">
          <span className="marca marca-grande">Nexo</span>
          <EstadoErro erro={estado.erro} titulo="Não foi possível contactar o servidor" aoRepetir={() => void actualizar()} />
          <a href="#/sistema">Estado do sistema</a>
        </div>
      </main>
    )
  }

  // Ecrãs públicos (também acessíveis com sessão: confirmar e-mail, estado do sistema).
  // A chave é o token: abrir outro link no mesmo separador recria o ecrã (senão ficaria com o token anterior).
  const chaveLink = parametros.get('token') ?? 'sem-token'
  if (modulo === 'confirmar-email') return <ConfirmarEmail key={chaveLink} parametros={parametros} comSessao={comSessao} aoConfirmar={() => void actualizar()} />
  if (modulo === 'recuperar-acesso') return <DefinirNovoCodigo key={chaveLink} parametros={parametros} />
  if (!comSessao) {
    if (modulo === 'criar-empresa') return <CriarEmpresa />
    if (modulo === 'registo-pendente') return <RegistoPendente parametros={parametros} />
    if (modulo === 'recuperar') return <PedirRecuperacao />
    if (modulo === 'sistema')
      return (
        <div className="modo-api">
          <a href="#/entrar">← Entrar</a>
          <EstadoSistema />
        </div>
      )
    return <Entrar aviso={estado.motivo} />
  }

  const funcao = estado.sessao.utilizador.funcao
  const soDono = (ecra: ReactNode) => (funcao === 'proprietario' ? ecra : <AcessoNegado funcao={funcao} />)
  let ecra: ReactNode
  switch (modulo) {
    case 'inicio':
      ecra = <Inicio />
      break
    case 'funcionarios':
      ecra = soDono(id === 'novo' ? <NovoFuncionario /> : id ? <FichaFuncionario key={id} id={id} /> : <ListaFuncionarios />)
      break
    case 'empresa':
      ecra = <EmpresaFilial />
      break
    case 'meu-acesso':
      ecra = <MeuAcesso />
      break
    case 'auditoria':
      ecra = soDono(<Auditoria />)
      break
    case 'sistema':
      ecra = <EstadoSistema />
      break
    default:
      ecra = (
        <EstadoVazio titulo="Página não encontrada" accao={<a href="#/inicio">Ir para o início</a>}>
          O endereço não corresponde a nenhum ecrã.
        </EstadoVazio>
      )
  }
  return <ShellReal rotaActual={modulo}>{ecra}</ShellReal>
}

export function AppReal() {
  return (
    <SessaoProvider>
      <Encaminhador />
    </SessaoProvider>
  )
}
