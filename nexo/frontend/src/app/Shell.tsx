import { useState, type ReactNode } from 'react'
import { Botao } from '../components/ui'
import { definirLigacao, sair } from '../demo/accoes'
import { useDemo } from '../demo/contexto'
import { NOMES_PAPEL, podeGerir, sessaoAberta } from '../demo/regras'
import { formatarHora } from '../lib/datas'
import { MENU } from './menu'
import { navegar } from './rotas'

export function Shell({ rotaActual, children }: { rotaActual: string; children: ReactNode }) {
  const { estado, utilizador, executar, repor } = useDemo()
  const [menuAberto, setMenuAberto] = useState(false)
  const pendentes = estado.operacoes.filter((o) => o.estado === 'pendente').length
  const conflitos = estado.operacoes.filter((o) => o.estado === 'conflito').length
  const online = estado.simulacao.ligacao === 'online'
  const sessao = sessaoAberta(estado)
  const itens = MENU.filter((i) => !i.gestao || podeGerir(utilizador))

  return (
    <div className="app">
      <div className="faixa-demo" role="note">
        Protótipo com dados fictícios. Sem servidor, sem autenticação real e sem sincronização real.
      </div>
      <header className="topo">
        <button
          type="button"
          className="botao-menu"
          aria-expanded={menuAberto}
          aria-controls="menu-principal"
          onClick={() => setMenuAberto((v) => !v)}
        >
          Menu
        </button>
        <div className="topo-marca">
          <span className="marca">Nexo</span>
          <span className="topo-empresa">
            {estado.empresa.nome} · {estado.empresa.dispositivo} ({estado.empresa.codigoDispositivo})
          </span>
        </div>
        <div className="topo-estado">
          <div className="simulacao-ligacao" role="group" aria-label="Simulação da ligação">
            <span className="simulacao-rotulo">Simulação</span>
            <button
              type="button"
              className={online ? 'activo' : ''}
              aria-pressed={online}
              onClick={() => executar((e) => definirLigacao(e, 'online'))}
            >
              Online
            </button>
            <button
              type="button"
              className={!online ? 'activo offline' : ''}
              aria-pressed={!online}
              onClick={() => executar((e) => definirLigacao(e, 'offline'))}
            >
              Offline
            </button>
          </div>
          <a className="topo-sync" href="#/sincronizacao">
            <span className={pendentes ? 'ponto ponto-aviso' : 'ponto ponto-ok'} aria-hidden="true" />
            {pendentes} pendente{pendentes === 1 ? '' : 's'}
            {conflitos > 0 && <strong className="texto-perigo"> · {conflitos} conflito{conflitos === 1 ? '' : 's'}</strong>}
            <span className="topo-contacto">Último contacto {formatarHora(estado.simulacao.ultimoContacto)}</span>
          </a>
        </div>
      </header>
      {estado.simulacao.pausaContagem === 'em_pausa' && (
        <div className="faixa-pausa" role="status">
          Vendas em pausa: contagem física em curso (simulada). O dispositivo retoma quando receber o aviso do servidor.
        </div>
      )}
      <div className="corpo">
        <nav id="menu-principal" className={`menu ${menuAberto ? 'menu-aberto' : ''}`} aria-label="Principal">
          <ul>
            {itens.map((item, i) => (
              <li key={item.rota} className={item.area === 'sistema' && itens[i - 1]?.area !== 'sistema' ? 'menu-separado' : undefined}>
                {item.area === 'sistema' && itens[i - 1]?.area !== 'sistema' && <span className="menu-grupo">Infraestrutura real</span>}
                <a
                  href={`#/${item.rota}`}
                  className={rotaActual === item.rota ? 'activo' : ''}
                  aria-current={rotaActual === item.rota ? 'page' : undefined}
                  onClick={() => setMenuAberto(false)}
                >
                  {item.rotulo}
                  {item.rota === 'caixa' && (
                    <span className={`menu-marca ${sessao ? 'menu-marca-ok' : ''}`}>{sessao ? 'aberta' : 'fechada'}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
          <div className="menu-utilizador">
            <span>{utilizador?.nome}</span>
            <small>{utilizador ? NOMES_PAPEL[utilizador.papel] : ''}</small>
            <div className="linha-accoes">
              <Botao
                variante="discreto"
                onClick={() => {
                  executar(sair)
                  navegar('login')
                }}
              >
                Sair
              </Botao>
              <Botao
                variante="discreto"
                onClick={() => {
                  if (window.confirm('Repor os dados fictícios? Perde as vendas e alterações desta demonstração.')) {
                    repor()
                    navegar('login')
                  }
                }}
              >
                Repor dados
              </Botao>
            </div>
          </div>
        </nav>
        <main className="conteudo" id="conteudo">
          {children}
        </main>
      </div>
    </div>
  )
}
