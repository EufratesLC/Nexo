// Tipos do estado de demonstração. Não são o modelo de dados definitivo:
// ver docs/Nexo_Arquitectura_Etapa_1.md para o modelo proposto.

export type Papel = 'proprietario' | 'gestor' | 'operador'

export interface Utilizador {
  id: string
  nome: string
  papel: Papel
  /** PIN fictício, só para demonstrar autorizações. Não é guardado assim no produto real (D.13.5). */
  pinDemo: string
  /** Limite de desconto em percentagem; null = sem limite. */
  limiteDesconto: number | null
}

export type Unidade = 'un' | 'kg' | 'L' | 'cx' | 'pct'

export interface Categoria {
  id: string
  nome: string
}

export interface Produto {
  id: string
  nome: string
  categoriaId: string
  unidade: Unidade
  codigo: string
  codigoBarras: string
  precoCentavos: number
  /** Custo médio fictício; no produto real é calculado no servidor (D.3). */
  custoCentavos: number
  stock: number
  stockMinimo: number
  activo: boolean
}

export type MetodoPagamento = 'numerario' | 'mpesa' | 'emola' | 'mkesh' | 'cartao' | 'transferencia'

export interface Pagamento {
  metodo: MetodoPagamento
  valorCentavos: number
  entregueCentavos?: number
  trocoCentavos?: number
  referencia?: string
}

export type EstadoSync = 'pendente' | 'confirmado' | 'conflito' | 'anulada'

export interface LinhaVenda {
  produtoId: string
  nome: string
  unidade: Unidade
  quantidade: number
  precoCentavos: number
  valorCentavos: number
  descontoCentavos: number
  liquidoCentavos: number
  custoUnitCentavos: number
}

export interface Venda {
  id: string
  numero: string
  sessaoId: string
  autorId: string
  autorizadorId?: string
  motivoAutorizacao?: string
  dataHora: string
  linhas: LinhaVenda[]
  subtotalCentavos: number
  descontoCentavos: number
  totalCentavos: number
  pagamentos: Pagamento[]
  estado: 'concluida' | 'cancelada'
  cancelamento?: { motivo: string; autorId: string; autorizadorId?: string; dataHora: string }
  vendidaForaDaSessao: boolean
}

export interface SessaoCaixa {
  id: string
  responsavelId: string
  abertaEm: string
  fundoCentavos: number
  estado: 'aberta' | 'fechada'
  fechadaEm?: string
  esperadoCentavos?: number
  contadoCentavos?: number
  diferencaCentavos?: number
  justificacao?: string
  /**
   * Contagens do fecho, pela ordem em que foram feitas (contagem cega, proposta H-15).
   * Uma recontagem acrescenta uma entrada; a primeira nunca é substituída.
   */
  contagens?: ContagemFecho[]
}

export interface ContagemFecho {
  contadoCentavos: number
  autorId: string
  em: string
}

export type TipoMovimentoCaixa = 'reforco' | 'retirada' | 'despesa'

export interface MovimentoCaixa {
  id: string
  sessaoId: string
  tipo: TipoMovimentoCaixa
  valorCentavos: number
  descricao: string
  autorId: string
  autorizadorId?: string
  dataHora: string
}

export interface Fornecedor {
  id: string
  nome: string
  nuit: string
  telefone: string
}

export interface LinhaCompra {
  produtoId: string
  quantidade: number
  custoCentavos: number
}

export interface Compra {
  id: string
  fornecedorId: string
  data: string
  documento: string
  linhas: LinhaCompra[]
  estado: 'rascunho' | 'recebida' | 'cancelada'
  recebidaEm?: string
  recebidaPor?: string
  pagamentos: { id: string; data: string; valorCentavos: number; conta: string }[]
}

export const CATEGORIAS_DESPESA = [
  'Renda',
  'Energia e água',
  'Salários',
  'Transporte',
  'Comunicações',
  'Manutenção',
  'Impostos e taxas',
  'Outros',
] as const

export interface Despesa {
  id: string
  data: string
  categoria: string
  descricao: string
  valorCentavos: number
  conta: 'caixa' | 'mpesa' | 'banco'
  sessaoId?: string
  autorId: string
  estado: 'activa' | 'anulada'
  motivoAnulacao?: string
}

export type TipoOperacao =
  | 'abertura_caixa'
  | 'venda'
  | 'cancelamento'
  | 'movimento_caixa'
  | 'fecho_caixa'
  | 'confirmacao_pausa'
  | 'confirmacao_retoma'

export interface Operacao {
  id: string
  sequencia: number
  tipo: TipoOperacao
  referenciaId: string
  descricao: string
  valorCentavos?: number
  autorId: string
  criadaEm: string
  estado: EstadoSync
  motivoConflito?: string
  resolucao?: string
}

export interface Simulacao {
  ligacao: 'online' | 'offline'
  pausaContagem: 'nenhuma' | 'em_pausa'
  ultimoContacto: string
}

export interface EstadoDemo {
  versao: number
  empresa: { nome: string; filial: string; codigoFilial: string; dispositivo: string; codigoDispositivo: string }
  utilizadores: Utilizador[]
  utilizadorActivoId: string | null
  categorias: Categoria[]
  produtos: Produto[]
  fornecedores: Fornecedor[]
  compras: Compra[]
  vendas: Venda[]
  sessoes: SessaoCaixa[]
  movimentos: MovimentoCaixa[]
  despesas: Despesa[]
  operacoes: Operacao[]
  simulacao: Simulacao
  proximoComprovativo: number
  proximaSequencia: number
}
