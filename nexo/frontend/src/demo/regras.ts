// Regras de cálculo usadas pelo protótipo. Seguem a especificação (D.4, D.8),
// mas são uma demonstração: as regras reais correm no servidor.

import type { EstadoDemo, LinhaVenda, Produto, Utilizador, Venda } from './tipos'

export interface ItemCarrinho {
  produto: Produto
  quantidade: number
}

export interface Desconto {
  tipo: 'percentagem' | 'valor'
  /** Percentagem (0–100) ou valor em centavos. */
  valor: number
}

export interface CalculoVenda {
  linhas: LinhaVenda[]
  subtotalCentavos: number
  descontoCentavos: number
  totalCentavos: number
  /** Desconto efectivo em percentagem do subtotal, para verificar limites. */
  percentagemDesconto: number
}

/** Calcula a venda e reparte o desconto pelas linhas na proporção do seu valor (D.4.5). */
export function calcularVenda(carrinho: ItemCarrinho[], desconto: Desconto): CalculoVenda {
  const base = carrinho.map(({ produto, quantidade }) => ({
    produto,
    quantidade,
    valor: Math.round(produto.precoCentavos * quantidade),
  }))
  const subtotal = base.reduce((soma, l) => soma + l.valor, 0)
  let descontoTotal =
    desconto.tipo === 'percentagem'
      ? Math.round((subtotal * desconto.valor) / 100)
      : Math.round(desconto.valor)
  descontoTotal = Math.max(0, Math.min(descontoTotal, subtotal))

  const partes = base.map((l) => (subtotal === 0 ? 0 : Math.floor((descontoTotal * l.valor) / subtotal)))
  const resto = descontoTotal - partes.reduce((a, b) => a + b, 0)
  if (resto > 0 && base.length > 0) {
    let maior = 0
    base.forEach((l, i) => {
      if (l.valor > base[maior].valor) maior = i
    })
    partes[maior] += resto
  }

  const linhas: LinhaVenda[] = base.map((l, i) => ({
    produtoId: l.produto.id,
    nome: l.produto.nome,
    unidade: l.produto.unidade,
    quantidade: l.quantidade,
    precoCentavos: l.produto.precoCentavos,
    valorCentavos: l.valor,
    descontoCentavos: partes[i],
    liquidoCentavos: l.valor - partes[i],
    custoUnitCentavos: l.produto.custoCentavos,
  }))

  return {
    linhas,
    subtotalCentavos: subtotal,
    descontoCentavos: descontoTotal,
    totalCentavos: subtotal - descontoTotal,
    percentagemDesconto: subtotal === 0 ? 0 : (descontoTotal * 100) / subtotal,
  }
}

export function limitePermite(utilizador: Utilizador, percentagem: number): boolean {
  return utilizador.limiteDesconto === null || percentagem <= utilizador.limiteDesconto + 1e-9
}

export function podeGerir(utilizador: Utilizador | undefined): boolean {
  return utilizador?.papel === 'proprietario' || utilizador?.papel === 'gestor'
}

export function numerarioDaVenda(venda: Venda): number {
  return venda.pagamentos
    .filter((p) => p.metodo === 'numerario')
    .reduce((soma, p) => soma + p.valorCentavos, 0)
}

/** Valor esperado em numerário de uma sessão (D.8.6). Vendas canceladas têm estorno e anulam-se. */
export function esperadoCaixa(estado: EstadoDemo, sessaoId: string): number {
  const sessao = estado.sessoes.find((s) => s.id === sessaoId)
  if (!sessao) return 0
  const vendas = estado.vendas
    .filter((v) => v.sessaoId === sessaoId && v.estado === 'concluida')
    .reduce((soma, v) => soma + numerarioDaVenda(v), 0)
  const movimentos = estado.movimentos
    .filter((m) => m.sessaoId === sessaoId)
    .reduce((soma, m) => soma + (m.tipo === 'reforco' ? m.valorCentavos : -m.valorCentavos), 0)
  return sessao.fundoCentavos + vendas + movimentos
}

export function sessaoAberta(estado: EstadoDemo) {
  return estado.sessoes.find((s) => s.estado === 'aberta')
}

export function custoDaVenda(venda: Venda): number {
  return venda.linhas.reduce((soma, l) => soma + Math.round(l.custoUnitCentavos * l.quantidade), 0)
}

export const NOMES_METODO: Record<string, string> = {
  numerario: 'Numerário',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  mkesh: 'mKesh',
  cartao: 'Cartão / POS',
  transferencia: 'Transferência',
}

export const NOMES_PAPEL: Record<string, string> = {
  proprietario: 'Proprietário',
  gestor: 'Gestor',
  operador: 'Operador',
}
