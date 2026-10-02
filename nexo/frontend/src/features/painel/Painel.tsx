import { useState } from 'react'
import { Aviso, Botao, CabecalhoPagina, Cartao, EstadoVazio, Etiqueta, Indicador, MarcaDemo } from '../../components/ui'
import { useDemo } from '../../demo/contexto'
import { custoDaVenda, esperadoCaixa, podeGerir, sessaoAberta } from '../../demo/regras'
import { chaveDia } from '../../lib/datas'
import { formatarMzn, formatarQuantidade } from '../../lib/dinheiro'
import { navegar } from '../../app/rotas'

export function Painel() {
  const { estado, utilizador } = useDemo()
  const [hoje] = useState(() => chaveDia(new Date().toISOString()))
  const vendasHoje = estado.vendas.filter(
    (v) => v.estado === 'concluida' && chaveDia(v.dataHora) === hoje && (podeGerir(utilizador) || v.autorId === utilizador?.id),
  )
  const totalHoje = vendasHoje.reduce((s, v) => s + v.totalCentavos, 0)
  const margemHoje = vendasHoje.reduce((s, v) => s + v.totalCentavos - custoDaVenda(v), 0)
  const sessao = sessaoAberta(estado)
  const stockBaixo = estado.produtos.filter((p) => p.activo && p.stockMinimo > 0 && p.stock <= p.stockMinimo)
  const pendentes = estado.operacoes.filter((o) => o.estado === 'pendente').length
  const conflitos = estado.operacoes.filter((o) => o.estado === 'conflito').length

  return (
    <>
      <CabecalhoPagina
        titulo={`Olá, ${utilizador?.nome.split(' ')[0] ?? ''}`}
        descricao="Resumo do dia neste dispositivo."
        accoes={<Botao onClick={() => navegar('balcao')}>Nova venda</Botao>}
      />
      {conflitos > 0 && (
        <Aviso tom="perigo" titulo="Há operações em conflito">
          {conflitos} operação(ões) precisam de decisão do gestor. <a href="#/sincronizacao">Ver sincronização</a>
        </Aviso>
      )}
      <div className="grelha-indicadores">
        <Indicador
          rotulo={podeGerir(utilizador) ? 'Vendas de hoje' : 'As minhas vendas de hoje'}
          valor={formatarMzn(totalHoje)}
          detalhe={`${vendasHoje.length} venda(s)`}
        />
        {podeGerir(utilizador) && (
          <Indicador rotulo="Margem estimada de hoje" valor={formatarMzn(margemHoje)} detalhe="Custos fictícios" />
        )}
        {/* O operador não vê o numerário esperado antes de contar (contagem cega, proposta H-15, matriz B.5). */}
        <Indicador
          rotulo="Caixa"
          valor={sessao ? (podeGerir(utilizador) ? formatarMzn(esperadoCaixa(estado, sessao.id)) : 'Aberta') : 'Fechada'}
          detalhe={
            sessao
              ? podeGerir(utilizador)
                ? 'Numerário esperado'
                : 'O esperado aparece no fecho, depois da contagem'
              : 'Abra a caixa para vender'
          }
          tom={sessao ? undefined : 'aviso'}
        />
        <Indicador
          rotulo="Sincronização"
          valor={`${pendentes} pendente(s)`}
          detalhe={estado.simulacao.ligacao === 'online' ? 'Online (simulado)' : 'Offline (simulado)'}
          tom={pendentes > 0 ? 'aviso' : undefined}
        />
      </div>
      <p className="nota">
        <MarcaDemo /> Os indicadores são calculados sobre dados fictícios, neste navegador.
      </p>
      <div className="grelha-2">
        <Cartao titulo="Stock baixo" accao={<a href="#/produtos">Ver produtos</a>}>
          {stockBaixo.length === 0 ? (
            <EstadoVazio titulo="Nenhum produto abaixo do mínimo" />
          ) : (
            <ul className="lista-simples">
              {stockBaixo.map((p) => (
                <li key={p.id}>
                  <span>{p.nome}</span>
                  <Etiqueta tom={p.stock <= 0 ? 'perigo' : 'aviso'}>
                    {formatarQuantidade(p.stock, p.unidade)} / mín. {p.stockMinimo}
                  </Etiqueta>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Últimas vendas" accao={<a href="#/vendas">Histórico</a>}>
          {vendasHoje.length === 0 ? (
            <EstadoVazio titulo="Ainda não há vendas hoje" accao={<a href="#/balcao">Ir para o balcão</a>} />
          ) : (
            <ul className="lista-simples">
              {vendasHoje
                .slice(-5)
                .reverse()
                .map((v) => (
                  <li key={v.id}>
                    <a href={`#/vendas/${v.id}`}>{v.numero}</a>
                    <strong>{formatarMzn(v.totalCentavos)}</strong>
                  </li>
                ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  )
}
