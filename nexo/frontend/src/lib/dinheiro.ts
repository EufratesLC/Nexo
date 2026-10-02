// Valores monetários em centavos inteiros (especificação, convenções).

const ESPACO_MILHARES = ' '

export function formatarMzn(centavos: number): string {
  const negativo = centavos < 0
  const abs = Math.abs(Math.round(centavos))
  const inteiro = Math.floor(abs / 100)
  const decimais = String(abs % 100).padStart(2, '0')
  const agrupado = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ESPACO_MILHARES)
  return `${negativo ? '−' : ''}${agrupado},${decimais} MZN`
}

export function formatarValor(centavos: number): string {
  return formatarMzn(centavos).replace(' MZN', '')
}

/** Converte texto escrito pelo utilizador ("1 624,50", "1624.5") em centavos. */
export function lerMzn(texto: string): number | null {
  const limpo = texto.replace(/[\s  ]/g, '').replace(/MZN$/i, '')
  if (limpo === '') return null
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo
  if (!/^-?\d+(\.\d{0,2})?$/.test(normalizado)) return null
  return Math.round(Number(normalizado) * 100)
}

export function formatarQuantidade(quantidade: number, unidade: string): string {
  const texto = Number.isInteger(quantidade)
    ? String(quantidade)
    : quantidade.toFixed(3).replace(/0+$/, '').replace('.', ',')
  return `${texto} ${unidade}`
}

export function lerQuantidade(texto: string, fraccionavel: boolean): number | null {
  const normalizado = texto.trim().replace(',', '.')
  if (normalizado === '') return null
  const padrao = fraccionavel ? /^\d+(\.\d{1,3})?$/ : /^\d+$/
  if (!padrao.test(normalizado)) return null
  return Number(normalizado)
}
