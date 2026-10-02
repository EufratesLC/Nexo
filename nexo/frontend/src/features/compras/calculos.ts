import type { Compra } from '../../demo/tipos'

export function totalCompra(compra: Compra): number {
  return compra.linhas.reduce((s, l) => s + Math.round(l.quantidade * l.custoCentavos), 0)
}

export function pagoCompra(compra: Compra): number {
  return compra.pagamentos.reduce((s, p) => s + p.valorCentavos, 0)
}
