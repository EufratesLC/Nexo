// Encerramento ordenado com um servidor HTTP real e uma base SIMULADA.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { AcessoBase } from '../../src/base/acesso.js'
import { criarEncerramento } from '../../src/encerramento.js'
import { criarLogger } from '../../src/registo/logger.js'

test('termina os pedidos em curso, fecha a base depois do HTTP e sai com 0', async () => {
  const ordem: string[] = []
  const servidor = createServer((_req, res) => {
    setTimeout(() => {
      ordem.push('pedido terminado')
      res.end('ok')
    }, 150)
  })
  await new Promise<void>((r) => servidor.listen(0, () => r()))
  const porta = (servidor.address() as AddressInfo).port
  const base: AcessoBase = {
    executarTransaccao: async () => null as never,
    diagnosticar: async () => ({ disponivel: false, papelSeguro: null, versaoMigracao: null }),
    encerrar: async () => {
      ordem.push('base fechada')
    },
  }
  let codigo: number | undefined
  const encerrar = criarEncerramento({ servidor, base, logger: criarLogger('silent'), sair: (c) => (codigo = c) })

  const pedidoEmCurso = fetch(`http://127.0.0.1:${porta}/`).then((r) => r.text())
  await new Promise((r) => setTimeout(r, 30))
  const fim = encerrar('teste')
  assert.equal(encerrar('outra vez'), fim, 'um segundo sinal não repete o encerramento')
  assert.equal(await pedidoEmCurso, 'ok')
  await fim
  assert.deepEqual(ordem, ['pedido terminado', 'base fechada'])
  assert.equal(codigo, 0)
  await assert.rejects(fetch(`http://127.0.0.1:${porta}/`), 'depois de encerrar já não aceita ligações')
})

test('se demorar demasiado, termina à força com código 1', async () => {
  const servidor = createServer(() => {
    // pedido que nunca responde
  })
  await new Promise<void>((r) => servidor.listen(0, () => r()))
  const porta = (servidor.address() as AddressInfo).port
  const controlo = new AbortController()
  fetch(`http://127.0.0.1:${porta}/`, { signal: controlo.signal }).catch(() => {})
  await new Promise((r) => setTimeout(r, 30))
  let codigo: number | undefined
  const base: AcessoBase = { executarTransaccao: async () => null as never, diagnosticar: async () => ({ disponivel: false, papelSeguro: null, versaoMigracao: null }), encerrar: async () => {} }
  void criarEncerramento({ servidor, base, logger: criarLogger('silent'), sair: (c) => (codigo = c), tempoLimiteMs: 100 })('teste')
  await new Promise((r) => setTimeout(r, 250))
  assert.equal(codigo, 1)
  controlo.abort()
  servidor.closeAllConnections()
})
