import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Variáveis VITE_* ficam no código enviado ao navegador. Recusar construir ou arrancar se alguma
// parecer um segredo ou uma ligação à base de dados (essas ficam só no backend).
const SUSPEITAS_NOME = /(SECRET|SEGREDO|PASSWORD|SENHA|SERVICE|DATABASE|ADMIN|PRIVATE|TOKEN|CHAVE_PRIVADA)/i
const SUSPEITAS_VALOR = /(postgres(ql)?:\/\/|BEGIN (RSA |EC )?PRIVATE KEY|service_role|sb_secret_)/i

function verificarVariaveisPublicas(env: Record<string, string>) {
  const problemas = Object.entries(env)
    .filter(([nome]) => nome.startsWith('VITE_'))
    .filter(([nome, valor]) => SUSPEITAS_NOME.test(nome) || SUSPEITAS_VALOR.test(valor))
    .map(([nome]) => nome)
  if (problemas.length) {
    throw new Error(`Variáveis VITE_* com aspecto de segredo (seriam públicas): ${problemas.join(', ')}. Mova-as para o backend.`)
  }
}

// Carimba o sw.js da build com um resumo do conteúdo (index.html, que já tem os nomes com hash dos
// ficheiros). Sem isto o sw.js seria igual em todas as builds e o navegador nunca detectaria uma
// versão nova da aplicação.
function versaoServiceWorker(): Plugin {
  let pasta = 'dist'
  return {
    name: 'nexo-versao-sw',
    apply: 'build',
    configResolved(c) {
      pasta = c.build.outDir.startsWith('/') || /^[A-Za-z]:/.test(c.build.outDir) ? c.build.outDir : join(c.root, c.build.outDir)
    },
    closeBundle() {
      const caminho = join(pasta, 'sw.js')
      const sw = readFileSync(caminho, 'utf8')
      if (!sw.includes('__NEXO_VERSAO_SW__')) throw new Error('sw.js sem o marcador __NEXO_VERSAO_SW__')
      const resumo = createHash('sha256').update(readFileSync(join(pasta, 'index.html'))).digest('hex').slice(0, 12)
      writeFileSync(caminho, sw.replace('__NEXO_VERSAO_SW__', `nexo-app-${resumo}`))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  verificarVariaveisPublicas({ ...env, ...process.env } as Record<string, string>)

  // API de desenvolvimento para onde o proxy envia /api (não é VITE_: não vai para o navegador).
  const alvoApi = env.NEXO_API_PROXY || 'http://localhost:3001'
  // HTTPS opcional para testar em telemóveis (certificados locais, ex.: mkcert). Ver docs/Nexo_Ambientes.md.
  const https =
    env.NEXO_HTTPS_CERT && env.NEXO_HTTPS_CHAVE
      ? { cert: readFileSync(env.NEXO_HTTPS_CERT), key: readFileSync(env.NEXO_HTTPS_CHAVE) }
      : undefined
  const proxy = { '/api': { target: alvoApi, changeOrigin: false } }

  return {
    plugins: [react(), versaoServiceWorker()],
    // Versão da aplicação, mostrada no estado do sistema (não é segredo). Por omissão "local".
    define: { __NEXO_VERSAO_APP__: JSON.stringify(env.VITE_NEXO_VERSAO || process.env.VITE_NEXO_VERSAO || 'local') },
    build: {
      rolldownOptions: {
        input: {
          // Protótipo navegável (Etapa 1) e base da aplicação (Etapa 2).
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          // Prova técnica isolada de assinatura (hipótese H-23).
          prova: fileURLToPath(new URL('./prova-assinatura.html', import.meta.url)),
        },
      },
    },
    // O proxy evita CORS em desenvolvimento e permite testar a partir de outro aparelho na mesma
    // rede (npm run dev -- --host; com HTTPS configurado para a Web Crypto e o service worker).
    server: { proxy, https },
    preview: { proxy, https },
  }
})
