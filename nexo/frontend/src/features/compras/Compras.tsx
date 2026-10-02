import { navegar } from '../../app/rotas'
import { Botao, CabecalhoPagina, EstadoVazio, Etiqueta, Tabela } from '../../components/ui'
import { useDemo } from '../../demo/contexto'
import type { Compra } from '../../demo/tipos'
import { formatarData } from '../../lib/datas'
import { formatarMzn } from '../../lib/dinheiro'
import { pagoCompra, totalCompra } from './calculos'

export function EtiquetaCompra({ compra }: { compra: Compra }) {
  if (compra.estado === 'cancelada') return <Etiqueta>Cancelada</Etiqueta>
  if (compra.estado === 'rascunho') return <Etiqueta tom="info">Rascunho</Etiqueta>
  return <Etiqueta tom="sucesso">Recebida</Etiqueta>
}

export function EtiquetaPagamento({ compra }: { compra: Compra }) {
  const total = totalCompra(compra)
  const pago = pagoCompra(compra)
  if (pago === 0) return <Etiqueta tom="aviso">Por pagar</Etiqueta>
  if (pago < total) return <Etiqueta tom="aviso">Parcialmente paga</Etiqueta>
  return <Etiqueta tom="sucesso">Paga</Etiqueta>
}

export function Compras() {
  const { estado } = useDemo()
  const compras = estado.compras.slice().reverse()
  const divida = estado.compras
    .filter((c) => c.estado === 'recebida')
    .reduce((s, c) => s + totalCompra(c) - pagoCompra(c), 0)

  return (
    <>
      <CabecalhoPagina
        titulo="Compras"
        descricao={`Dívida a fornecedores (compras recebidas por pagar): ${formatarMzn(divida)}`}
        accoes={
          <>
            <Botao variante="secundario" onClick={() => navegar('compras/fornecedores')}>
              Fornecedores
            </Botao>
            <Botao onClick={() => navegar('compras/nova')}>Nova compra</Botao>
          </>
        }
      />
      {compras.length === 0 ? (
        <EstadoVazio titulo="Ainda não há compras" accao={<a href="#/compras/nova">Registar a primeira compra</a>} />
      ) : (
        <Tabela>
          <thead>
            <tr>
              <th>Data</th>
              <th>Fornecedor</th>
              <th>Documento</th>
              <th className="num">Total</th>
              <th>Recepção</th>
              <th>Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`#/compras/${c.id}`}>{formatarData(c.data)}</a>
                </td>
                <td>{estado.fornecedores.find((f) => f.id === c.fornecedorId)?.nome}</td>
                <td>{c.documento || '—'}</td>
                <td className="num">{formatarMzn(totalCompra(c))}</td>
                <td>
                  <EtiquetaCompra compra={c} />
                </td>
                <td>{c.estado === 'cancelada' ? '—' : <EtiquetaPagamento compra={c} />}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </>
  )
}
