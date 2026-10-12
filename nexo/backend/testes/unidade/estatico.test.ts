// Regras verificadas no código-fonte (H-01, R3 e R4). Falham se alguém introduzir um atalho.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const RAIZ = join(import.meta.dirname, '..', '..')
const SRC = join(RAIZ, 'src')

function ficheiros(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const p = join(pasta, n)
    return statSync(p).isDirectory() ? ficheiros(p) : p.endsWith('.ts') ? [p] : []
  })
}
const fontes = ficheiros(SRC).map((p) => ({ caminho: relative(RAIZ, p).replace(/\\/g, '/'), texto: readFileSync(p, 'utf8') }))
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('R4: nenhum código define contexto ao nível da sessão nem muda de papel fora do módulo de acesso', () => {
  for (const f of fontes) {
    const t = semComentarios(f.texto)
    assert.ok(!/set_config\s*\([^)]*,\s*false\s*\)/i.test(t), `${f.caminho}: set_config(…, false)`)
    assert.ok(!/SET\s+SESSION\b/i.test(t), `${f.caminho}: SET SESSION`)
    if (f.caminho !== 'src/base/acesso.ts' && !f.caminho.startsWith('src/base/migracoes/')) {
      assert.ok(!/SET\s+(LOCAL\s+)?ROLE\b/i.test(t), `${f.caminho}: SET ROLE fora de src/base/acesso.ts`)
    }
  }
})

test('R3: a API não usa credenciais administrativas nem a de serviço', () => {
  for (const f of fontes) {
    const t = semComentarios(f.texto)
    if (f.caminho.startsWith('src/base/migracoes/')) continue // ferramenta administrativa, fora da API
    assert.ok(!/DATABASE_ADMIN_URL/.test(t), `${f.caminho}: a API não pode ler a ligação administrativa`)
    assert.ok(!/SERVICE_ROLE_KEY|SUPABASE_SERVICE|service_role_key/.test(t), `${f.caminho}: credencial de serviço`)
  }
})

test('o pool de ligações só é criado no módulo de acesso e não é exportado', () => {
  for (const f of fontes) {
    const t = semComentarios(f.texto)
    if (f.caminho === 'src/base/acesso.ts' || f.caminho.startsWith('src/base/migracoes/')) continue
    assert.ok(!/new\s+pg\.(Pool|Client)\b|from 'pg'/.test(t), `${f.caminho}: acesso directo ao driver`)
  }
  assert.ok(!/export\s+(const|let)\s+pool\b/.test(fontes.find((f) => f.caminho === 'src/base/acesso.ts')!.texto))
})

test('rejectUnauthorized: false nunca aparece no código', () => {
  for (const f of fontes) assert.ok(!/rejectUnauthorized\s*:\s*false/.test(f.texto), f.caminho)
})

test('o contexto verificado só é criado em contexto.testes.ts (nenhum atalho a partir do pedido)', () => {
  for (const f of fontes) {
    if (f.caminho === 'src/base/contexto.ts' || f.caminho === 'src/base/contexto.testes.ts') continue
    assert.ok(!/\[MARCA_CONTEXTO\]\s*:/.test(f.texto), `${f.caminho} cria um ContextoVerificado`)
  }
  for (const f of fontes) {
    if (f.caminho === 'src/base/contexto.testes.ts') continue
    assert.ok(!/from\s+'[^']*contexto\.testes/.test(f.texto), `${f.caminho} importa o criador de contextos de teste`)
  }
})

test('Etapa 3: a sessão validada só nasce no serviço de identidade, com o que a base devolveu', () => {
  for (const f of fontes) {
    if (f.caminho === 'src/servicos/identidade.ts') continue
    // (A declaração do tipo, "readonly [MARCA_SESSAO]: true", não cria nada.)
    assert.ok(!/(?<!readonly\s)\[MARCA_SESSAO\]\s*:/.test(semComentarios(f.texto)), `${f.caminho} cria uma SessaoValidada`)
  }
  const identidade = fontes.find((f) => f.caminho === 'src/servicos/identidade.ts')!.texto
  // Criada só em sessaoDaBase(), a partir de uma linha de nexo.validar_sessao.
  assert.equal(identidade.match(/\[MARCA_SESSAO\]\s*:/g)?.length, 1)
  assert.match(identidade, /chamarIdentidade<LinhaSessao>\('validar_sessao'/)
})

test('Etapa 3: o pedido nunca fornece empresa, utilizador ou função ao contexto', () => {
  for (const f of fontes) {
    if (!f.caminho.startsWith('src/rotas/') && !f.caminho.startsWith('src/autenticacao/')) continue
    const t = semComentarios(f.texto)
    assert.ok(!/contextoDaSessao\([^)]*req\.(body|query|params)/.test(t), `${f.caminho}: contexto a partir do corpo/consulta`)
    assert.ok(!/empresaId\s*:\s*req\./.test(t), `${f.caminho}: empresa a partir do pedido`)
  }
})

test('registo (0008): registar() não abre sessão; o ecrã de registo do frontend não inicia sessão', () => {
  const identidade = semComentarios(fontes.find((f) => f.caminho === 'src/servicos/identidade.ts')!.texto)
  const inicio = identidade.indexOf('async registar(')
  const corpo = identidade.slice(inicio, identidade.indexOf('async confirmarEmail(', inicio))
  assert.ok(inicio > 0 && corpo.length > 0, 'registar() não encontrado')
  assert.ok(!/\bentrar\(|iniciar_sessao|gerarToken\('sessao'\)/.test(corpo), 'registar() cria uma sessão')
  const rotas = semComentarios(fontes.find((f) => f.caminho === 'src/rotas/autenticacao.ts')!.texto)
  const registo = rotas.slice(rotas.indexOf("'/registo'"), rotas.indexOf("'/activacao/reenviar'"))
  assert.ok(!/Set-Cookie|cookieSessao/.test(registo), 'a rota de registo emite cookie')
  const ecra = readFileSync(join(RAIZ, '..', 'frontend', 'src', 'real', 'ecras', 'CriarEmpresa.tsx'), 'utf8')
  assert.ok(!/useSessao|iniciar\(/.test(semComentarios(ecra)), 'o ecrã de registo inicia uma sessão no frontend')
})
