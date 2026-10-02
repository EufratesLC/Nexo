// Divide um ficheiro SQL em instruções, respeitando comentários, textos e corpos $$…$$.
export function dividirSql(sql) {
  const instrucoes = []
  let actual = ''
  let i = 0
  let emDolar = false
  let emTexto = false
  while (i < sql.length) {
    const c = sql[i]
    if (!emDolar && !emTexto && c === '-' && sql[i + 1] === '-') {
      const fim = sql.indexOf('\n', i)
      i = fim === -1 ? sql.length : fim
      continue
    }
    if (!emTexto && c === '$' && sql[i + 1] === '$') {
      emDolar = !emDolar
      actual += '$$'
      i += 2
      continue
    }
    if (!emDolar && c === "'") emTexto = !emTexto
    if (!emDolar && !emTexto && c === ';') {
      if (actual.trim()) instrucoes.push(actual.trim())
      actual = ''
      i++
      continue
    }
    actual += c
    i++
  }
  if (actual.trim()) instrucoes.push(actual.trim())
  return instrucoes
}
