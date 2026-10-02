import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ErroDemo } from './accoes'
import { DemoContext, type ContextoDemo } from './contexto'
import { criarEstadoInicial, VERSAO_DADOS } from './dadosIniciais'
import type { EstadoDemo } from './tipos'

const CHAVE = 'nexo-prototipo-estado'
const ATRASO_ENVIO_SIMULADO_MS = 1500

function carregar(): EstadoDemo {
  try {
    const texto = localStorage.getItem(CHAVE)
    if (texto) {
      const guardado = JSON.parse(texto) as EstadoDemo
      if (guardado.versao === VERSAO_DADOS) return guardado
    }
  } catch {
    // Armazenamento indisponível (janela privada, bloqueio): começa com os dados fictícios.
  }
  return criarEstadoInicial()
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDemo>(carregar)
  const actual = useRef(estado)

  useEffect(() => {
    actual.current = estado
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado))
    } catch {
      // Sem armazenamento: a demonstração continua só em memória.
    }
  }, [estado])

  const executar = useCallback((transicao: (e: EstadoDemo) => EstadoDemo): string | null => {
    try {
      const novo = transicao(actual.current)
      actual.current = novo
      setEstado(novo)
      return null
    } catch (erro) {
      if (erro instanceof ErroDemo) return erro.message
      throw erro
    }
  }, [])

  const repor = useCallback(() => {
    const inicial = criarEstadoInicial()
    actual.current = inicial
    setEstado(inicial)
  }, [])

  // Simulação: com "ligação" activa, as operações pendentes passam a confirmadas
  // depois de um pequeno atraso. Nenhum pedido sai do navegador.
  const haPendentes = estado.operacoes.some((o) => o.estado === 'pendente')
  useEffect(() => {
    if (estado.simulacao.ligacao !== 'online' || !haPendentes) return
    const temporizador = window.setTimeout(() => {
      const e = actual.current
      if (e.simulacao.ligacao !== 'online') return
      const novo: EstadoDemo = {
        ...e,
        operacoes: e.operacoes.map((o) => (o.estado === 'pendente' ? { ...o, estado: 'confirmado' } : o)),
        simulacao: { ...e.simulacao, ultimoContacto: new Date().toISOString() },
      }
      actual.current = novo
      setEstado(novo)
    }, ATRASO_ENVIO_SIMULADO_MS)
    return () => window.clearTimeout(temporizador)
  }, [estado.simulacao.ligacao, haPendentes, estado.operacoes.length])

  const valor = useMemo<ContextoDemo>(() => {
    const utilizador = estado.utilizadores.find((u) => u.id === estado.utilizadorActivoId)
    return { estado, utilizador, executar, repor }
  }, [estado, executar, repor])

  return <DemoContext.Provider value={valor}>{children}</DemoContext.Provider>
}
