// Moldura da aplicação real: empresa, conta, menu por função e saída. O menu esconde o que a função
// não usa, mas isso não autoriza nada: a API verifica cada pedido.

import { useState, type ReactNode } from 'react'
import { Botao } from '../components/ui'
import { NOMES_FUNCAO, type Funcao } from '../servicos/autenticacao'
import { useSessao, useSessaoActiva } from './useSessao'

interface ItemMenu {
  rota: string
  rotulo: string
  funcoes?: Funcao[]
}

const MENU_REAL: ItemMenu[] = [
  { rota: 'inicio', rotulo: 'Início' },
  { rota: 'funcionarios', rotulo: 'Funcionários', funcoes: ['proprietario'] },
  { rota: 'empresa', rotulo: 'Empresa e filial' },
  { rota: 'meu-acesso', rotulo: 'O meu acesso' },
  { rota: 'auditoria', rotulo: 'Auditoria', funcoes: ['proprietario'] },
  { rota: 'sistema', rotulo: 'Estado do sistema' },
]

export function ShellReal({ rotaActual, children }: { rotaActual: string; children: ReactNode }) {
  const s = useSessaoActiva()
  const { sair } = useSessao()
  const [menuAberto, setMenuAberto] = useState(false)
  const [aSair, setASair] = useState(false)
  const itens = MENU_REAL.filter((i) => !i.funcoes || i.funcoes.includes(s.utilizador.funcao))

  return (
    <div className="app app-real">
      <header className="topo">
        <button type="button" className="botao-menu" aria-expanded={menuAberto} aria-controls="menu-principal" onClick={() => setMenuAberto((v) => !v)}>
          Menu
        </button>
        <div className="topo-marca">
          <span className="marca">Nexo</span>
          <span className="topo-empresa">
            {s.empresa.nome}
            {s.filialActual ? ` · ${s.filialActual.codigo} ${s.filialActual.nome}` : ''}
          </span>
        </div>
        <div className="topo-estado topo-utilizador">
          <span>
            <strong>{s.utilizador.nome}</strong> <small>{NOMES_FUNCAO[s.utilizador.funcao]}</small>
          </span>
          <Botao
            variante="secundario"
            disabled={aSair}
            onClick={() => {
              setASair(true)
              void sair().finally(() => {
                window.location.hash = '#/entrar'
              })
            }}
          >
            {aSair ? 'A sair…' : 'Sair'}
          </Botao>
        </div>
      </header>
      <div className="corpo">
        <nav id="menu-principal" className={`menu ${menuAberto ? 'menu-aberto' : ''}`} aria-label="Principal">
          <ul>
            {itens.map((item) => (
              <li key={item.rota}>
                <a
                  href={`#/${item.rota}`}
                  className={rotaActual === item.rota ? 'activo' : ''}
                  aria-current={rotaActual === item.rota ? 'page' : undefined}
                  onClick={() => setMenuAberto(false)}
                >
                  {item.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="conteudo" id="conteudo">
          {children}
        </main>
      </div>
    </div>
  )
}
