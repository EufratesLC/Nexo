// Verificação numérica da regra de custo efectivo proposta na revisão da Etapa 1
// (especificação 0.4, D.3.6, D.3.7 e D.3.11). NÃO é o módulo financeiro: é um modelo de referência
// mínimo que confere os exemplos dos documentos.
//
// Para cada cenário compara:
//   (a) o método incremental proposto: custo registado nunca reescrito + acertos;
//   (b) a repetição de todos os movimentos com o custo correcto, pela ordem de aplicação.
// A regra é exacta se (a) = (b) em stock, CMV e perdas, e se o valor se conserva.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const r2 = (x) => Math.round(x * 100) / 100

// Movimentos: rec {q, c}, venda {id, q}, cancel {id}, dev {id, q, avariada}
function repetir(movs) {
  let Q = 0
  let V = 0
  let cmv = 0
  let perdas = 0
  const itens = {}
  for (const m of movs) {
    if (m.t === 'rec') {
      Q += m.q
      V += m.q * m.c
    } else if (m.t === 'venda') {
      const c = (V / Q) * m.q
      itens[m.id] = { q: m.q, custo: c }
      Q -= m.q
      V -= c
      cmv += c
    } else if (m.t === 'cancel') {
      const it = itens[m.id]
      Q += it.q
      V += it.custo
      cmv -= it.custo
    } else if (m.t === 'dev') {
      const it = itens[m.id]
      const c = (it.custo * m.q) / it.q
      cmv -= c
      if (m.avariada) perdas += c
      else {
        Q += m.q
        V += c
      }
    }
  }
  return { Q, V: r2(V), cmv: r2(cmv), perdas: r2(perdas) }
}

// Método proposto. `ponto` = número de movimentos aplicados antes da correcção de custo.
function incremental(movs, indiceRec, custoNovo, ponto) {
  let Q = 0
  let V = 0
  let cmv = 0
  let perdas = 0
  const itens = {}
  const aplicar = (m) => {
    if (m.t === 'rec') {
      Q += m.q
      V += m.q * m.c
    } else if (m.t === 'venda') {
      const c = (V / Q) * m.q
      itens[m.id] = { q: m.q, registado: c, acertos: 0 }
      Q -= m.q
      V -= c
      cmv += c
    } else if (m.t === 'cancel') {
      const it = itens[m.id]
      const c = it.registado + it.acertos // custo efectivo
      Q += it.q
      V += c
      cmv -= c
    } else if (m.t === 'dev') {
      const it = itens[m.id]
      const c = ((it.registado + it.acertos) * m.q) / it.q // custo efectivo médio por unidade (A3)
      cmv -= c
      if (m.avariada) perdas += c
      else {
        Q += m.q
        V += c
      }
    }
  }
  const antes = movs.slice(0, ponto)
  antes.forEach(aplicar)

  // Correcção de custo (D.3.7 revista): percurso pela ordem de aplicação desde a recepção corrigida.
  const rec = movs[indiceRec]
  const E = rec.q * (custoNovo - rec.c)
  let resto = E
  let Qw = 0
  const partes = []
  const parteItem = {}
  for (let i = 0; i < antes.length; i++) {
    const m = antes[i]
    const q = m.t === 'cancel' ? itens[m.id].q : m.q
    if (i < indiceRec) {
      if (m.t === 'rec' || m.t === 'cancel' || (m.t === 'dev' && !m.avariada)) Qw += q
      else if (m.t === 'venda') Qw -= q
      continue
    }
    if (m.t === 'rec') Qw += q
    else if (m.t === 'venda') {
      const e = Qw > 0 ? (resto * q) / Qw : 0
      resto -= e
      Qw -= q
      parteItem[m.id] = e
      itens[m.id].acertos += e
      cmv += e
      partes.push({ destino: 'cmv', valor: e })
    } else if (m.t === 'cancel' || m.t === 'dev') {
      const e = ((parteItem[m.id] ?? 0) * q) / itens[m.id].q
      cmv -= e
      partes.push({ destino: 'cmv', valor: -e })
      if (m.t === 'dev' && m.avariada) {
        perdas += e
        partes.push({ destino: 'perdas', valor: e })
      } else {
        resto += e
        Qw += q
      }
    }
  }
  V += resto
  partes.push({ destino: 'stock', valor: resto })
  movs.slice(ponto).forEach(aplicar)
  return { Q, V: r2(V), cmv: r2(cmv), perdas: r2(perdas), E, partes }
}

// Exemplo D.3.9: R1 10 un a 50,00 (corrigida para 52,00), V1 4 un, R2 14 un a 60,00, V2 5 un.
const base = [
  { t: 'rec', q: 10, c: 50 },
  { t: 'venda', id: 'V1', q: 4 },
  { t: 'rec', q: 14, c: 60 },
  { t: 'venda', id: 'V2', q: 5 },
]
const comCustoCorrecto = (movs) => movs.map((m, i) => (i === 0 ? { ...m, c: 52 } : m))
const ENTRADAS = 500 + 840 + 20

const cenarios = [
  // nome, movimentos, ponto da correcção, esperado {Q, V, cmv, perdas}
  ['A: venda, correcção, cancelamento', [...base, { t: 'cancel', id: 'V2' }], 4, { Q: 20, V: 1152, cmv: 208, perdas: 0 }],
  ['B: venda, correcção, devolução parcial (2 un)', [...base, { t: 'dev', id: 'V2', q: 2 }], 4, { Q: 17, V: 979.2, cmv: 380.8, perdas: 0 }],
  ['C: venda, correcção, devolução avariada (2 un)', [...base, { t: 'dev', id: 'V2', q: 2, avariada: true }], 4, { Q: 15, V: 864, cmv: 380.8, perdas: 115.2 }],
  ['D1: devolução (2 un) antes da correcção', [...base, { t: 'dev', id: 'V2', q: 2 }], 5, { Q: 17, V: 979.2, cmv: 380.8, perdas: 0 }],
  ['D2: cancelamento antes da correcção', [...base, { t: 'cancel', id: 'V2' }], 5, { Q: 20, V: 1152, cmv: 208, perdas: 0 }],
  ['D3: devolução avariada antes da correcção', [...base, { t: 'dev', id: 'V2', q: 2, avariada: true }], 5, { Q: 15, V: 864, cmv: 380.8, perdas: 115.2 }],
  ['D4: devolução 2 un, correcção, devolução 3 un', [...base, { t: 'dev', id: 'V2', q: 2 }, { t: 'dev', id: 'V2', q: 3 }], 5, { Q: 20, V: 1152, cmv: 208, perdas: 0 }],
]

for (const [nome, movs, ponto, esperado] of cenarios) {
  test(nome, () => {
    const inc = incremental(movs, 0, 52, ponto)
    const exacto = repetir(comCustoCorrecto(movs))
    assert.deepEqual({ Q: inc.Q, V: inc.V, cmv: inc.cmv, perdas: inc.perdas }, esperado, 'valores documentados')
    assert.deepEqual({ Q: exacto.Q, V: exacto.V, cmv: exacto.cmv, perdas: exacto.perdas }, esperado, 'igual à repetição')
    assert.equal(r2(inc.cmv + inc.perdas + inc.V), ENTRADAS, 'conservação: entradas = CMV + perdas + stock')
    // Sem duplicação: CMV + perdas + stock das partes do acerto = erro total E.
    assert.equal(r2(inc.partes.reduce((s, p) => s + p.valor, 0)), r2(inc.E), 'partes do acerto = E')
  })
}

test('D1: partes do acerto de correcção (8,00 + 3,00 − 1,20 no CMV; 10,20 no stock)', () => {
  const inc = incremental([...base, { t: 'dev', id: 'V2', q: 2 }], 0, 52, 5)
  assert.deepEqual(
    inc.partes.map((p) => [p.destino, r2(p.valor)]),
    [['cmv', 8], ['cmv', 3], ['cmv', -1.2], ['stock', 10.2]],
  )
})

test('D3: devolução avariada antes da correcção — a parte devolvida passa do CMV para perdas', () => {
  const inc = incremental([...base, { t: 'dev', id: 'V2', q: 2, avariada: true }], 0, 52, 5)
  assert.deepEqual(
    inc.partes.map((p) => [p.destino, r2(p.valor)]),
    [['cmv', 8], ['cmv', 3], ['cmv', -1.2], ['perdas', 1.2], ['stock', 9]],
  )
})

test('E1: stock a 0 depois da recepção; a devolução traz de volta parte do erro', () => {
  const movs = [{ t: 'rec', q: 10, c: 50 }, { t: 'venda', id: 'V9', q: 10 }, { t: 'dev', id: 'V9', q: 3 }]
  const inc = incremental(movs, 0, 52, 3)
  const exacto = repetir(comCustoCorrecto(movs))
  assert.equal(inc.V, 156)
  assert.equal(inc.cmv, 364)
  assert.deepEqual([inc.V, inc.cmv], [exacto.V, exacto.cmv])
})

test('Regra 0.3 (A4) comparada: sem a correcção no custo efectivo, a devolução deixa 1,20 no CMV', () => {
  // Devolução de 2 un da V2 depois da correcção, usando só o custo registado (57,00/un) como na 0.3.
  const cmvA4 = 200 + 285 + 11 - 114
  const exacto = repetir(comCustoCorrecto([...base, { t: 'dev', id: 'V2', q: 2 }]))
  assert.equal(r2(cmvA4 - exacto.cmv), 1.2)
})
