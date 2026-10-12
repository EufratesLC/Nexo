// Diagnóstico das ligações (sem rede): forma dos URLs, comparação de palavras-passe sem as revelar
// e classificação dos erros de ligação, incluindo o bloqueio do pooler (ECIRCUITBREAKER).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analisarLigacao, classificarFalha, mesmaPalavraPasse } from '../../src/base/migracoes/diagnosticoLigacoes.js'

const POOLER = 'aws-0-eu-west-1.pooler.supabase.com'

test('URL correcto do Transaction pooler: sem problemas; nada da palavra-passe no resultado', () => {
  const a = analisarLigacao('NEXO_TESTE_API_URL', `postgresql://nexo_api.abcref:Segredo%40Forte123@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.deepEqual(a.problemas, [])
  assert.equal(a.ref, 'abcref')
  assert.equal(a.destino, `${POOLER}:6543`)
  assert.ok(!JSON.stringify(a).includes('Segredo'), 'a análise não contém a palavra-passe')
})

test('detecta "@", "#", "/" e "%" inválido por codificar, falta da ref no pooler, papel e porta errados, sslmode', () => {
  const arroba = analisarLigacao('X', `postgresql://nexo_api.r:ab@cd@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.match(arroba.problemas.join(), /"@" sem codificação/)
  const cardinal = analisarLigacao('X', `postgresql://nexo_api.r:ab#cd@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.match(cardinal.problemas.join(), /"#"|não é um URL válido/)
  const percent = analisarLigacao('X', `postgresql://nexo_api.r:ab%zzcd@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.match(percent.problemas.join(), /"%"/)
  const semRef = analisarLigacao('X', `postgresql://nexo_api:x@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.match(semRef.problemas.join(), /nexo_api\.<ref>/)
  const papel = analisarLigacao('X', `postgresql://postgres.r:x@${POOLER}:6543/postgres`, { papel: 'nexo_api', porta: 6543 })
  assert.match(papel.problemas.join(), /devia ser nexo_api/)
  const porta = analisarLigacao('X', `postgresql://nexo_api.r:x@${POOLER}:5432/postgres?sslmode=require`, { papel: 'nexo_api', porta: 6543 })
  assert.match(porta.avisos.join(), /porta 5432/)
  assert.match(porta.avisos.join(), /sslmode/)
})

test('compara palavras-passe entre variáveis sem as devolver', () => {
  analisarLigacao('A1', `postgresql://nexo_api.r:igual1234567890@${POOLER}:6543/postgres`, { papel: 'nexo_api' })
  analisarLigacao('A2', `postgresql://nexo_api.r:igual1234567890@${POOLER}:6543/postgres`, { papel: 'nexo_api' })
  analisarLigacao('A3', `postgresql://nexo_api.r:outra1234567890@${POOLER}:6543/postgres`, { papel: 'nexo_api' })
  assert.equal(mesmaPalavraPasse('A1', 'A2'), true)
  assert.equal(mesmaPalavraPasse('A1', 'A3'), false)
  assert.equal(mesmaPalavraPasse('A1', 'nao-definida'), undefined)
})

test('classifica os erros de ligação', () => {
  assert.equal(classificarFalha({ code: 'XX000', message: '(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked' }).causa, 'bloqueio_temporario_do_pooler')
  assert.equal(classificarFalha({ code: '28P01', message: 'password authentication failed for user "nexo_api"' }).causa, 'palavra_passe_recusada')
  assert.equal(classificarFalha({ code: 'XX000', message: 'Tenant or user not found' }).causa, 'utilizador_ou_projecto_desconhecido')
  assert.equal(classificarFalha(new Error('self-signed certificate in certificate chain')).causa, 'certificado')
  assert.equal(classificarFalha(new Error('Connection terminated due to connection timeout')).causa, 'tempo_esgotado')
  assert.equal(classificarFalha({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }).causa, 'servidor_inacessivel')
})
