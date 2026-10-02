import { useState } from 'react'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, EtiquetaSync, Indicador, Modal, Tabela } from '../../components/ui'
import { resolverConflito, simularConflito, simularEnvio, simularPausa, simularRetoma } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { podeGerir } from '../../demo/regras'
import type { EstadoSync, Operacao } from '../../demo/tipos'
import { formatarDataHora } from '../../lib/datas'
import { formatarMzn } from '../../lib/dinheiro'

// Motivos de conflito tirados da especificação (D.11.6), só para demonstração.
const MOTIVOS_CONFLITO = [
  'Sessão de caixa fechada à força no servidor (D.11.6, 3)',
  'Autor desactivado e excepção autónoma (D.13.6)',
  'Mesmo identificador com conteúdo diferente (D.5.2)',
  'Referência desconhecida no servidor (D.11.6, 8)',
]

export function Sincronizacao() {
  const { estado, utilizador, executar } = useDemo()
  const [filtro, setFiltro] = useState<EstadoSync | ''>('')
  const [erro, setErro] = useState<string | null>(null)
  const [aSimular, setASimular] = useState<Operacao | null>(null)
  const [aResolver, setAResolver] = useState<Operacao | null>(null)
  const gestor = podeGerir(utilizador)
  const online = estado.simulacao.ligacao === 'online'
  const contar = (e: EstadoSync) => estado.operacoes.filter((o) => o.estado === e).length
  const lista = estado.operacoes
    .filter((o) => filtro === '' || o.estado === filtro)
    .slice()
    .reverse()
    .slice(0, 60)

  return (
    <>
      <CabecalhoPagina titulo="Sincronização" descricao={`Estado deste dispositivo: ${estado.empresa.dispositivo} (${estado.empresa.codigoDispositivo}).`} />
      <Aviso tom="aviso" titulo="Simulação">
        Não existe servidor nesta demonstração. "Online" e "Offline" são um interruptor; com "Online" as operações
        pendentes passam a confirmadas ao fim de 1,5 s. Isto <strong>não</strong> é funcionamento offline real: não há fila
        em IndexedDB, idempotência nem verificação no servidor (ver docs/Nexo_Arquitectura_Etapa_1.md).
      </Aviso>
      {erro && <Aviso tom="perigo">{erro}</Aviso>}
      <div className="grelha-indicadores">
        <Indicador rotulo="Ligação (simulada)" valor={online ? 'Online' : 'Offline'} tom={online ? undefined : 'aviso'} />
        <Indicador rotulo="Último contacto" valor={formatarDataHora(estado.simulacao.ultimoContacto)} />
        <Indicador rotulo="Pendentes" valor={String(contar('pendente'))} tom={contar('pendente') ? 'aviso' : undefined} />
        <Indicador rotulo="Conflitos" valor={String(contar('conflito'))} tom={contar('conflito') ? 'perigo' : undefined} />
      </div>
      <div className="grelha-2">
        <Cartao titulo="Acções de simulação">
          <div className="linha-accoes">
            <Botao variante="secundario" disabled={!online || contar('pendente') === 0} onClick={() => setErro(executar(simularEnvio))}>
              Enviar pendentes agora
            </Botao>
          </div>
          <p className="nota">
            Para ver uma venda pendente: mude para "Offline" no topo, faça uma venda e volte aqui. Para simular um conflito,
            use "Marcar conflito" numa operação pendente.
          </p>
        </Cartao>
        <Cartao titulo="Pausa de vendas para contagem física">
          {estado.simulacao.pausaContagem === 'em_pausa' ? (
            <>
              <Aviso tom="aviso">
                Em pausa. No MVP a retoma depende do servidor: o dispositivo só volta a vender quando recebe o aviso de
                retoma. Sem rede, continua em pausa. A retoma local por PIN é uma possibilidade futura, fora do MVP.
              </Aviso>
              <Botao variante="secundario" onClick={() => setErro(executar(simularRetoma))}>
                Simular retoma enviada pelo servidor
              </Botao>
            </>
          ) : (
            <>
              <p className="nota">
                O pedido de pausa só é confirmado com ligação e sem operações pendentes (D.7.2).
              </p>
              <Botao variante="secundario" disabled={!gestor} onClick={() => setErro(executar(simularPausa))}>
                Simular pedido de pausa
              </Botao>
            </>
          )}
        </Cartao>
      </div>
      <Cartao
        titulo="Operações deste dispositivo"
        accao={
          <select aria-label="Filtrar por estado" value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoSync | '')}>
            <option value="">Todas</option>
            <option value="pendente">Pendentes</option>
            <option value="confirmado">Confirmadas</option>
            <option value="conflito">Conflitos</option>
            <option value="anulada">Anuladas</option>
          </select>
        }
      >
        {lista.length === 0 ? (
          <EstadoVazio titulo="Nenhuma operação com este estado" />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <th className="num">Seq.</th>
                <th>Operação</th>
                <th>Criada</th>
                <th className="num">Valor</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id}>
                  <td className="num">{o.sequencia}</td>
                  <td>
                    {o.tipo === 'venda' || o.tipo === 'cancelamento' ? <a href={`#/vendas/${o.referenciaId}`}>{o.descricao}</a> : o.descricao}
                    {o.motivoConflito && <div className="texto-perigo">{o.motivoConflito}</div>}
                    {o.resolucao && <div className="texto-secundario">{o.resolucao}</div>}
                  </td>
                  <td>{formatarDataHora(o.criadaEm)}</td>
                  <td className="num">{o.valorCentavos !== undefined ? formatarMzn(o.valorCentavos) : '—'}</td>
                  <td>
                    <EtiquetaSync estado={o.estado} />
                  </td>
                  <td>
                    {o.estado === 'pendente' && (
                      <Botao variante="discreto" onClick={() => setASimular(o)}>
                        Marcar conflito
                      </Botao>
                    )}
                    {o.estado === 'conflito' && gestor && (
                      <Botao variante="discreto" onClick={() => setAResolver(o)}>
                        Resolver
                      </Botao>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>
      {aSimular && (
        <Modal titulo="Simular conflito" aoFechar={() => setASimular(null)}>
          <p>Escolha o motivo que o servidor devolveria. A operação fica guardada, não é apagada.</p>
          <ul className="lista-botoes">
            {MOTIVOS_CONFLITO.map((m) => (
              <li key={m}>
                <Botao
                  variante="secundario"
                  onClick={() => {
                    executar((e) => simularConflito(e, aSimular.id, m))
                    setASimular(null)
                  }}
                >
                  {m}
                </Botao>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {aResolver && <ResolverModal operacao={aResolver} aoFechar={() => setAResolver(null)} />}
    </>
  )
}

function ResolverModal({ operacao, aoFechar }: { operacao: Operacao; aoFechar: () => void }) {
  const { executar } = useDemo()
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string>()
  const decidir = (decisao: 'aceitar' | 'anular') => {
    const falha = executar((e) => resolverConflito(e, operacao.id, decisao, nota))
    if (falha) setErro(falha)
    else aoFechar()
  }
  return (
    <Modal titulo="Resolver conflito" aoFechar={aoFechar}>
      <p>
        <strong>{operacao.descricao}</strong> — {operacao.motivoConflito}
      </p>
      <p className="nota">
        Aceitar aplica a operação como está. Anular preserva-a com o estado "anulada pelo gestor" (D.11.6). A decisão fica
        na auditoria.
      </p>
      <Campo rotulo="Nota para a auditoria *" erro={erro}>
        {(p) => <input {...p} value={nota} onChange={(e) => setNota(e.target.value)} />}
      </Campo>
      <div className="linha-accoes">
        <Botao variante="secundario" onClick={() => decidir('anular')}>
          Anular
        </Botao>
        <Botao onClick={() => decidir('aceitar')}>Aceitar</Botao>
      </div>
    </Modal>
  )
}
