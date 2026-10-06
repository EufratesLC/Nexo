// Contratos (só tipos) da fila persistente e da sincronização futura — PREPARAÇÃO da Etapa 2.
//
// Não há implementação nesta etapa: a fila e o envio são da Etapa 7 (arquitectura 7 e 8).
// O formato da autoria NÃO está definido: depende de H-23, que continua pendente. Nada aqui
// adopta assinatura, autoria declarada nem cifra baseada no PIN.

/** Envelope de uma operação de balcão, versão de formato 1 (arquitectura 7.1). */
export interface EnvelopeOperacao<Conteudo = unknown> {
  id: string
  versaoFormato: 1
  tipo:
    | 'abertura_caixa'
    | 'venda'
    | 'cancelamento'
    | 'movimento_caixa'
    | 'passagem_turno'
    | 'fecho_caixa'
    | 'confirmacao_pausa'
    | 'confirmacao_retoma'
  registo: string
  sequencia: number
  autor: string
  horaDeclarada: string
  desvioRelogioMs: number
  versaoPermissoes: number
  dependeDe: string[]
  conteudo: Conteudo
}

/** Estado real de uma operação no servidor (arquitectura 7.3). Não existe "ja_aplicada". */
export type EstadoOperacaoServidor = 'aplicada' | 'aplicada_com_alerta' | 'conflito' | 'quarentena' | 'anulada' | 'em_espera' | 'rejeitada'

export interface ResultadoOperacao {
  id: string
  sequencia: number
  estado: EstadoOperacaoServidor
  repeticao?: boolean
  motivo?: string
}

/** Fila persistente (Etapa 7). Gravação atómica com a venda e as sequências (arquitectura 8.1). */
export interface FilaOperacoes {
  pendentes(): Promise<EnvelopeOperacao[]>
  registarResultado(resultado: ResultadoOperacao): Promise<void>
}

/** Envio para o servidor (Etapa 7). */
export interface Sincronizador {
  enviarPendentes(): Promise<ResultadoOperacao[]>
}
