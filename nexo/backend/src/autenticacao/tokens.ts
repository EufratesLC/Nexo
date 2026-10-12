// Tokens aleatórios de 256 bits: sessão (cookie HttpOnly) e links de e-mail (confirmação e
// recuperação). A base guarda só o SHA-256; o token nunca é registado nem vai num URL enviado ao
// servidor (os links levam-no no fragmento #, que o navegador não envia).

import { createHash, randomBytes } from 'node:crypto'

export type TipoToken = 'sessao' | 'email'
const PREFIXOS: Record<TipoToken, string> = { sessao: 'ns_', email: 'ne_' }
// 32 bytes em base64url = 43 caracteres.
const FORMATO: Record<TipoToken, RegExp> = { sessao: /^ns_[A-Za-z0-9_-]{43}$/, email: /^ne_[A-Za-z0-9_-]{43}$/ }

export function gerarToken(tipo: TipoToken): { token: string; resumo: Buffer } {
  const token = PREFIXOS[tipo] + randomBytes(32).toString('base64url')
  return { token, resumo: resumoToken(token) }
}

export function resumoToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/** Formato válido (evita consultar a base com lixo). */
export function tokenValido(tipo: TipoToken, token: unknown): token is string {
  return typeof token === 'string' && FORMATO[tipo].test(token)
}
