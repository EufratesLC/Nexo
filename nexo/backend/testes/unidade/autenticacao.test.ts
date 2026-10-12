// Peças da autenticação sem base de dados: resumo scrypt e regras do código secreto, tokens,
// cookie, limitador de tentativas, configuração (sessão, e-mail, produção), transportes de e-mail
// (ficheiro, memória e SMTP contra um servidor SIMULADO) e limpeza de segredos nos logs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { calcularResumo, lerParametros, novoResumo, PARAMETROS_ACTUAIS, problemasDoCodigo } from '../../src/autenticacao/codigoSecreto.js'
import { cookieApagado, cookieSessao, lerCookie, nomeCookie } from '../../src/autenticacao/cookies.js'
import { chaveIdentificador, Limitador } from '../../src/autenticacao/limitador.js'
import { gerarToken, resumoToken, tokenValido } from '../../src/autenticacao/tokens.js'
import { lerConfiguracao } from '../../src/config/ambiente.js'
import { criarEnvioEmail, criarEnvioEmailMemoria, dominioDe } from '../../src/email/envio.js'
import { linkRecuperacao, mensagemRecuperacao } from '../../src/email/mensagens.js'
import { sanitizar } from '../../src/registo/sanitizar.js'

test('scrypt: mesmo código e sal dão o mesmo resumo; NFC; sal diferente dá outro; parâmetros ln=15,r=8,p=3', async () => {
  const r = await novoResumo('Cajú doce')
  assert.equal(r.parametros, PARAMETROS_ACTUAIS)
  assert.equal(r.sal.length, 16)
  assert.equal(r.resumo.length, 32)
  assert.ok((await calcularResumo('Cajú doce', r.sal, r.parametros)).equals(r.resumo))
  // "ú" composto (U+00FA) e decomposto (u + U+0301): o mesmo código para o utilizador.
  assert.ok((await calcularResumo('Cajú doce', r.sal, r.parametros)).equals(r.resumo))
  assert.ok(!(await calcularResumo('Cajú doce ', r.sal, r.parametros)).equals(r.resumo), 'espaços contam')
  const outro = await novoResumo('Cajú doce')
  assert.ok(!outro.resumo.equals(r.resumo), 'sal aleatório')
  assert.ok(!r.resumo.includes(Buffer.from('Cajú doce')), 'o resumo não contém o código')
})

test('scrypt: recusa parâmetros fracos ou excessivos', () => {
  assert.deepEqual(lerParametros('ln=15,r=8,p=3'), { N: 32768, r: 8, p: 3 })
  for (const p of ['ln=10,r=8,p=1', 'ln=15,r=1,p=1', 'ln=25,r=8,p=1', 'ln=15,r=8,p=99', 'bcrypt']) assert.throws(() => lerParametros(p), p)
})

test('regras do código secreto: não é um PIN; 8 a 128 caracteres; recusa o trivial', () => {
  assert.deepEqual(problemasDoCodigo('Caju verde 7'), [])
  assert.deepEqual(problemasDoCodigo('4829 1736 55'), [], 'algarismos com espaços são aceites se não forem triviais')
  assert.match(problemasDoCodigo('1234').join(), /pelo menos 8/)
  assert.match(problemasDoCodigo('12345678').join(), /comum/)
  assert.match(problemasDoCodigo('aaaaaaaaaa').join(), /repetido/)
  assert.match(problemasDoCodigo('ana-balcao-1', { nomeUtilizador: 'ana' }).join(), /nome de utilizador/)
  assert.match(problemasDoCodigo('x'.repeat(129)).join(), /no máximo/)
})

test('tokens: 256 bits, prefixo por tipo, só o SHA-256 vai para a base', () => {
  const s = gerarToken('sessao')
  const e = gerarToken('email')
  assert.match(s.token, /^ns_[A-Za-z0-9_-]{43}$/)
  assert.match(e.token, /^ne_[A-Za-z0-9_-]{43}$/)
  assert.ok(s.resumo.equals(createHash('sha256').update(s.token).digest()))
  assert.ok(resumoToken(s.token).equals(s.resumo))
  assert.ok(tokenValido('sessao', s.token) && !tokenValido('email', s.token) && !tokenValido('sessao', 'ns_curto') && !tokenValido('sessao', 42))
})

test('cookie: HttpOnly, SameSite=Strict; Secure e __Host- quando seguro; leitura entre outros cookies', () => {
  const dev = { duracaoMs: 1, inactividadeMs: 1, cookieSeguro: false }
  const seguro = { ...dev, cookieSeguro: true }
  assert.equal(cookieSessao(dev, 'ns_x', 3_600_000), 'nexo_sessao=ns_x; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600')
  assert.equal(cookieSessao(seguro, 'ns_x', 1000), '__Host-nexo_sessao=ns_x; Path=/; HttpOnly; SameSite=Strict; Max-Age=1; Secure')
  assert.match(cookieApagado(dev), /^nexo_sessao=; .*Max-Age=0$/)
  assert.equal(lerCookie('a=1; nexo_sessao=ns_abc; b=2', nomeCookie(dev)), 'ns_abc')
  assert.equal(lerCookie('nexo_sessao_falso=1', nomeCookie(dev)), undefined)
})

test('limitador: bloqueia ao fim do máximo, liberta no fim da janela, limpa no sucesso', () => {
  let agora = 0
  const l = new Limitador({ maximo: 3, janelaMs: 1000 }, { agora: () => agora })
  for (let i = 0; i < 3; i++) {
    assert.equal(l.esperaMs('k'), 0)
    l.registarFalha('k')
    agora += 100
  }
  assert.equal(l.esperaMs('k'), 700)
  agora = 1001
  assert.equal(l.esperaMs('k'), 0)
  l.registarFalha('k')
  l.limpar('k')
  assert.equal(l.esperaMs('k'), 0)
  assert.equal(chaveIdentificador(' Loja-A ', 'ANA'), chaveIdentificador('loja-a', 'ana'))
  const pequeno = new Limitador({ maximo: 1, janelaMs: 1000 }, { capacidade: 2, agora: () => 0 })
  for (const k of ['a', 'b', 'c']) pequeno.registarFalha(k)
  assert.equal(pequeno.esperaMs('a'), 0, 'a chave mais antiga sai quando a capacidade é excedida')
})

test('configuração: sessão e e-mail por omissão; produção exige https, SMTP e cookie seguro', () => {
  const c = lerConfiguracao({})
  assert.deepEqual(c.sessao, { duracaoMs: 12 * 3_600_000, inactividadeMs: 240 * 60_000, cookieSeguro: false })
  assert.deepEqual(c.email, { transporte: 'ficheiro', pasta: 'correio-dev' })
  assert.equal(c.urlAplicacao, 'http://localhost:5173')
  assert.throws(() => lerConfiguracao({ SESSAO_DURACAO_HORAS: '1', SESSAO_INACTIVIDADE_MINUTOS: '120' }), /SESSAO_INACTIVIDADE_MINUTOS/)
  assert.throws(() => lerConfiguracao({ EMAIL_TRANSPORTE: 'smtp' }), /SMTP_SERVIDOR[\s\S]*EMAIL_REMETENTE/)
  assert.throws(() => lerConfiguracao({ EMAIL_TRANSPORTE: 'smtp', SMTP_SERVIDOR: 's', EMAIL_REMETENTE: 'r@x.co', SMTP_UTILIZADOR: 'u' }), /SMTP_SENHA/)
  const prod = { NEXO_AMBIENTE: 'producao', DATABASE_URL: 'postgresql://nexo_api:x@localhost:5432/p' }
  const erro = (() => {
    try {
      lerConfiguracao({ ...prod, EMAIL_TRANSPORTE: 'ficheiro', SESSAO_COOKIE_SEGURO: 'nao' })
    } catch (e) {
      return (e as Error).message
    }
  })()
  assert.match(erro ?? '', /SESSAO_COOKIE_SEGURO/)
  assert.match(erro ?? '', /NEXO_URL_APLICACAO: em produção tem de ser https/)
  assert.match(erro ?? '', /EMAIL_TRANSPORTE: em produção só smtp/)
  const segura = lerConfiguracao({ NEXO_AMBIENTE: 'teste', SESSAO_COOKIE_SEGURO: 'sim' })
  assert.equal(segura.sessao.cookieSeguro, true)
  // As mensagens de erro da configuração nunca mostram valores.
  assert.throws(() => lerConfiguracao({ EMAIL_TRANSPORTE: 'smtp', SMTP_SERVIDOR: 's', EMAIL_REMETENTE: 'r', SMTP_SENHA: 'SegredoSMTP123' }), (e: Error) => !e.message.includes('SegredoSMTP123'))
})

test('e-mail (simulado): ficheiro grava a mensagem localmente; memória guarda; o domínio é o único dado em logs', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'nexo-correio-'))
  const envio = criarEnvioEmail({ transporte: 'ficheiro', pasta })
  const m = mensagemRecuperacao('dono@exemplo.co.mz', linkRecuperacao('http://localhost:5173', 'ne_' + 'a'.repeat(43)), 30)
  await envio.enviar(m)
  const [ficheiro] = readdirSync(pasta)
  assert.match(ficheiro, /recuperar_acesso/)
  const conteudo = readFileSync(join(pasta, ficheiro), 'utf8')
  assert.match(conteudo, /DESENVOLVIMENTO \(nada foi enviado\)/)
  assert.match(conteudo, /#\/recuperar-acesso\?token=ne_a{43}/)
  const memoria = criarEnvioEmailMemoria()
  await memoria.enviar(m)
  assert.equal((await memoria.esperar(1))[0].para, 'dono@exemplo.co.mz')
  assert.equal(dominioDe('dono@exemplo.co.mz'), '*@exemplo.co.mz')
  await assert.rejects(criarEnvioEmail({ transporte: 'desactivado' }).enviar(m), /desactivado/)
})

test('e-mail SMTP (servidor SIMULADO, sem TLS): recusa enviar sem STARTTLS — nunca manda o link em claro', async () => {
  const recebido: string[] = []
  const servidor = createServer((s) => {
    s.write('220 simulado ESMTP\r\n')
    s.on('data', (d) => {
      const linha = String(d)
      recebido.push(linha)
      if (/^EHLO/i.test(linha)) s.write('250-simulado\r\n250 AUTH PLAIN\r\n') // sem STARTTLS
      else if (/^QUIT/i.test(linha)) s.end('221 adeus\r\n')
      else s.write('250 ok\r\n')
    })
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
  const porta = (servidor.address() as AddressInfo).port
  try {
    const envio = criarEnvioEmail({ transporte: 'smtp', remetente: 'nexo@exemplo.co.mz', servidor: '127.0.0.1', porta, tlsImplicito: false, autenticacao: { utilizador: 'u', senha: 'SegredoSMTP' }, ca: null })
    await assert.rejects(envio.enviar(mensagemRecuperacao('dono@exemplo.co.mz', 'http://x/#/recuperar-acesso?token=ne_' + 'b'.repeat(43), 30)))
    const tudo = recebido.join('')
    assert.ok(!tudo.includes('ne_bbbb'), 'o link não chegou ao servidor')
    assert.ok(!tudo.includes('SegredoSMTP') && !/AUTH/i.test(tudo), 'as credenciais não foram enviadas')
  } finally {
    servidor.close()
  }
})

test('logs: tokens de sessão e de e-mail, cookie e códigos em JSON são omitidos', () => {
  const t = 'ns_' + 'Q'.repeat(43)
  const e = 'ne_' + 'Z'.repeat(43)
  const texto = sanitizar(`cookie nexo_sessao=${t}; link #/x?token=${e} {"codigoSecreto":"Caju verde 7","codigoNovo": "outro"}`)
  assert.ok(!texto.includes(t) && !texto.includes(e) && !texto.includes('Caju verde 7') && !texto.includes('outro'), texto)
})
