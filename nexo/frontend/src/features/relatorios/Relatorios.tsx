import { useState } from 'react'
import { Aviso, CabecalhoPagina, Cartao, Etiqueta, Indicador, MarcaDemo, Tabela } from '../../components/ui'
import { useDemo } from '../../demo/contexto'
import { custoDaVenda, NOMES_METODO } from '../../demo/regras'
import { chaveDia, formatarData, formatarHora } from '../../lib/datas'
import { formatarMzn } from '../../lib/dinheiro'
import { pagoCompra, totalCompra } from '../compras/calculos'

type Periodo = 'hoje' | '7dias' | 'tudo'

function inicioPeriodo(periodo: Periodo): string {
  const d = new Date()
  if (periodo === 'hoje') return chaveDia(d.toISOString())
  if (periodo === '7dias') {
    d.setDate(d.getDate() - 6)
    return chaveDia(d.toISOString())
  }
  return '0000-00-00'
}

/**
 * Relatórios de gestão (D.9). Tudo é calculado no navegador sobre dados fictícios;
 * no produto real o cálculo é feito no servidor, só com operações aplicadas.
 */
export function Relatorios() {
  const { estado } = useDemo()
  const [periodo, setPeriodo] = useState<Periodo>('7dias')
  const [calculadoEm] = useState(() => new Date().toISOString())
  const inicio = inicioPeriodo(periodo)
  const noPeriodo = (iso: string) => chaveDia(iso) >= inicio

  const estadoOperacao = (tipo: string, id: string) => estado.operacoes.find((o) => o.tipo === tipo && o.referenciaId === id)?.estado
  const vendasPeriodo = estado.vendas.filter((v) => v.estado === 'concluida' && noPeriodo(v.dataHora))
  const confirmadas = vendasPeriodo.filter((v) => estadoOperacao('venda', v.id) === 'confirmado')
  const pendentesDispositivo = vendasPeriodo.filter((v) => estadoOperacao('venda', v.id) === 'pendente')

  const vendasLiquidas = confirmadas.reduce((s, v) => s + v.totalCentavos, 0)
  const descontos = confirmadas.reduce((s, v) => s + v.descontoCentavos, 0)
  const cmv = confirmadas.reduce((s, v) => s + custoDaVenda(v), 0)
  const margem = vendasLiquidas - cmv
  const despesas = estado.despesas.filter((d) => d.estado === 'activa' && noPeriodo(d.data))
  const totalDespesas = despesas.reduce((s, d) => s + d.valorCentavos, 0)
  const resultado = margem - totalDespesas

  const entradasPorMetodo = new Map<string, number>()
  for (const v of confirmadas) {
    for (const p of v.pagamentos) entradasPorMetodo.set(p.metodo, (entradasPorMetodo.get(p.metodo) ?? 0) + p.valorCentavos)
  }
  const pagamentosFornecedores = estado.compras.flatMap((c) => c.pagamentos).filter((p) => noPeriodo(p.data))
  const saidasFornecedores = pagamentosFornecedores.reduce((s, p) => s + p.valorCentavos, 0)
  const entradas = Array.from(entradasPorMetodo.values()).reduce((a, b) => a + b, 0)
  const fluxo = entradas - totalDespesas - saidasFornecedores

  const valorStock = estado.produtos.reduce((s, p) => s + Math.round(Math.max(p.stock, 0) * p.custoCentavos), 0)
  const divida = estado.compras.filter((c) => c.estado === 'recebida').reduce((s, c) => s + totalCompra(c) - pagoCompra(c), 0)

  const porDia = new Map<string, number>()
  for (const v of confirmadas) porDia.set(chaveDia(v.dataHora), (porDia.get(chaveDia(v.dataHora)) ?? 0) + v.totalCentavos)
  const dias = Array.from(porDia.entries()).sort(([a], [b]) => a.localeCompare(b))
  const maximo = Math.max(1, ...dias.map(([, t]) => t))

  const pendentesOps = estado.operacoes.filter((o) => o.estado === 'pendente')
  const conflitos = estado.operacoes.filter((o) => o.estado === 'conflito')
  const correcoes = estado.despesas.filter((d) => d.estado === 'anulada').length + estado.operacoes.filter((o) => o.resolucao).length

  return (
    <>
      <CabecalhoPagina
        titulo="Relatórios de gestão"
        descricao="Lucro, fluxo de caixa e saldos são relatórios separados."
        accoes={
          <div className="chips" role="radiogroup" aria-label="Período">
            {(
              [
                ['hoje', 'Hoje'],
                ['7dias', 'Últimos 7 dias'],
                ['tudo', 'Tudo'],
              ] as [Periodo, string][]
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={periodo === valor}
                className={periodo === valor ? 'chip activo' : 'chip'}
                onClick={() => setPeriodo(valor)}
              >
                {rotulo}
              </button>
            ))}
          </div>
        }
      />
      <Aviso tom="aviso" titulo="Relatório de gestão — provisório">
        Os valores podem mudar quando chegarem operações de aparelhos que estiveram sem rede, ou quando forem feitas
        correcções. Não substitui a contabilidade. <MarcaDemo>Valores demonstrativos, dados fictícios</MarcaDemo> ·
        calculado às {formatarHora(calculadoEm)}.
      </Aviso>

      <div className="grelha-indicadores">
        <Indicador
          rotulo="Pendentes declarados"
          valor={`${pendentesOps.length} operação(ões)`}
          detalhe={`${estado.empresa.dispositivo}: último contacto ${formatarHora(estado.simulacao.ultimoContacto)}. Vendas pendentes não entram nos totais.`}
          tom={pendentesOps.length ? 'aviso' : undefined}
        />
        <Indicador rotulo="Operações tardias" valor="Sem servidor" detalhe="Indicador real exige a hora de recepção no servidor (D.9.3)." />
        <Indicador rotulo="Correcções auditadas" valor={String(correcoes)} detalhe="Anulações e conflitos resolvidos (simulados)." />
        <Indicador rotulo="Conflitos por resolver" valor={String(conflitos.length)} tom={conflitos.length ? 'perigo' : undefined} />
      </div>
      {pendentesDispositivo.length > 0 && (
        <p className="nota">
          Há {pendentesDispositivo.length} venda(s) deste período ainda pendentes neste dispositivo (
          {formatarMzn(pendentesDispositivo.reduce((s, v) => s + v.totalCentavos, 0))}), fora dos totais.
        </p>
      )}

      <div className="grelha-3">
        <Cartao titulo="Resultado de gestão (lucro)">
          <dl className="totais">
            <div>
              <dt>Vendas líquidas</dt>
              <dd>{formatarMzn(vendasLiquidas)}</dd>
            </div>
            <div>
              <dt className="texto-secundario">Descontos concedidos (já deduzidos)</dt>
              <dd className="texto-secundario">{formatarMzn(descontos)}</dd>
            </div>
            <div>
              <dt>CMV (custo fictício)</dt>
              <dd>−{formatarMzn(cmv)}</dd>
            </div>
            <div>
              <dt>Margem bruta</dt>
              <dd>
                {formatarMzn(margem)}{' '}
                {vendasLiquidas > 0 && <Etiqueta>{((margem * 100) / vendasLiquidas).toFixed(1).replace('.', ',')}%</Etiqueta>}
              </dd>
            </div>
            <div>
              <dt>Despesas</dt>
              <dd>−{formatarMzn(totalDespesas)}</dd>
            </div>
            <div className="totais-total">
              <dt>Resultado</dt>
              <dd>{formatarMzn(resultado)}</dd>
            </div>
          </dl>
          <p className="nota">Devoluções, perdas de stock e acertos de custo não entram no protótipo.</p>
        </Cartao>
        <Cartao titulo="Fluxo de caixa">
          <dl className="totais">
            {Array.from(entradasPorMetodo.entries()).map(([metodo, total]) => (
              <div key={metodo}>
                <dt>Entradas · {NOMES_METODO[metodo]}</dt>
                <dd>{formatarMzn(total)}</dd>
              </div>
            ))}
            <div>
              <dt>Despesas pagas</dt>
              <dd>−{formatarMzn(totalDespesas)}</dd>
            </div>
            <div>
              <dt>Pagamentos a fornecedores</dt>
              <dd>−{formatarMzn(saidasFornecedores)}</dd>
            </div>
            <div className="totais-total">
              <dt>Fluxo do período</dt>
              <dd>{formatarMzn(fluxo)}</dd>
            </div>
          </dl>
        </Cartao>
        <Cartao titulo="Saldos (agora)">
          <dl className="totais">
            <div>
              <dt>Valor do stock (custo fictício)</dt>
              <dd>{formatarMzn(valorStock)}</dd>
            </div>
            <div>
              <dt>Dívida a fornecedores</dt>
              <dd>{formatarMzn(divida)}</dd>
            </div>
          </dl>
          <p className="nota">Saldos por conta (caixa, M-Pesa, banco) precisam de saldos iniciais: fora do protótipo (H-09).</p>
        </Cartao>
      </div>

      <Cartao titulo="Vendas confirmadas por dia">
        {dias.length === 0 ? (
          <p className="nota">Sem vendas confirmadas no período.</p>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Vendas</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {dias.map(([dia, total]) => (
                <tr key={dia}>
                  <td>{formatarData(`${dia}T12:00:00+02:00`)}</td>
                  <td className="barra-celula">
                    <span className="barra" style={{ width: `${(total * 100) / maximo}%` }} />
                  </td>
                  <td className="num">{formatarMzn(total)}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </>
  )
}
