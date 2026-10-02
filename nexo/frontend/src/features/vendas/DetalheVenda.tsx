import { useState } from 'react'
import { navegar } from '../../app/rotas'
import { AutorizacaoModal } from '../../components/AutorizacaoModal'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Etiqueta, EtiquetaSync, Modal } from '../../components/ui'
import { cancelarVenda } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { podeGerir, sessaoAberta } from '../../demo/regras'
import { formatarDataHora } from '../../lib/datas'
import { Comprovativo } from './Comprovativo'

export function DetalheVenda({ vendaId }: { vendaId: string }) {
  const { estado, utilizador, executar } = useDemo()
  const [aCancelar, setACancelar] = useState(false)
  const [pedirAutorizacao, setPedirAutorizacao] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const venda = estado.vendas.find((v) => v.id === vendaId)

  if (!venda) return <EstadoVazio titulo="Venda não encontrada" accao={<a href="#/vendas">Voltar ao histórico</a>} />

  const operacaoVenda = estado.operacoes.find((o) => o.tipo === 'venda' && o.referenciaId === venda.id)
  const operacaoCancelamento = estado.operacoes.find((o) => o.tipo === 'cancelamento' && o.referenciaId === venda.id)
  const sessao = sessaoAberta(estado)
  const podeCancelar = venda.estado === 'concluida' && sessao?.id === venda.sessaoId
  const nome = (id?: string) => estado.utilizadores.find((u) => u.id === id)?.nome ?? '—'

  const cancelar = (autorizadorId?: string) => {
    const falha = executar((e) => cancelarVenda(e, venda.id, motivo, autorizadorId))
    if (falha) setErro(falha)
    setACancelar(false)
    setPedirAutorizacao(false)
  }

  return (
    <>
      <CabecalhoPagina
        titulo={`Venda ${venda.numero}`}
        descricao={formatarDataHora(venda.dataHora)}
        accoes={
          <>
            <Botao variante="secundario" onClick={() => window.print()}>
              Imprimir
            </Botao>
            <Botao onClick={() => navegar('balcao')}>Nova venda</Botao>
          </>
        }
      />
      {erro && <Aviso tom="perigo">{erro}</Aviso>}
      <div className="grelha-2 detalhe-venda">
        <Comprovativo venda={venda} estadoSync={operacaoVenda?.estado} />
        <div className="pilha">
          <Cartao titulo="Estado">
            <ul className="lista-simples">
              <li>
                <span>Sincronização da venda</span>
                <EtiquetaSync estado={operacaoVenda?.estado} />
              </li>
              {operacaoCancelamento && (
                <li>
                  <span>Sincronização do cancelamento</span>
                  <EtiquetaSync estado={operacaoCancelamento.estado} />
                </li>
              )}
              <li>
                <span>Vendedor (autor)</span>
                <span>{nome(venda.autorId)}</span>
              </li>
              {venda.autorizadorId && (
                <li>
                  <span>Autorizado por</span>
                  <span>
                    {nome(venda.autorizadorId)} — {venda.motivoAutorizacao}
                  </span>
                </li>
              )}
              {venda.vendidaForaDaSessao && (
                <li>
                  <span>Sessão</span>
                  <Etiqueta tom="info">Vendida fora da própria sessão</Etiqueta>
                </li>
              )}
            </ul>
            {operacaoVenda?.estado === 'pendente' && (
              <p className="nota">
                Pendente: gravada neste dispositivo e ainda não confirmada pelo servidor (simulado). Mude para "Online" no
                topo para simular o envio.
              </p>
            )}
          </Cartao>
          {venda.estado === 'cancelada' && venda.cancelamento ? (
            <Aviso tom="perigo" titulo="Venda cancelada">
              {formatarDataHora(venda.cancelamento.dataHora)} por {nome(venda.cancelamento.autorId)}
              {venda.cancelamento.autorizadorId && `, autorizado por ${nome(venda.cancelamento.autorizadorId)}`}. Motivo:{' '}
              {venda.cancelamento.motivo}. O registo original mantém-se.
            </Aviso>
          ) : (
            <Cartao titulo="Correcções">
              {podeCancelar ? (
                <Botao variante="perigo" onClick={() => setACancelar(true)}>
                  Cancelar venda
                </Botao>
              ) : (
                <p className="nota">Só se cancela na sessão de caixa aberta em que a venda foi feita (D.6.1.2).</p>
              )}
              <p className="nota">Devoluções: não incluídas no protótipo (são online e ficam para a Etapa 6).</p>
            </Cartao>
          )}
        </div>
      </div>

      {aCancelar && (
        <Modal titulo="Cancelar venda" aoFechar={() => setACancelar(false)}>
          <p>O cancelamento não apaga a venda: cria estornos de stock e de caixa e fica no histórico.</p>
          <form
            className="formulario"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (motivo.trim() === '') {
                setErro('O motivo é obrigatório.')
                return
              }
              if (podeGerir(utilizador)) cancelar()
              else {
                setACancelar(false)
                setPedirAutorizacao(true)
              }
            }}
          >
            <Campo rotulo="Motivo *" erro={erro && motivo.trim() === '' ? erro : undefined}>
              {(p) => <input {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
            </Campo>
            <div className="linha-accoes">
              <Botao variante="secundario" onClick={() => setACancelar(false)}>
                Voltar
              </Botao>
              <Botao type="submit" variante="perigo">
                {podeGerir(utilizador) ? 'Confirmar cancelamento' : 'Pedir autorização'}
              </Botao>
            </div>
          </form>
        </Modal>
      )}
      {pedirAutorizacao && (
        <AutorizacaoModal
          titulo="Autorizar cancelamento"
          explicacao={`O operador precisa de autorização para cancelar a venda ${venda.numero}.`}
          podeAutorizar={podeGerir}
          aoFechar={() => setPedirAutorizacao(false)}
          aoAutorizar={(autorizador) => cancelar(autorizador.id)}
        />
      )}
    </>
  )
}
