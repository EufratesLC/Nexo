// Registo de alterações administrativas (só o proprietário). Identifica a CONTA usada; não prova
// qual pessoa física introduziu o código. Nunca contém códigos, resumos nem links.

import { useCallback, useState } from 'react'
import { Carregando, EstadoErro } from '../../components/estados'
import { Aviso, Botao, CabecalhoPagina, EstadoVazio } from '../../components/ui'
import { useRecurso } from '../../lib/useRecurso'
import { listarAuditoria, type EntradaAuditoria } from '../../servicos/administracao'
import { NOMES_FUNCAO, type Funcao } from '../../servicos/autenticacao'
import { formatarDataHora } from '../formatos'

const ACCOES: Record<string, string> = {
  'empresa.criada': 'Empresa criada',
  'empresa.alterada': 'Dados da empresa alterados',
  'filial.alterada': 'Filial alterada',
  'utilizador.criado': 'Conta criada',
  'utilizador.nome_alterado': 'Nome alterado',
  'utilizador.funcao_alterada': 'Função alterada',
  'utilizador.filiais_alteradas': 'Filiais alteradas',
  'utilizador.desactivado': 'Conta desactivada',
  'utilizador.reactivado': 'Conta reactivada',
  'utilizador.codigo_definido': 'Código inicial definido',
  'utilizador.codigo_redefinido': 'Código redefinido pelo proprietário',
  'utilizador.codigo_alterado': 'Código alterado pelo próprio',
  'utilizador.email_alterado': 'E-mail de recuperação indicado',
  'utilizador.email_confirmado': 'E-mail de recuperação confirmado',
  'utilizador.recuperacao_pedida': 'Recuperação do acesso pedida',
  'utilizador.codigo_recuperado': 'Código redefinido por recuperação',
  'utilizador.recuperacao_suporte': 'Recuperação assistida pelo suporte',
}

function detalhe(e: EntradaAuditoria): string {
  const antes = e.antes ?? {}
  const depois = e.depois ?? {}
  if (e.accao === 'utilizador.funcao_alterada') return `${NOMES_FUNCAO[antes.funcao as Funcao] ?? antes.funcao} → ${NOMES_FUNCAO[depois.funcao as Funcao] ?? depois.funcao}`
  if (e.accao === 'utilizador.criado') return `${NOMES_FUNCAO[depois.funcao as Funcao] ?? ''}`
  if (e.accao === 'utilizador.recuperacao_suporte') return String(depois.motivo ?? '')
  const campos = Object.keys(depois).filter((k) => k !== 'sessoes_revogadas')
  return campos.length && e.accao.endsWith('alterada') ? campos.join(', ') : ''
}

export function Auditoria() {
  const carregar = useCallback((sinal: AbortSignal) => listarAuditoria({}, sinal), [])
  const [estado, repetir] = useRecurso(carregar)
  const [mais, setMais] = useState<EntradaAuditoria[]>([])
  const [fim, setFim] = useState(false)
  const [erroMais, setErroMais] = useState<unknown>(null)
  const entradas = estado.tipo === 'pronto' ? [...estado.dados, ...mais] : []

  async function carregarMais() {
    setErroMais(null)
    try {
      const seguintes = await listarAuditoria({ antes: entradas.at(-1)?.criadoEm })
      setMais((m) => [...m, ...seguintes])
      if (seguintes.length < 50) setFim(true)
    } catch (e) {
      setErroMais(e)
    }
  }

  return (
    <>
      <CabecalhoPagina titulo="Auditoria" descricao="Alterações administrativas da empresa, das mais recentes para as mais antigas." />
      <Aviso tom="info">
        Cada linha identifica a <strong>conta</strong> usada. Como o proprietário conhece os códigos que define, o registo não prova qual pessoa estava ao
        teclado.
      </Aviso>
      {estado.tipo === 'a_carregar' && <Carregando />}
      {estado.tipo === 'erro' && <EstadoErro erro={estado.erro} aoRepetir={repetir} />}
      {estado.tipo === 'pronto' && entradas.length === 0 && <EstadoVazio titulo="Sem registos" />}
      {entradas.length > 0 && (
        <div className="tabela-contentor">
          <table className="tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Acção</th>
                <th>Sobre</th>
                <th>Conta usada</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id}>
                  <td>{formatarDataHora(e.criadoEm)}</td>
                  <td>{ACCOES[e.accao] ?? e.accao}</td>
                  <td>{e.alvo ?? '—'}</td>
                  <td>{e.autor ? `${e.autor.nome} (${e.autor.nomeUtilizador})` : e.origem === 'suporte' ? 'Suporte do Nexo' : '—'}</td>
                  <td>{detalhe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {estado.tipo === 'pronto' && estado.dados.length === 50 && !fim && (
        <div className="linha-accoes">
          <Botao variante="secundario" onClick={() => void carregarMais()}>
            Ver mais antigos
          </Botao>
        </div>
      )}
      {erroMais !== null && <EstadoErro erro={erroMais} />}
    </>
  )
}
