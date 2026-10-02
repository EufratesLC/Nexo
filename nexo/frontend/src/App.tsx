import './App.css'
import { useEffect } from 'react'
import { useRota, navegar } from './app/rotas'
import { MENU } from './app/menu'
import { Shell } from './app/Shell'
import { EstadoVazio } from './components/ui'
import { DemoProvider } from './demo/DemoProvider'
import { useDemo } from './demo/contexto'
import { podeGerir } from './demo/regras'
import { Login } from './features/auth/Login'
import { Caixa } from './features/caixa/Caixa'
import { Compras } from './features/compras/Compras'
import { DetalheCompra } from './features/compras/DetalheCompra'
import { FormularioCompra } from './features/compras/FormularioCompra'
import { Fornecedores } from './features/compras/Fornecedores'
import { Despesas } from './features/despesas/Despesas'
import { Painel } from './features/painel/Painel'
import { FormularioProduto } from './features/produtos/FormularioProduto'
import { ListaProdutos } from './features/produtos/ListaProdutos'
import { Relatorios } from './features/relatorios/Relatorios'
import { Sincronizacao } from './features/sincronizacao/Sincronizacao'
import { Balcao } from './features/vendas/Balcao'
import { DetalheVenda } from './features/vendas/DetalheVenda'
import { Historico } from './features/vendas/Historico'

function Ecra({ rota }: { rota: string[] }) {
  const { utilizador } = useDemo()
  const [modulo, id] = rota
  const itemMenu = MENU.find((i) => i.rota === modulo)
  if (itemMenu?.gestao && !podeGerir(utilizador)) {
    return (
      <EstadoVazio titulo="Sem permissão">
        A função {utilizador?.papel === 'operador' ? 'Operador' : ''} não tem acesso a este módulo (matriz B).
      </EstadoVazio>
    )
  }
  switch (modulo) {
    case 'painel':
      return <Painel />
    case 'balcao':
      return <Balcao />
    case 'vendas':
      return id ? <DetalheVenda vendaId={id} /> : <Historico />
    case 'caixa':
      return <Caixa />
    case 'produtos':
      return id ? <FormularioProduto produtoId={id === 'novo' ? undefined : id} /> : <ListaProdutos />
    case 'compras':
      if (id === 'nova') return <FormularioCompra />
      if (id === 'fornecedores') return <Fornecedores />
      return id ? <DetalheCompra compraId={id} /> : <Compras />
    case 'despesas':
      return <Despesas />
    case 'relatorios':
      return <Relatorios />
    case 'sincronizacao':
      return <Sincronizacao />
    default:
      return (
        <EstadoVazio titulo="Página não encontrada" accao={<a href="#/painel">Ir para o painel</a>}>
          O endereço não corresponde a nenhum ecrã do protótipo.
        </EstadoVazio>
      )
  }
}

function Encaminhador() {
  const rota = useRota()
  const { utilizador } = useDemo()
  const semSessao = !utilizador

  useEffect(() => {
    if (semSessao && rota[0] !== 'login') navegar('login')
    else if (!semSessao && (rota.length === 0 || rota[0] === 'login')) navegar('painel')
  }, [semSessao, rota])

  if (semSessao) return <Login />
  return (
    <Shell rotaActual={rota[0] ?? ''}>
      <Ecra rota={rota} />
    </Shell>
  )
}

function App() {
  return (
    <DemoProvider>
      <Encaminhador />
    </DemoProvider>
  )
}

export default App
