import { useDemo } from '../../demo/contexto'
import { NOMES_METODO } from '../../demo/regras'
import type { EstadoSync, Venda } from '../../demo/tipos'
import { formatarDataHora } from '../../lib/datas'
import { formatarMzn, formatarQuantidade } from '../../lib/dinheiro'

/** Comprovativo interno (D.14). Nunca se chama factura. */
export function Comprovativo({ venda, estadoSync }: { venda: Venda; estadoSync?: EstadoSync }) {
  const { estado } = useDemo()
  const vendedor = estado.utilizadores.find((u) => u.id === venda.autorId)
  return (
    <article className="comprovativo" aria-label="Comprovativo de venda">
      <header>
        <strong>{estado.empresa.nome}</strong>
        <div>{estado.empresa.filial}</div>
        <h2>Comprovativo de venda</h2>
        <p className="comprovativo-aviso">Documento interno · Este documento não é uma factura.</p>
      </header>
      <dl className="comprovativo-dados">
        <div>
          <dt>N.º</dt>
          <dd>{venda.numero}</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd>{formatarDataHora(venda.dataHora)}</dd>
        </div>
        <div>
          <dt>Vendedor</dt>
          <dd>{vendedor?.nome}</dd>
        </div>
      </dl>
      <table>
        <tbody>
          {venda.linhas.map((l) => (
            <tr key={l.produtoId}>
              <td>
                {l.nome}
                <div className="texto-secundario">
                  {formatarQuantidade(l.quantidade, l.unidade)} × {formatarMzn(l.precoCentavos)}
                </div>
              </td>
              <td className="num">{formatarMzn(l.valorCentavos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="totais">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatarMzn(venda.subtotalCentavos)}</dd>
        </div>
        {venda.descontoCentavos > 0 && (
          <div>
            <dt>Desconto</dt>
            <dd>−{formatarMzn(venda.descontoCentavos)}</dd>
          </div>
        )}
        <div className="totais-total">
          <dt>Total</dt>
          <dd>{formatarMzn(venda.totalCentavos)}</dd>
        </div>
        {venda.pagamentos.map((p, i) => (
          <div key={i}>
            <dt>{NOMES_METODO[p.metodo]}</dt>
            <dd>{formatarMzn(p.entregueCentavos ?? p.valorCentavos)}</dd>
          </div>
        ))}
        {venda.pagamentos.some((p) => p.trocoCentavos) && (
          <div>
            <dt>Troco</dt>
            <dd>{formatarMzn(venda.pagamentos.reduce((s, p) => s + (p.trocoCentavos ?? 0), 0))}</dd>
          </div>
        )}
      </dl>
      {venda.estado === 'cancelada' && <p className="comprovativo-estado">VENDA CANCELADA</p>}
      {estadoSync === 'pendente' && <p className="comprovativo-estado">Pendente de sincronização</p>}
      <footer>Documento interno · Este documento não é uma factura.</footer>
    </article>
  )
}
