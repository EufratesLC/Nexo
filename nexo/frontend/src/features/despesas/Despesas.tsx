import { useState } from 'react'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Etiqueta, Modal, Tabela } from '../../components/ui'
import { anularDespesa, registarDespesa } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { CATEGORIAS_DESPESA, type Despesa } from '../../demo/tipos'
import { agoraIso, formatarData } from '../../lib/datas'
import { formatarMzn, lerMzn } from '../../lib/dinheiro'

const CONTAS: Record<Despesa['conta'], string> = { caixa: 'Caixa (numerário)', mpesa: 'M-Pesa', banco: 'Banco' }

export function Despesas() {
  const { estado, executar } = useDemo()
  const [categoria, setCategoria] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [conta, setConta] = useState<Despesa['conta']>('banco')
  const [erros, setErros] = useState<{ categoria?: string; descricao?: string; valor?: string; geral?: string }>({})
  const [aAnular, setAAnular] = useState<Despesa | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erroAnular, setErroAnular] = useState<string>()

  const activas = estado.despesas.filter((d) => d.estado === 'activa')
  const porCategoria = CATEGORIAS_DESPESA.map((c) => ({
    categoria: c,
    total: activas.filter((d) => d.categoria === c).reduce((s, d) => s + d.valorCentavos, 0),
  })).filter((x) => x.total > 0)

  const guardar = () => {
    const centavos = lerMzn(valor)
    const novos: typeof erros = {}
    if (!categoria) novos.categoria = 'Escolha a categoria.'
    if (descricao.trim().length < 3) novos.descricao = 'Descreva a despesa.'
    if (centavos === null || centavos <= 0) novos.valor = 'Indique um valor maior do que zero.'
    setErros(novos)
    if (Object.keys(novos).length > 0) return
    const falha = executar((e) =>
      registarDespesa(e, { data: agoraIso(), categoria, descricao: descricao.trim(), valorCentavos: centavos ?? 0, conta }),
    )
    if (falha) setErros({ geral: falha })
    else {
      setDescricao('')
      setValor('')
    }
  }

  return (
    <>
      <CabecalhoPagina titulo="Despesas" descricao="Despesas por categoria. As pagas pelo caixa registam-se no ecrã Caixa." />
      <div className="grelha-2">
        <Cartao titulo="Nova despesa">
          <form
            className="formulario"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              guardar()
            }}
          >
            <Campo rotulo="Categoria *" erro={erros.categoria}>
              {(p) => (
                <select {...p} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                  <option value="">Escolher…</option>
                  {CATEGORIAS_DESPESA.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo rotulo="Descrição *" erro={erros.descricao}>
              {(p) => <input {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />}
            </Campo>
            <Campo rotulo="Valor (MZN) *" erro={erros.valor}>
              {(p) => <input {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
            </Campo>
            <Campo rotulo="Pago por">
              {(p) => (
                <select {...p} value={conta} onChange={(e) => setConta(e.target.value as Despesa['conta'])}>
                  <option value="banco">Banco</option>
                  <option value="mpesa">M-Pesa</option>
                </select>
              )}
            </Campo>
            {erros.geral && <Aviso tom="perigo">{erros.geral}</Aviso>}
            <Botao type="submit">Registar despesa</Botao>
          </form>
        </Cartao>
        <Cartao titulo="Por categoria (activas)">
          {porCategoria.length === 0 ? (
            <EstadoVazio titulo="Sem despesas" />
          ) : (
            <ul className="lista-simples">
              {porCategoria.map((x) => (
                <li key={x.categoria}>
                  <span>{x.categoria}</span>
                  <strong>{formatarMzn(x.total)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
      <Cartao titulo="Registo">
        {estado.despesas.length === 0 ? (
          <EstadoVazio titulo="Ainda não há despesas" />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th>Pago por</th>
                <th className="num">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {estado.despesas
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.id} className={d.estado === 'anulada' ? 'linha-anulada' : ''}>
                    <td>{formatarData(d.data)}</td>
                    <td>{d.categoria}</td>
                    <td>
                      {d.descricao}
                      {d.motivoAnulacao && <div className="texto-secundario">Anulada: {d.motivoAnulacao}</div>}
                    </td>
                    <td>{CONTAS[d.conta]}</td>
                    <td className="num">{formatarMzn(d.valorCentavos)}</td>
                    <td>
                      {d.estado === 'anulada' ? (
                        <Etiqueta>Anulada</Etiqueta>
                      ) : (
                        <Botao variante="discreto" onClick={() => setAAnular(d)}>
                          Anular
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
      {aAnular && (
        <Modal titulo="Anular despesa" aoFechar={() => setAAnular(null)}>
          <p>Uma despesa não se edita. A anulação fica visível e registada; se for preciso, registe outra correcta.</p>
          <form
            className="formulario"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              const falha = executar((est) => anularDespesa(est, aAnular.id, motivo))
              if (falha) setErroAnular(falha)
              else {
                setAAnular(null)
                setMotivo('')
              }
            }}
          >
            <Campo rotulo="Motivo *" erro={erroAnular}>
              {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
            </Campo>
            <div className="linha-accoes">
              <Botao variante="secundario" onClick={() => setAAnular(null)}>
                Voltar
              </Botao>
              <Botao type="submit" variante="perigo">
                Anular
              </Botao>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
