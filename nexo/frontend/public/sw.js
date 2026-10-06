// Service worker do Nexo — PREPARAÇÃO da PWA (Etapa 2).
//
// Faz só o que o roteiro prevê para esta etapa:
// - guarda a APLICAÇÃO (index.html e os ficheiros de /assets/), para abrir sem rede;
// - NUNCA guarda pedidos à API (/api/), pedidos que não sejam GET, nem outras origens;
// - uma versão nova instala-se, fica À ESPERA e só é activada quando a página o pede
//   (o utilizador carrega em "Actualizar agora"); não há skipWaiting automático.
// Não guarda dados de negócio nem operações: isso é da Etapa 7 (IndexedDB).
//
// VERSAO é preenchida na build (vite.config.ts) com um resumo do conteúdo: cada build com
// conteúdo diferente produz um sw.js diferente, e é isso que faz o navegador detectar a versão nova.

const VERSAO = '__NEXO_VERSAO_SW__'
const ESSENCIAIS = ['/', '/index.html', '/manifest.webmanifest', '/icone.svg']

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(VERSAO)
      await cache.addAll(ESSENCIAIS.map((u) => new Request(u, { cache: 'reload' })))
      // Os ficheiros com hash de /assets/ são lidos do index.html desta versão.
      const html = await (await cache.match('/index.html')).text()
      const recursos = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
      await cache.addAll([...new Set(recursos)])
    })(),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nome of await caches.keys()) if (nome !== VERSAO) await caches.delete(nome)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.tipo === 'activar') self.skipWaiting()
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request
  const url = new URL(pedido.url)
  if (pedido.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/prova-assinatura')) return

  if (pedido.mode === 'navigate') {
    // A aplicação desta versão (da sua própria cache); rede só se faltar. Assim uma versão nova
    // publicada no servidor só entra quando for activada, e não a meio do uso.
    evento.respondWith(
      (async () => {
        const guardado = await (await caches.open(VERSAO)).match('/index.html')
        return guardado || fetch(pedido)
      })(),
    )
    return
  }
  if (url.pathname.startsWith('/assets/') || ESSENCIAIS.includes(url.pathname)) {
    // Ficheiros com hash não mudam: cache desta versão primeiro, rede se faltar.
    evento.respondWith(
      (async () => {
        const cache = await caches.open(VERSAO)
        const guardado = await cache.match(pedido)
        if (guardado) return guardado
        const resposta = await fetch(pedido)
        if (resposta.ok) cache.put(pedido, resposta.clone())
        return resposta
      })(),
    )
  }
})
