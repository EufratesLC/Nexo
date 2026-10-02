import { useState } from 'react'
import { CabecalhoPagina, Campo, EstadoVazio, Etiqueta, EtiquetaSync, Tabela } from '../../components/ui'
import { useDemo } from '../../demo/contexto'
import { NOMES_METODO, podeGerir } from '../../demo/regras'
import { chaveDia, formatarDataHora } from '../../lib/datas'
import { formatarMzn } from '../../lib/dinheiro'

export function Historico() {
  const { estado, utilizador } = useDemo()
  const [filtroSync, setFiltroSync] = useState('')
  const [pesquisa, setPesquisa] = useState('')
  const gestor = podeGerir(utilizador)
  const [hoje] = useState(() => chaveDia(new Date().toISOString()))
  const syncDe = (vendaId: string) => estado.operacoes.find((o) => o.tipo === 'venda' && o.referenciaId === vendaId)?.estado

  const vendas = estado.vendas
    .filter((v) => gestor || (v.autorId === utilizador?.id && chaveDia(v.dataHora) === hoje))
    .filter((v) => filtroSync === '' || syncDe(v.id) === filtroSync)
    .filter((v) => pesquisa.trim() === '' || v.numero.toLowerCase().includes(pesquisa.trim().toLowerCase()))
    .slice()
    .reverse()

  return (
    <>
      <CabecalhoPagina
        titulo="Vendas"
        descricao={gestor ? 'Histórico de vendas da filial.' : 'As suas vendas de hoje (matriz B.4).'}
      />
      <div className="filtros">
        <Campo rotulo="N.º do comprovativo">
          {(p) => <input {...p} type="search" placeholder="F01-C01-…" value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} />}
        </Campo>
        <Campo rotulo="Estado de sincronização">
          {(p) => (
            <select {...p} value={filtroSync} onChange={(e) => setFiltroSync(e.target.value)}>
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="confirmado">Confirmado</option>
              <option value="conflito">Conflito</option>
            </select>
          )}
        </Campo>
      </div>
      {vendas.length === 0 ? (
        <EstadoVazio titulo="Nenhuma venda encontrada" accao={<a href="#/balcao">Ir para o balcão</a>} />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <th>Comprovativo</th>
              <th>Data</th>
              <th>Pagamento</th>
              <th className="num">Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {vendas.map((v) => (
              <tr key={v.id}>
                <td>
                  <a href={`#/vendas/${v.id}`}>{v.numero}</a>
                </td>
                <td>{formatarDataHora(v.dataHora)}</td>
                <td>{v.pagamentos.map((p) => NOMES_METODO[p.metodo]).join(' + ')}</td>
                <td className="num">{formatarMzn(v.totalCentavos)}</td>
                <td className="celula-etiquetas">
                  {v.estado === 'cancelada' && <Etiqueta tom="perigo">Cancelada</Etiqueta>}
                  <EtiquetaSync estado={syncDe(v.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </>
  )
}
