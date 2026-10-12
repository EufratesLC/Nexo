// Limite de tentativas falhadas, em memória (janela deslizante).
//
// Usa-se por IP e por identificador (empresa + utilizador), para TODOS os identificadores, existam
// ou não: a resposta "demasiadas tentativas" não revela se a conta existe.
//
// Limitação conhecida: em memória de UM processo. Reiniciar a API limpa os contadores, e várias
// instâncias teriam contadores separados. Para o piloto (uma instância) chega; com várias
// instâncias passa para uma base partilhada (Etapa 10).

import { createHash } from 'node:crypto'

export interface RegraLimite {
  maximo: number
  janelaMs: number
}

export class Limitador {
  private readonly falhas = new Map<string, number[]>()
  private readonly regra: RegraLimite
  private readonly capacidade: number
  private readonly agora: () => number

  constructor(regra: RegraLimite, opcoes: { capacidade?: number; agora?: () => number } = {}) {
    this.regra = regra
    this.capacidade = opcoes.capacidade ?? 50_000
    this.agora = opcoes.agora ?? Date.now
  }

  private recentes(chave: string): number[] {
    const limite = this.agora() - this.regra.janelaMs
    const lista = (this.falhas.get(chave) ?? []).filter((t) => t > limite)
    if (lista.length) this.falhas.set(chave, lista)
    else this.falhas.delete(chave)
    return lista
  }

  /** Milissegundos até poder tentar de novo; 0 se pode tentar já. */
  esperaMs(chave: string): number {
    const lista = this.recentes(chave)
    if (lista.length < this.regra.maximo) return 0
    return lista[lista.length - this.regra.maximo] + this.regra.janelaMs - this.agora()
  }

  registarFalha(chave: string): void {
    const lista = this.recentes(chave)
    lista.push(this.agora())
    this.falhas.set(chave, lista)
    // Protecção de memória: sem crescimento ilimitado com chaves aleatórias.
    if (this.falhas.size > this.capacidade) {
      const maisAntiga = this.falhas.keys().next().value
      if (maisAntiga !== undefined) this.falhas.delete(maisAntiga)
    }
  }

  limpar(chave: string): void {
    this.falhas.delete(chave)
  }
}

/** Chave por identificador, sem guardar em memória o texto que o utilizador escreveu. */
export function chaveIdentificador(...partes: string[]): string {
  return createHash('sha256').update(partes.map((p) => p.trim().toLowerCase()).join('\u0000')).digest('base64url')
}

/** Regras propostas (ajustáveis no piloto). */
export const LIMITES = {
  entrarPorConta: { maximo: 5, janelaMs: 15 * 60_000 },
  entrarPorIp: { maximo: 30, janelaMs: 15 * 60_000 },
  registoPorIp: { maximo: 5, janelaMs: 60 * 60_000 },
  recuperacaoPorConta: { maximo: 3, janelaMs: 15 * 60_000 },
  recuperacaoPorIp: { maximo: 10, janelaMs: 15 * 60_000 },
  tokensPorIp: { maximo: 20, janelaMs: 15 * 60_000 },
  codigoProprioPorConta: { maximo: 5, janelaMs: 15 * 60_000 },
} satisfies Record<string, RegraLimite>
