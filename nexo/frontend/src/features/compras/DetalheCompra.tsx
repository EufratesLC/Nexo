import { useState } from 'react'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Modal, Tabela } from '../../components/ui'
import { cancelarCompra, receberCompra, registarPagamentoCompra } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { formatarData, formatarDataHora } from '../../lib/datas'
import { formatarMzn, formatarQuantidade, formatarValor, lerMzn } from '../../lib/dinheiro'
import { pagoCompra, totalCompra } from './calculos'
import { EtiquetaCompra, EtiquetaPagamento } from './Compras'

export function DetalheCompra({ compraId }: { compraId: string }) {
  const { estado, executar } = useDemo()
  const [confirmar, setConfirmar] = useState(false)
  const [pagar, setPagar] = useState(false)
  const [valor, setValor] = useState('')
  const [conta, setConta] = useState('Banco')
  const [erro, setErro] = useState<string | null>(null)
  const compra = estado.compras.find((c) => c.id === compraId)
  if (!compra) return <EstadoVazio titulo="Compra não encontrada" accao={<a href="#/compras">Voltar</a>} />

  const total = totalCompra(compra)
  const pago = pagoCompra(compra)
  const fornecedor = estado.fornecedores.find((f) => f.id === compra.fornecedorId)

  return (
    <>
      <CabecalhoPagina
        titulo={`Compra de ${formatarData(compra.data)}`}
        descricao={`${fornecedor?.nome ?? ''}${compra.documento ? ` · ${compra.documento}` : ''}`}
        accoes={
          compra.estado === 'rascunho' && (
            <>
              <Botao variante="secundario" onClick={() => setErro(executar((e) => cancelarCompra(e, compra.id)))}>
                Cancelar compra
              </Botao>
              <Botao onClick={() => setConfirmar(true)}>Confirmar recepção</Botao>
            </>
          )
        }
      />
      {erro && <Aviso tom="perigo">{erro}</Aviso>}
      <div className="linha-accoes">
        <EtiquetaCompra compra={compra} />
        {compra.estado !== 'cancelada' && <EtiquetaPagamento compra={compra} />}
      </div>
      {compra.estado === 'recebida' && (
        <Aviso tom="sucesso" titulo="Recepção confirmada">
          {compra.recebidaEm && formatarDataHora(compra.recebidaEm)} por{' '}
          {estado.utilizadores.find((u) => u.id === compra.recebidaPor)?.nome}. A recepção é imutável: correcções fazem-se
          com ajuste de stock ou correcção de custo (não incluídas no protótipo).
        </Aviso>
      )}
      <Cartao titulo="Linhas">
        <Tabela>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Quantidade</th>
              <th className="num">Custo unitário</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {compra.linhas.map((l) => {
              const p = estado.produtos.find((x) => x.id === l.produtoId)
              return (
                <tr key={l.produtoId}>
                  <td>{p?.nome}</td>
                  <td className="num">{p ? formatarQuantidade(l.quantidade, p.unidade) : l.quantidade}</td>
                  <td className="num">{formatarMzn(l.custoCentavos)}</td>
                  <td className="num">{formatarMzn(Math.round(l.quantidade * l.custoCentavos))}</td>
                </tr>
              )
            })}
          </tbody>
        </Tabela>
        <p>
          Total <strong>{formatarMzn(total)}</strong> · Pago {formatarMzn(pago)} · Em dívida <strong>{formatarMzn(total - pago)}</strong>
        </p>
      </Cartao>
      {compra.estado !== 'cancelada' && (
        <Cartao
          titulo="Pagamentos ao fornecedor"
          accao={
            pago < total && (
              <Botao
                variante="secundario"
                onClick={() => {
                  setValor(formatarValor(total - pago))
                  setPagar(true)
                }}
              >
                Registar pagamento
              </Botao>
            )
          }
        >
          {compra.pagamentos.length === 0 ? (
            <EstadoVazio titulo="Sem pagamentos registados" />
          ) : (
            <ul className="lista-simples">
              {compra.pagamentos.map((p) => (
                <li key={p.id}>
                  <span>
                    {formatarDataHora(p.data)} · {p.conta}
                  </span>
                  <strong>{formatarMzn(p.valorCentavos)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}
      {confirmar && (
        <Modal titulo="Confirmar recepção" aoFechar={() => setConfirmar(false)}>
          <p>
            Isto vai aumentar o stock de {compra.linhas.length} produto(s). A acção não pode ser desfeita, só corrigida com
            ajuste. Uma segunda confirmação não volta a aumentar o stock.
          </p>
          <div className="linha-accoes">
            <Botao variante="secundario" onClick={() => setConfirmar(false)}>
              Voltar
            </Botao>
            <Botao
              onClick={() => {
                setErro(executar((e) => receberCompra(e, compra.id)))
                setConfirmar(false)
              }}
            >
              Confirmar
            </Botao>
          </div>
        </Modal>
      )}
      {pagar && (
        <Modal titulo="Registar pagamento" aoFechar={() => setPagar(false)}>
          <form
            className="formulario"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              const centavos = lerMzn(valor)
              const falha = centavos === null ? 'Valor inválido.' : executar((est) => registarPagamentoCompra(est, compra.id, centavos, conta))
              setErro(falha)
              if (!falha) setPagar(false)
            }}
          >
            <Campo rotulo="Valor (MZN)">
              {(p) => <input {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
            </Campo>
            <Campo rotulo="Conta de origem" ajuda="Pagamentos pelo caixa em numerário registam-se no ecrã Caixa.">
              {(p) => (
                <select {...p} value={conta} onChange={(e) => setConta(e.target.value)}>
                  <option>Banco</option>
                  <option>M-Pesa</option>
                  <option>e-Mola</option>
                </select>
              )}
            </Campo>
            {erro && <Aviso tom="perigo">{erro}</Aviso>}
            <div className="linha-accoes">
              <Botao variante="secundario" onClick={() => setPagar(false)}>
                Cancelar
              </Botao>
              <Botao type="submit">Registar</Botao>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
