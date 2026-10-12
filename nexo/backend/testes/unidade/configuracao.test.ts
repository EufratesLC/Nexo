// Configuração validada no arranque e limpeza de segredos em logs.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ErroConfiguracao, lerConfiguracao } from '../../src/config/ambiente.js'
import { sanitizar } from '../../src/registo/sanitizar.js'

const pasta = mkdtempSync(join(tmpdir(), 'nexo-config-'))
const ca = join(pasta, 'ca.pem')
writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n')

test('valores por omissão em desenvolvimento, sem base de dados', () => {
  const c = lerConfiguracao({})
  assert.equal(c.ambiente, 'desenvolvimento')
  assert.equal(c.porta, 3001)
  assert.deepEqual(c.origensCors, ['http://localhost:5173'])
  assert.equal(c.base, null)
  assert.equal(c.provaAssinaturaActiva, true)
})

// Mínimo de produção desde a Etapa 3: endereço https e envio de e-mail real (SMTP).
const PRODUCAO_EMAIL = { NEXO_URL_APLICACAO: 'https://app.exemplo.co.mz', SMTP_SERVIDOR: 'smtp.exemplo.co.mz', EMAIL_REMETENTE: 'Nexo <nao-responder@exemplo.co.mz>' }

test('a prova de assinatura só fica activa em desenvolvimento', () => {
  assert.equal(lerConfiguracao({ NEXO_AMBIENTE: 'teste' }).provaAssinaturaActiva, false)
  const prod = lerConfiguracao({
    NEXO_AMBIENTE: 'producao',
    DATABASE_URL: 'postgresql://nexo_api.ref:x@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
    DB_CA_CERT_FICHEIRO: ca,
    ...PRODUCAO_EMAIL,
  })
  assert.equal(prod.provaAssinaturaActiva, false)
})

test('produção exige DATABASE_URL', () => {
  assert.throws(() => lerConfiguracao({ NEXO_AMBIENTE: 'producao' }), /DATABASE_URL: obrigatória em produção/)
})

test('recusa utilizadores administrativos na ligação da API (H-01, R3)', () => {
  for (const u of ['postgres', 'postgres.abcdef', 'service_role', 'supabase_admin', 'nexo_proprietario']) {
    assert.throws(
      () => lerConfiguracao({ DATABASE_URL: `postgresql://${u}:segredo@localhost:5432/postgres` }),
      (e: unknown) => e instanceof ErroConfiguracao && /administrativo ou ignora as políticas/.test(e.message),
      u,
    )
  }
})

test('servidor remoto exige certificado; sslmode que não valida é recusado', () => {
  const remoto = 'postgresql://nexo_api.ref:segredo@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'
  assert.throws(() => lerConfiguracao({ DATABASE_URL: remoto }), /exige DB_CA_CERT_FICHEIRO/)
  assert.throws(() => lerConfiguracao({ DATABASE_URL: `${remoto}?sslmode=no-verify`, DB_CA_CERT_FICHEIRO: ca }), /não valida o certificado/)
  const c = lerConfiguracao({ DATABASE_URL: `${remoto}?sslmode=require`, DB_CA_CERT_FICHEIRO: ca })
  assert.equal(c.base?.tls?.rejectUnauthorized, true)
  assert.ok(c.base?.tls?.ca.includes('BEGIN CERTIFICATE'))
  assert.ok(!c.base?.ligacao.includes('sslmode'), 'os parâmetros de TLS do URL são retirados')
  assert.equal(c.base?.descricao, 'aws-0-eu-west-1.pooler.supabase.com:6543')
})

test('a mensagem de erro de configuração não contém valores', () => {
  try {
    lerConfiguracao({ DATABASE_URL: 'postgresql://postgres:SenhaSecreta123@db.x.supabase.co:5432/postgres', PORT: 'abc' })
    assert.fail('devia falhar')
  } catch (e) {
    assert.ok(e instanceof ErroConfiguracao)
    assert.ok(!e.message.includes('SenhaSecreta123'))
    assert.ok(!e.message.includes('db.x.supabase.co'))
    assert.match(e.message, /PORT/)
  }
})

test('origens CORS inválidas são recusadas', () => {
  assert.throws(() => lerConfiguracao({ CORS_ORIGENS: 'http://localhost:5173, javascript:alert(1)' }), /origem inválida/)
  assert.deepEqual(lerConfiguracao({ CORS_ORIGENS: 'http://localhost:5173, https://app.exemplo' }).origensCors, [
    'http://localhost:5173',
    'https://app.exemplo',
  ])
})

test('sanitizar retira ligações, tokens, credenciais e palavras-passe', () => {
  const texto = [
    'falha em postgresql://nexo_api.ref:S3gr3d0@aws-0.pooler.supabase.com:6543/postgres',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXRlc3Rl',
    'Nexo-Dispositivo nd_4p7QabcdefghijKLMN',
    'password=abc123; senha: "x y z"; token=t0k3n',
  ].join('\n')
  const limpo = sanitizar(texto)
  for (const segredo of ['S3gr3d0', 'nexo_api.ref', 'eyJhbGci', 'nd_4p7Q', 'abc123', 'x y z', 't0k3n']) {
    assert.ok(!limpo.includes(segredo), `ficou "${segredo}" em: ${limpo}`)
  }
  assert.match(limpo, /postgresql:\/\/<omitido>@aws-0\.pooler\.supabase\.com/)
})
