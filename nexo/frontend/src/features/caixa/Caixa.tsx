import { useState } from 'react'
import { AutorizacaoModal } from '../../components/AutorizacaoModal'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Etiqueta, Modal, Tabela } from '../../components/ui'
import { abrirCaixa, fecharCaixa, registarContagemFecho, registarMovimentoCaixa } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { esperadoCaixa, numerarioDaVenda, podeGerir, sessaoAberta } from '../../demo/regras'
import { CATEGORIAS_DESPESA, type ContagemFecho, type SessaoCaixa, type TipoMovimentoCaixa } from '../../demo/tipos'
import { formatarDataHora } from '../../lib/datas'
import { formatarMzn, formatarValor, lerMzn } from '../../lib/dinheiro'

const NOMES_MOVIMENTO: Record<TipoMovimentoCaixa, string> = {
  reforco: 'Reforço',
  retirada: 'Retirada',
  despesa: 'Despesa pelo caixa',
}

export function Caixa() {
  const { estado, utilizador } = useDemo()
  const sessao = sessaoAberta(estado)
  const fechadas = estado.sessoes.filter((s) => s.estado === 'fechada')
  const ultima = fechadas[fechadas.length - 1]

  return (
    <>
      <CabecalhoPagina titulo="Caixa" descricao={`${estado.empresa.dispositivo}: uma sessão aberta por dispositivo.`} />
      {estado.simulacao.pausaContagem === 'em_pausa' && (
        <Aviso tom="info">Durante a pausa de contagem continuam possíveis reforços, retiradas, despesas e o fecho (D.7.1).</Aviso>
      )}
      {sessao ? <SessaoAberta sessao={sessao} /> : <AbrirCaixa sugestao={ultima?.contadoCentavos} />}
      {podeGerir(utilizador) && fechadas.length > 0 && (
        <Cartao titulo="Sessões anteriores">
          <Tabela>
            <thead>
              <tr>
                <th>Fechada em</th>
                <th>Responsável</th>
                <th className="num">Esperado</th>
                <th className="num">Contado</th>
                <th className="num">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {fechadas
                .slice()
                .reverse()
                .map((s) => (
                  <tr key={s.id}>
                    <td>{s.fechadaEm ? formatarDataHora(s.fechadaEm) : '—'}</td>
                    <td>{estado.utilizadores.find((u) => u.id === s.responsavelId)?.nome}</td>
                    <td className="num">{formatarMzn(s.esperadoCentavos ?? 0)}</td>
                    <td className="num">{formatarMzn(s.contadoCentavos ?? 0)}</td>
                    <td className="num">
                      <DiferencaEtiqueta valor={s.diferencaCentavos ?? 0} />
                      {s.justificacao && <div className="texto-secundario">{s.justificacao}</div>}
                      {(s.contagens?.length ?? 0) > 1 && (
                        <div className="texto-secundario">
                          {s.contagens?.length} contagens; 1.ª: {formatarMzn(s.contagens?.[0].contadoCentavos ?? 0)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </Tabela>
        </Cartao>
      )}
    </>
  )
}

function DiferencaEtiqueta({ valor }: { valor: number }) {
  if (valor === 0) return <Etiqueta tom="sucesso">Sem diferença</Etiqueta>
  return <Etiqueta tom={valor < 0 ? 'perigo' : 'aviso'}>{`${valor < 0 ? 'Falta' : 'Sobra'} ${formatarMzn(Math.abs(valor))}`}</Etiqueta>
}

function AbrirCaixa({ sugestao }: { sugestao?: number }) {
  const { executar } = useDemo()
  const [fundo, setFundo] = useState(sugestao !== undefined ? formatarValor(Math.min(sugestao, 200000)) : '2 000,00')
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string>()

  return (
    <Cartao titulo="Abrir caixa">
      <form
        className="formulario"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const valor = lerMzn(fundo)
          if (valor === null || valor < 0) {
            setErro('Indique o fundo contado, por exemplo 2 000,00.')
            return
          }
          const falha = executar((est) => abrirCaixa(est, valor))
          if (falha) setErro(falha)
        }}
      >
        <Campo rotulo="Fundo de maneio contado (MZN) *" erro={erro} ajuda="Conte o numerário na gaveta antes de abrir.">
          {(p) => <input {...p} inputMode="decimal" value={fundo} onChange={(e) => setFundo(e.target.value)} />}
        </Campo>
        <Campo rotulo="Nota (se o valor for diferente do deixado no último fecho)">
          {(p) => <input {...p} value={nota} onChange={(e) => setNota(e.target.value)} />}
        </Campo>
        <Botao type="submit">Abrir caixa</Botao>
      </form>
    </Cartao>
  )
}

function SessaoAberta({ sessao }: { sessao: SessaoCaixa }) {
  const { estado, utilizador } = useDemo()
  const [movimento, setMovimento] = useState<TipoMovimentoCaixa | null>(null)
  const [aFechar, setAFechar] = useState(false)
  const gestor = podeGerir(utilizador)
  const vendas = estado.vendas.filter((v) => v.sessaoId === sessao.id)
  const vendasNumerario = vendas.filter((v) => v.estado === 'concluida').reduce((s, v) => s + numerarioDaVenda(v), 0)
  const movimentos = estado.movimentos.filter((m) => m.sessaoId === sessao.id)
  const soma = (tipo: TipoMovimentoCaixa) => movimentos.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.valorCentavos, 0)
  const pendentes = estado.operacoes.filter((o) => o.estado === 'pendente').length
  const responsavel = estado.utilizadores.find((u) => u.id === sessao.responsavelId)
  // Durante o fecho o esperado não aparece em lado nenhum do ecrã, nem por trás da janela (contagem cega).
  const mostrarEsperado = gestor && !aFechar

  return (
    <>
      <Cartao
        titulo="Sessão aberta"
        accao={
          <Botao variante="perigo" onClick={() => setAFechar(true)}>
            Fechar caixa
          </Botao>
        }
      >
        <ul className="lista-simples">
          <li>
            <span>Responsável</span>
            <strong>{responsavel?.nome}</strong>
          </li>
          <li>
            <span>Aberta em</span>
            <span>{formatarDataHora(sessao.abertaEm)}</span>
          </li>
          <li>
            <span>Fundo de abertura</span>
            <span>{formatarMzn(sessao.fundoCentavos)}</span>
          </li>
          <li>
            <span>Vendas ({vendas.length})</span>
            <span>
              {mostrarEsperado ? formatarMzn(vendasNumerario) : '—'} <span className="texto-secundario">em numerário</span>
            </span>
          </li>
          <li>
            <span>Reforços / Retiradas / Despesas</span>
            <span>
              +{formatarMzn(soma('reforco'))} / −{formatarMzn(soma('retirada'))} / −{formatarMzn(soma('despesa'))}
            </span>
          </li>
          <li>
            <span>Numerário esperado</span>
            <strong data-teste="esperado-cartao">
              {mostrarEsperado ? formatarMzn(esperadoCaixa(estado, sessao.id)) : 'Visível depois da contagem (contagem cega)'}
            </strong>
          </li>
        </ul>
        <div className="linha-accoes">
          <Botao variante="secundario" onClick={() => setMovimento('reforco')}>
            Reforço
          </Botao>
          <Botao variante="secundario" onClick={() => setMovimento('retirada')}>
            Retirada
          </Botao>
          <Botao variante="secundario" onClick={() => setMovimento('despesa')}>
            Despesa pelo caixa
          </Botao>
        </div>
      </Cartao>
      <Cartao titulo="Movimentos da sessão">
        {movimentos.length === 0 ? (
          <EstadoVazio titulo="Sem reforços, retiradas ou despesas nesta sessão" />
        ) : (
          <ul className="lista-simples">
            {movimentos.map((m) => (
              <li key={m.id}>
                <span>
                  {NOMES_MOVIMENTO[m.tipo]} · {m.descricao}
                  <span className="texto-secundario"> · {formatarDataHora(m.dataHora)}</span>
                </span>
                <strong>
                  {m.tipo === 'reforco' ? '+' : '−'}
                  {formatarMzn(m.valorCentavos)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      {movimento && <MovimentoModal tipo={movimento} aoFechar={() => setMovimento(null)} />}
      {aFechar && <FechoModal sessao={sessao} pendentes={pendentes} aoFechar={() => setAFechar(false)} />}
    </>
  )
}

function MovimentoModal({ tipo, aoFechar }: { tipo: TipoMovimentoCaixa; aoFechar: () => void }) {
  const { utilizador, executar } = useDemo()
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_DESPESA[3])
  const [erro, setErro] = useState<string>()
  const [autorizar, setAutorizar] = useState(false)

  const registar = (autorizadorId?: string) => {
    const centavos = lerMzn(valor)
    if (centavos === null || centavos <= 0) {
      setErro('Indique um valor maior do que zero.')
      setAutorizar(false)
      return
    }
    const falha = executar((e) => registarMovimentoCaixa(e, tipo, centavos, descricao, autorizadorId, categoria))
    if (falha) {
      setErro(falha)
      setAutorizar(false)
    } else aoFechar()
  }

  if (autorizar) {
    return (
      <AutorizacaoModal
        titulo={`Autorizar ${NOMES_MOVIMENTO[tipo].toLowerCase()}`}
        explicacao="O operador precisa de autorização para esta operação de caixa (matriz B.5)."
        podeAutorizar={podeGerir}
        aoFechar={() => setAutorizar(false)}
        aoAutorizar={(a) => registar(a.id)}
      />
    )
  }

  return (
    <Modal titulo={NOMES_MOVIMENTO[tipo]} aoFechar={aoFechar}>
      <form
        className="formulario"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const centavos = lerMzn(valor)
          if (centavos === null || centavos <= 0) return setErro('Indique um valor maior do que zero.')
          if (descricao.trim() === '') return setErro('Indique o motivo ou destino.')
          if (podeGerir(utilizador)) registar()
          else setAutorizar(true)
        }}
      >
        <Campo rotulo="Valor (MZN) *">
          {(p) => <input {...p} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />}
        </Campo>
        {tipo === 'despesa' && (
          <Campo rotulo="Categoria">
            {(p) => (
              <select {...p} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                {CATEGORIAS_DESPESA.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Campo>
        )}
        <Campo
          rotulo={tipo === 'retirada' ? 'Destino *' : tipo === 'reforco' ? 'Origem e motivo *' : 'Descrição *'}
          ajuda={tipo === 'retirada' ? 'Ex.: cofre, depósito no banco, entrega ao proprietário. Não é despesa.' : undefined}
        >
          {(p) => <input {...p} value={descricao} onChange={(e) => setDescricao(e.target.value)} />}
        </Campo>
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <div className="linha-accoes">
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao type="submit">{podeGerir(utilizador) ? 'Registar' : 'Pedir autorização'}</Botao>
        </div>
      </form>
    </Modal>
  )
}

function FechoModal({ sessao, pendentes, aoFechar }: { sessao: SessaoCaixa; pendentes: number; aoFechar: () => void }) {
  const { estado, executar } = useDemo()
  const contagens = sessao.contagens ?? []
  const ultima = contagens.at(-1)
  // Se já existe uma contagem registada, o esperado já foi revelado: a janela abre no passo 2.
  const [aContar, setAContar] = useState(ultima === undefined)
  const [contado, setContado] = useState('')
  const [justificacao, setJustificacao] = useState('')
  const [erro, setErro] = useState<string>()

  return (
    <Modal titulo="Fechar caixa" aoFechar={aoFechar}>
      {pendentes > 0 && (
        <Aviso tom="aviso" titulo="Valores provisórios">
          {pendentes} operação(ões) por sincronizar neste dispositivo.
        </Aviso>
      )}
      {aContar || ultima === undefined ? (
        <form
          className="formulario"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            const valor = lerMzn(contado)
            if (valor === null || valor < 0) return setErro('Indique o numerário contado.')
            const falha = executar((est) => registarContagemFecho(est, valor))
            if (falha) return setErro(falha)
            setErro(undefined)
            setContado('')
            setAContar(false)
          }}
        >
          <p>
            Conte o numerário da gaveta e registe o valor. O esperado e a diferença só aparecem depois de registar a
            contagem.
          </p>
          <p className="nota">
            Contagem cega: <strong>proposta por validar</strong> com a loja piloto (H-15), não é decisão aprovada.
            {contagens.length > 0 && ' Esta é uma recontagem: as contagens anteriores ficam guardadas.'}
          </p>
          <Campo rotulo="Numerário contado (MZN) *" erro={erro}>
            {(p) => <input {...p} inputMode="decimal" value={contado} onChange={(e) => setContado(e.target.value)} />}
          </Campo>
          <div className="linha-accoes">
            <Botao variante="secundario" onClick={aoFechar}>
              Cancelar
            </Botao>
            <Botao type="submit">Registar contagem</Botao>
          </div>
        </form>
      ) : (
        <ResultadoFecho
          esperado={esperadoCaixa(estado, sessao.id)}
          contagens={contagens}
          justificacao={justificacao}
          setJustificacao={setJustificacao}
          erro={erro}
          aoRecontar={() => {
            setErro(undefined)
            setAContar(true)
          }}
          aoFecharSessao={() => {
            const falha = executar((est) => fecharCaixa(est, justificacao))
            if (falha) setErro(falha)
            else aoFechar()
          }}
        />
      )}
    </Modal>
  )
}

function ResultadoFecho({
  esperado,
  contagens,
  justificacao,
  setJustificacao,
  erro,
  aoRecontar,
  aoFecharSessao,
}: {
  esperado: number
  contagens: ContagemFecho[]
  justificacao: string
  setJustificacao: (v: string) => void
  erro?: string
  aoRecontar: () => void
  aoFecharSessao: () => void
}) {
  const contado = contagens[contagens.length - 1].contadoCentavos
  return (
    <form
      className="formulario"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        aoFecharSessao()
      }}
    >
      <dl className="totais">
        <div>
          <dt>Contado</dt>
          <dd>{formatarMzn(contado)}</dd>
        </div>
        <div>
          <dt>Esperado</dt>
          <dd data-teste="esperado-fecho">{formatarMzn(esperado)}</dd>
        </div>
        <div className="totais-total">
          <dt>Diferença</dt>
          <dd>
            <DiferencaEtiqueta valor={contado - esperado} />
          </dd>
        </div>
      </dl>
      {contagens.length > 1 && (
        <p className="nota">
          Contagens registadas: {contagens.map((c, i) => `${i + 1}.ª ${formatarMzn(c.contadoCentavos)}`).join(' · ')}. Todas
          ficam no fecho.
        </p>
      )}
      {contado !== esperado && (
        <Campo rotulo="Justificação *" erro={erro} ajuda="Obrigatória quando há diferença.">
          {(p) => <input {...p} value={justificacao} onChange={(e) => setJustificacao(e.target.value)} />}
        </Campo>
      )}
      {contado === esperado && erro && <Aviso tom="perigo">{erro}</Aviso>}
      <div className="linha-accoes">
        <Botao variante="secundario" onClick={aoRecontar}>
          Recontar
        </Botao>
        <Botao type="submit" variante="perigo">
          Fechar sessão
        </Botao>
      </div>
    </form>
  )
}
