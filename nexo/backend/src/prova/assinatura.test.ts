// Testes da verificação no servidor (prova técnica H-23). Correm só em Node:
// geram chaves com a Web Crypto API do Node, como faria o navegador.

import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { describe, it } from 'node:test'
import { criarArmazem, ErroProva } from './assinatura.js'

const subtle = webcrypto.subtle

async function novoPar() {
  return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

async function assinar(chave: webcrypto.CryptoKey, operacao: object) {
  const conteudo = JSON.stringify(operacao)
  const assinatura = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, new TextEncoder().encode(conteudo))
  return { conteudo, assinatura: Buffer.from(assinatura).toString('base64url') }
}

const operacao = (sequencia: number, extra: object = {}) => ({
  id: `op-${sequencia}`,
  versao: 1,
  tipo: 'venda',
  registo: 'C01',
  autor: 'u-ana',
  sequencia,
  conteudo: { total: 162450 },
  ...extra,
})

describe('prova de assinatura por utilizador e dispositivo', () => {
  it('a chave privada gerada como não exportável não pode ser exportada', async () => {
    const par = await novoPar()
    assert.equal(par.privateKey.extractable, false)
    await assert.rejects(subtle.exportKey('jwk', par.privateKey))
  })

  it('aceita uma operação bem assinada e recusa conteúdo alterado', async () => {
    const armazem = criarArmazem()
    const par = await novoPar()
    const registada = await armazem.registar(await subtle.exportKey('jwk', par.publicKey), 'u-ana', 'C01')
    const env = await assinar(par.privateKey, operacao(1))

    const ok = await armazem.verificar({ chaveId: registada.chaveId, ...env })
    assert.equal(ok.aceite, true)

    const alterado = env.conteudo.replace('162450', '100')
    const mau = await armazem.verificar({ chaveId: registada.chaveId, conteudo: alterado, assinatura: env.assinatura })
    assert.deepEqual(mau, { aceite: false, motivo: 'assinatura_invalida' })
  })

  it('recusa assinatura de outra chave e autor diferente do da chave', async () => {
    const armazem = criarArmazem()
    const ana = await novoPar()
    const intruso = await novoPar()
    const registada = await armazem.registar(await subtle.exportKey('jwk', ana.publicKey), 'u-ana', 'C01')

    const deOutraChave = await assinar(intruso.privateKey, operacao(2))
    assert.deepEqual(await armazem.verificar({ chaveId: registada.chaveId, ...deOutraChave }), {
      aceite: false,
      motivo: 'assinatura_invalida',
    })

    const outroAutor = await assinar(ana.privateKey, operacao(3, { autor: 'u-carlos' }))
    assert.deepEqual(await armazem.verificar({ chaveId: registada.chaveId, ...outroAutor }), {
      aceite: false,
      motivo: 'autor_ou_registo_diferente_da_chave',
    })
  })

  it('depois de encerrada, aceita só operações até à sequência de encerramento', async () => {
    const armazem = criarArmazem()
    const par = await novoPar()
    const registada = await armazem.registar(await subtle.exportKey('jwk', par.publicKey), 'u-ana', 'C01')
    armazem.encerrar(registada.chaveId, 5)
    assert.equal((await armazem.verificar({ chaveId: registada.chaveId, ...(await assinar(par.privateKey, operacao(5))) })).aceite, true)
    assert.deepEqual(await armazem.verificar({ chaveId: registada.chaveId, ...(await assinar(par.privateKey, operacao(6))) }), {
      aceite: false,
      motivo: 'chave_encerrada',
    })
  })

  it('recusa registar material de chave privada', async () => {
    const armazem = criarArmazem()
    const exportavel = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const privadaJwk = await subtle.exportKey('jwk', exportavel.privateKey)
    await assert.rejects(armazem.registar(privadaJwk, 'u-ana', 'C01'), ErroProva)
  })

  it('mede tempos de assinatura e verificação em Node (informativo)', async () => {
    const armazem = criarArmazem()
    const par = await novoPar()
    const registada = await armazem.registar(await subtle.exportKey('jwk', par.publicKey), 'u-ana', 'C01')
    const n = 200
    const tAssinar: number[] = []
    const tVerificar: number[] = []
    for (let i = 1; i <= n; i++) {
      let t = performance.now()
      const env = await assinar(par.privateKey, operacao(i))
      tAssinar.push(performance.now() - t)
      t = performance.now()
      const r = await armazem.verificar({ chaveId: registada.chaveId, ...env })
      tVerificar.push(performance.now() - t)
      assert.equal(r.aceite, true)
    }
    const resumo = (v: number[]) => {
      const o = [...v].sort((a, b) => a - b)
      return `média ${(o.reduce((a, b) => a + b, 0) / o.length).toFixed(3)} ms, mediana ${o[Math.floor(o.length / 2)].toFixed(3)} ms, p95 ${o[Math.floor(o.length * 0.95)].toFixed(3)} ms`
    }
    console.log(`[tempos Node ${process.version}] assinar: ${resumo(tAssinar)} | verificar: ${resumo(tVerificar)}`)
  })
})
