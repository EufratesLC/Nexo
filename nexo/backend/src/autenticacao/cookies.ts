// Cookie da sessão: HttpOnly (o JavaScript da página não o lê), SameSite=Strict (não acompanha
// pedidos iniciados noutros sites), Path=/. Com Secure (sempre em produção) usa o prefixo __Host-,
// que o navegador só aceita com Secure, Path=/ e sem Domain.

import type { ConfiguracaoSessao } from '../config/ambiente.js'

export function nomeCookie(config: Pick<ConfiguracaoSessao, 'cookieSeguro'>): string {
  return config.cookieSeguro ? '__Host-nexo_sessao' : 'nexo_sessao'
}

export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=')
    if (i === -1) continue
    if (parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim()
  }
  return undefined
}

export function cookieSessao(config: ConfiguracaoSessao, token: string, maxAgeMs: number): string {
  const atributos = [`${nomeCookie(config)}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`]
  if (config.cookieSeguro) atributos.push('Secure')
  return atributos.join('; ')
}

export function cookieApagado(config: ConfiguracaoSessao): string {
  return cookieSessao(config, '', 0)
}
