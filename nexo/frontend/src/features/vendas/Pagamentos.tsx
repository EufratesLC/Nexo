import { useState } from 'react'
import { Aviso, Botao, Campo, Modal } from '../../components/ui'
import { NOMES_METODO } from '../../demo/regras'
import type { MetodoPagamento, Pagamento } from '../../demo/tipos'
import { formatarMzn, formatarValor, lerMzn } from '../../lib/dinheiro'

const METODOS: MetodoPagamento[] = ['numerario', 'mpesa', 'emola', 'mkesh', 'cartao', 'transferencia']

/**
 * Pagamentos registados manualmente (sem integração com serviços de pagamento).
 * Só o numerário admite valor entregue superior, com troco (D.4.7).
 */
export function Pagamentos({
  totalCentavos,
  aoFechar,
  aoConfirmar,
}: {
  totalCentavos: number
  aoFechar: () => void
  aoConfirmar: (pagamentos: Pagamento[]) => void
}) {
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([])
  const pago = pagamentos.reduce((s, p) => s + p.valorCentavos, 0)
  const falta = totalCentavos - pago
  const [metodo, setMetodo] = useState<MetodoPagamento>('numerario')
  const [valorTexto, setValorTexto] = useState(formatarValor(totalCentavos))
  const [referencia, setReferencia] = useState('')
  const [erro, setErro] = useState<string | undefined>()

  const adicionar = () => {
    const valor = lerMzn(valorTexto)
    if (valor === null || valor <= 0) {
      setErro('Indique um valor maior do que zero.')
      return
    }
    let novo: Pagamento
    if (metodo === 'numerario') {
      const aplicado = Math.min(valor, falta)
      novo = { metodo, valorCentavos: aplicado, entregueCentavos: valor, trocoCentavos: valor - aplicado }
    } else {
      if (valor > falta) {
        setErro(`Em ${NOMES_METODO[metodo]} o valor tem de ser exacto (no máximo ${formatarMzn(falta)}).`)
        return
      }
      novo = { metodo, valorCentavos: valor, referencia: referencia.trim() || undefined }
    }
    const lista = [...pagamentos, novo]
    const restante = totalCentavos - lista.reduce((s, p) => s + p.valorCentavos, 0)
    setPagamentos(lista)
    setErro(undefined)
    setReferencia('')
    setValorTexto(formatarValor(Math.max(restante, 0)))
  }

  return (
    <Modal titulo="Pagamento" aoFechar={aoFechar}>
      <dl className="totais">
        <div>
          <dt>Total</dt>
          <dd>{formatarMzn(totalCentavos)}</dd>
        </div>
        <div className={falta === 0 ? 'texto-sucesso' : ''}>
          <dt>Falta pagar</dt>
          <dd>{formatarMzn(falta)}</dd>
        </div>
      </dl>
      {pagamentos.length > 0 && (
        <ul className="lista-simples">
          {pagamentos.map((p, i) => (
            <li key={i}>
              <span>
                {NOMES_METODO[p.metodo]}
                {p.referencia && <span className="texto-secundario"> · ref. {p.referencia}</span>}
                {p.trocoCentavos ? <span className="texto-secundario"> · entregue {formatarMzn(p.entregueCentavos ?? 0)}, troco {formatarMzn(p.trocoCentavos)}</span> : null}
              </span>
              <span>
                <strong>{formatarMzn(p.valorCentavos)}</strong>{' '}
                <button type="button" className="botao-icone" aria-label="Remover pagamento" onClick={() => setPagamentos(pagamentos.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {falta > 0 ? (
        <form
          className="formulario"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            adicionar()
          }}
        >
          <div className="chips" role="radiogroup" aria-label="Método de pagamento">
            {METODOS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={metodo === m}
                className={metodo === m ? 'chip activo' : 'chip'}
                onClick={() => setMetodo(m)}
              >
                {NOMES_METODO[m]}
              </button>
            ))}
          </div>
          <Campo rotulo={metodo === 'numerario' ? 'Valor entregue pelo cliente (MZN)' : 'Valor (MZN)'} erro={erro}>
            {(p) => <input {...p} inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} />}
          </Campo>
          {metodo !== 'numerario' && (
            <Campo rotulo="Referência (opcional)" ajuda="Ex.: código da transacção. Registo manual, sem integração.">
              {(p) => <input {...p} value={referencia} onChange={(e) => setReferencia(e.target.value)} />}
            </Campo>
          )}
          <Botao type="submit" variante="secundario">
            Adicionar pagamento
          </Botao>
        </form>
      ) : (
        <Aviso tom="sucesso">Total coberto.</Aviso>
      )}
      <div className="linha-accoes">
        <Botao variante="secundario" onClick={aoFechar}>
          Voltar ao carrinho
        </Botao>
        <Botao disabled={falta !== 0} onClick={() => aoConfirmar(pagamentos)}>
          Concluir venda
        </Botao>
      </div>
    </Modal>
  )
}
