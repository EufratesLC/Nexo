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
