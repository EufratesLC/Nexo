// Prova técnica isolada (Etapa 1, hipótese H-23): verificação no servidor de
// operações assinadas com ECDSA P-256 / SHA-256 através da Web Crypto API do
// Node (implementação documentada, sem algoritmos próprios).
//
// Não faz parte da API do Nexo. As chaves ficam em memória e desaparecem quando
// o servidor reinicia. Não usar com dados reais.

import { webcrypto } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { validar } from '../http/validar.js'

const subtle = webcrypto.subtle
const ALGORITMO_CHAVE = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ALGORITMO_ASSINATURA = { name: 'ECDSA', hash: 'SHA-256' } as const

export interface ChavePublicaRegistada {
  chaveId: string
  utilizador: string
  registo: string
  criadaEm: string
  /** Sequência a partir da qual a chave deixa de valer (exclusiva). null = activa. */
  encerradaApos: number | null
  chave: webcrypto.CryptoKey
}

export interface EnvelopeAssinado {
  chaveId: string
  /** Operação serializada exactamente como foi assinada (texto JSON). */
  conteudo: string
  /** Assinatura ECDSA em formato IEEE P1363 (r||s), base64url. */
  assinatura: string
}

export type ResultadoVerificacao =
  | { aceite: true; operacao: Record<string, unknown> }
  | { aceite: false; motivo: string }

export class ErroProva extends Error {}

export function criarArmazem() {
  const chaves = new Map<string, ChavePublicaRegistada>()
  let contador = 0

  return {
    async registar(jwk: webcrypto.JsonWebKey, utilizador: string, registo: string): Promise<ChavePublicaRegistada> {
      if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) throw new ErroProva('Chave pública EC P-256 inválida.')
      // Nunca aceitar material privado: a parte "d" só existiria se a chave privada tivesse sido exportada.
      if ('d' in jwk) throw new ErroProva('Recebido material de chave privada; pedido recusado.')
      if (!utilizador || !registo) throw new ErroProva('Indique utilizador e registo.')
      const chave = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, ALGORITMO_CHAVE, false, ['verify'])
      contador += 1
      const registada: ChavePublicaRegistada = {
        chaveId: `k${contador}-${registo}-${utilizador}`,
        utilizador,
        registo,
        criadaEm: new Date().toISOString(),
        encerradaApos: null,
        chave,
      }
      chaves.set(registada.chaveId, registada)
      return registada
    },

    encerrar(chaveId: string, aposSequencia: number): ChavePublicaRegistada {
      const chave = chaves.get(chaveId)
      if (!chave) throw new ErroProva('Chave desconhecida.')
      if (!Number.isInteger(aposSequencia) || aposSequencia < 0) throw new ErroProva('Sequência inválida.')
      chave.encerradaApos = aposSequencia
      return chave
    },

    async verificar(envelope: EnvelopeAssinado): Promise<ResultadoVerificacao> {
      const registada = chaves.get(envelope.chaveId)
      if (!registada) return { aceite: false, motivo: 'chave_desconhecida' }
      if (typeof envelope.assinatura !== 'string' || typeof envelope.conteudo !== 'string') {
        return { aceite: false, motivo: 'envelope_mal_formado' }
      }
      const assinatura = new Uint8Array(Buffer.from(envelope.assinatura, 'base64url'))
      if (assinatura.length !== 64) return { aceite: false, motivo: 'assinatura_mal_formada' }
      const valida = await subtle.verify(ALGORITMO_ASSINATURA, registada.chave, assinatura, new TextEncoder().encode(envelope.conteudo))
      if (!valida) return { aceite: false, motivo: 'assinatura_invalida' }

      let operacao: Record<string, unknown>
      try {
        operacao = JSON.parse(envelope.conteudo) as Record<string, unknown>
      } catch {
        return { aceite: false, motivo: 'conteudo_mal_formado' }
      }
      // A assinatura só vale para o autor e o registo a que a chave pertence (D.12.4.2).
      if (operacao.autor !== registada.utilizador || operacao.registo !== registada.registo) {
        return { aceite: false, motivo: 'autor_ou_registo_diferente_da_chave' }
      }
      const sequencia = operacao.sequencia
      if (typeof sequencia !== 'number' || !Number.isInteger(sequencia)) return { aceite: false, motivo: 'sequencia_invalida' }
      if (registada.encerradaApos !== null && sequencia > registada.encerradaApos) {
        return { aceite: false, motivo: 'chave_encerrada' }
      }
      return { aceite: true, operacao }
    },

    listar() {
      return Array.from(chaves.values()).map(({ chave: _chave, ...resto }) => resto)
    },

    limpar() {
      chaves.clear()
    },
  }
}

export function routerProvaAssinatura() {
  const armazem = criarArmazem()
  const resultados: unknown[] = []
  const router = Router()

  const tratar =
    (fn: (req: import('express').Request) => Promise<unknown> | unknown) =>
    async (req: import('express').Request, res: import('express').Response) => {
      try {
        res.json(await fn(req))
      } catch (erro) {
        if (erro instanceof ErroProva) res.status(400).json({ erro: { codigo: 'pedido_invalido', mensagem: erro.message } })
        else {
          req.log?.error({ err: erro }, 'erro na prova técnica')
          res.status(500).json({ erro: { codigo: 'erro_interno', mensagem: 'Erro inesperado na prova técnica.' } })
        }
      }
    }

  router.post(
    '/chaves',
    validar({
      corpo: z.object({ jwk: z.record(z.string(), z.unknown()), utilizador: z.string().min(1).max(100), registo: z.string().min(1).max(100) }),
    }),
    tratar(async (req) => {
      const { jwk, utilizador, registo } = req.body ?? {}
      const chave = await armazem.registar(jwk ?? {}, String(utilizador ?? ''), String(registo ?? ''))
      return { chaveId: chave.chaveId, criadaEm: chave.criadaEm }
    }),
  )

  router.post(
    '/chaves/:chaveId/encerrar',
    validar({ corpo: z.object({ aposSequencia: z.number().int().min(0) }) }),
    tratar((req) => {
      const chave = armazem.encerrar(String(req.params.chaveId), Number(req.body?.aposSequencia))
      return { chaveId: chave.chaveId, encerradaApos: chave.encerradaApos }
    }),
  )

  router.post(
    '/verificar',
    tratar(async (req) => {
      const inicio = performance.now()
      const resultado = await armazem.verificar(req.body as EnvelopeAssinado)
      return { ...resultado, verificacaoMs: Number((performance.now() - inicio).toFixed(3)) }
    }),
  )

  router.get('/chaves', tratar(() => armazem.listar()))

  // A página de teste envia aqui os seus resultados, para os ler sem interface gráfica.
  router.post(
    '/resultados',
    tratar((req) => {
      resultados.push({ recebidoEm: new Date().toISOString(), ...req.body })
      return { guardado: true, total: resultados.length }
    }),
  )
  router.get('/resultados', tratar(() => resultados))

  router.post(
    '/limpar',
    tratar(() => {
      armazem.limpar()
      resultados.length = 0
      return { limpo: true }
    }),
  )

  return router
}
