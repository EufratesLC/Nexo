// Executor de migrações (com um cliente SIMULADO) e resumo SCRAM da palavra-passe de nexo_api.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { aplicarMigracoes, lerMigracoes, resumoScram, type ClienteMigracoes } from '../../src/base/migracoes/executor.js'

const PASTA = join(import.meta.dirname, '..', '..', 'migracoes')

test('as migrações do projecto são válidas, ordenadas e não usam o esquema de teste nexo_iso', () => {
  const ms = lerMigracoes(PASTA)
  assert.deepEqual(
    ms.map((m) => `${m.versao}_${m.nome}:${m.executarComo}`),
    ['0001_papeis_e_esquemas:administrador', '0002_contexto:nexo_proprietario', '0003_empresas_e_filiais:nexo_proprietario', '0004_diagnostico:administrador'],
  )
  for (const m of ms) {
    assert.ok(!/nexo_iso/.test(m.conteudo), `${m.ficheiro} refere nexo_iso`)
    // Fora de comentários e de textos (mensagens, verificações), a palavra BYPASSRLS não pode aparecer.
    const codigo = m.conteudo.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''")
    assert.ok(!/\bBYPASSRLS\b/i.test(codigo), `${m.ficheiro} concede BYPASSRLS`)
    assert.ok(!/\bDROP\s+(TABLE|SCHEMA|ROLE)\b/i.test(m.conteudo), `${m.ficheiro} apaga objectos`)
    assert.ok(!/\bservice_role\b/.test(m.conteudo), `${m.ficheiro} refere service_role`)
  }
})

test('R5: a transferência de dono dá CREATE temporário e retira-o', () => {
  const m1 = lerMigracoes(PASTA)[0].conteudo
  const corpo = m1.slice(m1.indexOf('PROCEDURE nexo_controlo.transferir_dono_funcao'))
  const grant = corpo.indexOf("'GRANT CREATE ON SCHEMA")
  const alter = corpo.indexOf("'ALTER FUNCTION")
  const revoke = corpo.indexOf("'REVOKE CREATE ON SCHEMA")
  assert.ok(grant > 0 && grant < alter && alter < revoke, 'ordem GRANT CREATE → ALTER OWNER → REVOKE CREATE')
  assert.match(lerMigracoes(PASTA)[3].conteudo, /CALL nexo_controlo\.transferir_dono_funcao\('nexo\.estado_base\(\)'/)
})

test('0001 funciona sem superutilizador: só LOGIN/INHERIT em CREATE/ALTER ROLE; atributos perigosos verificados no catálogo', () => {
  const m1 = lerMigracoes(PASTA)[0].conteudo
  const instrucoes = m1.replace(/--.*$/gm, '')
  // Nenhum CREATE/ALTER ROLE indica atributos que exigem superutilizador (nem como "NO…").
  for (const m of instrucoes.matchAll(/'(CREATE|ALTER) ROLE[^']*'/g)) {
    assert.equal(m[0].replace(/%[Is]|\s/g, ''), `'${m[1]}ROLE'`, `instrução com atributos fixos: ${m[0]}`)
  }
  assert.ok(!/\bALTER ROLE\b[^;]*\b(NOSUPERUSER|NOREPLICATION|NOBYPASSRLS)\b/i.test(instrucoes), 'ALTER ROLE com NOSUPERUSER/NOREPLICATION/NOBYPASSRLS')
  for (const coluna of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) {
    assert.ok(instrucoes.includes(`r.${coluna}`), `0001 tem de verificar ${coluna} dos papéis existentes`)
  }
  assert.match(instrucoes, /RAISE EXCEPTION 'o papel % já existe com atributos proibidos/)
  assert.match(instrucoes, /GRANT nexo_operador, nexo_gestao, nexo_sincronizacao TO nexo_api WITH INHERIT FALSE, SET TRUE/)
  assert.match(instrucoes, /pg_has_role\(current_user, p_dono, 'SET'\)/, 'a transferência confirma que o SET temporário foi retirado')
})

test('0004: privilégios da função definidos ANTES de transferir o dono', () => {
  const m4 = lerMigracoes(PASTA)[3].conteudo
  const revoke = m4.indexOf('REVOKE ALL ON FUNCTION nexo.estado_base() FROM PUBLIC')
  const grant = m4.indexOf('GRANT EXECUTE ON FUNCTION nexo.estado_base() TO nexo_api')
  const call = m4.indexOf('CALL nexo_controlo.transferir_dono_funcao')
  assert.ok(revoke > 0 && grant > revoke && call > grant, 'ordem REVOKE → GRANT → CALL')
})

test('BEGIN/END dentro de corpos $$…$$ são aceites; controlo de transacção fora deles não', () => {
  const p = mkdtempSync(join(tmpdir(), 'nexo-mig-'))
  writeFileSync(join(p, '0001_x.sql'), "-- nexo:executar-como administrador\nDO $$\nBEGIN\n  BEGIN\n    PERFORM 1;\n  EXCEPTION WHEN others THEN NULL;\n  END;\nEND\n$$;\n")
  assert.equal(lerMigracoes(p).length, 1)
  const p2 = mkdtempSync(join(tmpdir(), 'nexo-mig-'))
  writeFileSync(join(p2, '0001_x.sql'), '-- nexo:executar-como administrador\nDO $$ BEGIN END $$;\nCOMMIT;\n')
  assert.throws(() => lerMigracoes(p2), /BEGIN\/COMMIT/)
})

test('ficheiros inválidos são recusados', () => {
  const p = mkdtempSync(join(tmpdir(), 'nexo-mig-'))
  writeFileSync(join(p, '0001_x.sql'), 'SELECT 1;')
  assert.throws(() => lerMigracoes(p), /primeira linha/)
  const p2 = mkdtempSync(join(tmpdir(), 'nexo-mig-'))
  writeFileSync(join(p2, '0001_x.sql'), '-- nexo:executar-como administrador\nBEGIN;\nSELECT 1;\nCOMMIT;')
  assert.throws(() => lerMigracoes(p2), /BEGIN\/COMMIT/)
  const p3 = mkdtempSync(join(tmpdir(), 'nexo-mig-'))
  writeFileSync(join(p3, 'migracao.sql'), '-- nexo:executar-como administrador\n')
  assert.throws(() => lerMigracoes(p3), /nome de migração inválido/)
})

function clienteSimulado(aplicadas: { versao: string; nome: string; resumo: string }[], falharEm?: string) {
  const comandos: string[] = []
  const cliente: ClienteMigracoes = {
    async query(texto, valores) {
      comandos.push(texto.trim().split('\n')[0])
      if (falharEm && texto.includes(falharEm)) throw new Error('falha simulada')
      if (texto.includes('to_regclass')) return { rows: [{ existe: true }] }
      if (texto.startsWith('SELECT versao, nome, resumo')) return { rows: aplicadas.map((a) => ({ ...a, aplicada_em: '2026-10-03T10:00:00Z' })) }
      if (texto.startsWith('INSERT INTO nexo_controlo.migracoes')) aplicadas.push({ versao: String(valores?.[0]), nome: String(valores?.[1]), resumo: String(valores?.[2]) })
      return { rows: [] }
    },
  }
  return { cliente, comandos }
}

test('aplica só as pendentes, cada uma na sua transacção, com o papel indicado', async () => {
  const ms = lerMigracoes(PASTA)
  const { cliente, comandos } = clienteSimulado([{ versao: ms[0].versao, nome: ms[0].nome, resumo: ms[0].resumo }])
  const aplicadas = await aplicarMigracoes(cliente, ms)
  assert.deepEqual(aplicadas.map((m) => m.versao), ['0002', '0003', '0004'])
  assert.equal(comandos.filter((c) => c === 'BEGIN').length, 3)
  assert.equal(comandos.filter((c) => c === 'COMMIT').length, 3)
  assert.equal(comandos.filter((c) => c === 'SET LOCAL ROLE nexo_proprietario').length, 2)
  assert.ok(comandos[0].includes('pg_advisory_lock'))
  assert.ok(comandos.at(-1)?.includes('pg_advisory_unlock'))
})

test('uma migração aplicada que foi alterada impede continuar', async () => {
  const ms = lerMigracoes(PASTA)
  const { cliente } = clienteSimulado([{ versao: '0001', nome: ms[0].nome, resumo: 'resumo-antigo' }])
  await assert.rejects(aplicarMigracoes(cliente, ms), /foram alteradas depois de aplicadas/)
})

test('uma falha desfaz a migração (ROLLBACK) e pára', async () => {
  const ms = lerMigracoes(PASTA)
  const { cliente, comandos } = clienteSimulado([], 'CREATE TABLE nexo.empresas')
  await assert.rejects(aplicarMigracoes(cliente, ms), /falhou a migração 0003_empresas_e_filiais\.sql/)
  assert.ok(comandos.includes('ROLLBACK'))
  assert.ok(comandos.at(-1)?.includes('pg_advisory_unlock'))
})

test('SCRAM-SHA-256: confere com o vector de teste da RFC 7677', () => {
  // RFC 7677, secção 3: utilizador "user", palavra-passe "pencil".
  const sal = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
  const resumo = resumoScram('pencil', sal, 4096)
  const [, chaves] = resumo.split('$').slice(1)
  const [guardadaB64, servidorB64] = chaves.split(':')
  const auth =
    'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
    'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
    'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0'
  // Assinatura do servidor publicada na RFC.
  const assinaturaServidor = createHmac('sha256', Buffer.from(servidorB64, 'base64')).update(auth).digest('base64')
  assert.equal(assinaturaServidor, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=')
  // A prova do cliente publicada na RFC, recuperada com StoredKey: H(prova XOR assinatura) = StoredKey.
  const prova = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64')
  const assinaturaCliente = createHmac('sha256', Buffer.from(guardadaB64, 'base64')).update(auth).digest()
  const chaveCliente = Buffer.from(prova.map((b, i) => b ^ assinaturaCliente[i]))
  assert.equal(createHash('sha256').update(chaveCliente).digest('base64'), guardadaB64)
  assert.match(resumo, /^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$/)
})
