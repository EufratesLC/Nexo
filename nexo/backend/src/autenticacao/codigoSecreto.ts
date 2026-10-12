// Códigos secretos de acesso (H-02): funcionam como palavras-passe. Não são PIN nem identificadores.
//
// - Guardados só como resumo scrypt (função de derivação lenta e com memória, própria para
//   palavras-passe, incluída no Node): N = 2^15, r = 8, p = 3 (32 MiB por cálculo), sal aleatório
//   de 16 bytes, resumo de 32 bytes. Os parâmetros ficam guardados com cada resumo
//   ("ln=15,r=8,p=3"), para poderem subir sem invalidar os códigos existentes.
// - O código é normalizado em Unicode (NFC) antes do cálculo: o mesmo texto escrito em teclados
//   diferentes dá o mesmo resumo. Não se cortam espaços: fazem parte do código.
// - O resumo é calculado na API; a comparação com o guardado faz-se na base (0007), e o resumo
//   guardado nunca sai da base.

import { randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto'

export const PARAMETROS_ACTUAIS = 'ln=15,r=8,p=3'
const COMPRIMENTO_SAL = 16
const COMPRIMENTO_RESUMO = 32
export const CODIGO_MIN = 8
export const CODIGO_MAX = 128

function scrypt(segredo: string, sal: Buffer, opcoes: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(segredo, sal, COMPRIMENTO_RESUMO, opcoes, (erro, chave) => (erro ? reject(erro) : resolve(chave))),
  )
}

export function lerParametros(texto: string): { N: number; r: number; p: number } {
  const m = /^ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})$/.exec(texto)
  if (!m) throw new Error('parâmetros scrypt inválidos')
  const ln = Number(m[1])
  const r = Number(m[2])
  const p = Number(m[3])
  // Limites para não aceitar parâmetros fracos nem cálculos que esgotem a memória.
  if (ln < 14 || ln > 20 || r < 8 || r > 16 || p < 1 || p > 16) throw new Error('parâmetros scrypt fora dos limites')
  return { N: 2 ** ln, r, p }
}

export async function calcularResumo(codigo: string, sal: Buffer, parametros: string): Promise<Buffer> {
  const { N, r, p } = lerParametros(parametros)
  if (sal.length !== COMPRIMENTO_SAL) throw new Error('sal inválido')
  return scrypt(codigo.normalize('NFC'), sal, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 })
}

export async function novoResumo(codigo: string): Promise<{ parametros: string; sal: Buffer; resumo: Buffer }> {
  const sal = randomBytes(COMPRIMENTO_SAL)
  return { parametros: PARAMETROS_ACTUAIS, sal, resumo: await calcularResumo(codigo, sal, PARAMETROS_ACTUAIS) }
}

/**
 * Cálculo com o mesmo custo para contas que não existem: o tempo de resposta do login não revela
 * se a conta existe. O resultado nunca corresponde a nenhum resumo guardado (sal aleatório).
 */
export async function resumoFicticio(codigo: string): Promise<Buffer> {
  return calcularResumo(codigo, randomBytes(COMPRIMENTO_SAL), PARAMETROS_ACTUAIS)
}

const DEMASIADO_COMUNS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', 'password', 'password1',
  'palavrapasse', 'qwertyui', 'qwerty123', 'abcdefgh', 'abc12345', 'nexo1234', 'mocambique', 'moçambique',
  'maputo123', 'iloveyou', 'admin123', 'senha123', 'codigo123',
])

/**
 * Regras do código secreto (proposta, NIST SP 800-63B): 8 a 128 caracteres, qualquer carácter.
 * Sem regras de composição; recusa só o que é trivial de adivinhar.
 */
export function problemasDoCodigo(codigo: string, contexto: { nomeUtilizador?: string; codigoEmpresa?: string } = {}): string[] {
  const c = codigo.normalize('NFC')
  const problemas: string[] = []
  const tamanho = [...c].length
  if (tamanho < CODIGO_MIN) problemas.push(`Use pelo menos ${CODIGO_MIN} caracteres.`)
  if (tamanho > CODIGO_MAX) problemas.push(`Use no máximo ${CODIGO_MAX} caracteres.`)
  if (tamanho >= CODIGO_MIN) {
    const minusculas = c.toLowerCase()
    if (DEMASIADO_COMUNS.has(minusculas)) problemas.push('Este código é demasiado comum.')
    if (/^(.)\1+$/u.test(c)) problemas.push('Não use o mesmo carácter repetido.')
    for (const valor of [contexto.nomeUtilizador, contexto.codigoEmpresa]) {
      if (valor && valor.length >= 3 && minusculas.includes(valor.toLowerCase())) {
        problemas.push('O código não pode conter o nome de utilizador nem o código da empresa.')
        break
      }
    }
  }
  return problemas
}
