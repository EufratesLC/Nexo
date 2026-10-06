// Registo do service worker e aviso de actualização — PREPARAÇÃO da PWA (Etapa 2).
//
// - Só em builds de produção (npm run build / preview): em desenvolvimento o Vite serve os
//   módulos directamente e um service worker atrapalharia.
// - Uma versão nova instala-se e fica À ESPERA. Só é activada quando o utilizador aceita
//   (arquitectura 11). Na Etapa 7, a activação passa a exigir também: sem venda em curso e
//   depois de tentar enviar a fila.

type Ouvinte = (pronta: boolean) => void
const ouvintes = new Set<Ouvinte>()
let emEspera: ServiceWorker | null = null

export function aoMudarActualizacao(fn: Ouvinte): () => void {
  ouvintes.add(fn)
  fn(emEspera !== null)
  return () => ouvintes.delete(fn)
}

function avisar(sw: ServiceWorker | null) {
  emEspera = sw
  for (const fn of ouvintes) fn(sw !== null)
}

export function activarActualizacao(): void {
  emEspera?.postMessage({ tipo: 'activar' })
}

export function registarServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  let recarregado = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Só recarrega quando a activação foi pedida pelo utilizador (havia uma versão em espera).
    if (recarregado || emEspera === null) return
    recarregado = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registo) => {
        if (registo.waiting && navigator.serviceWorker.controller) avisar(registo.waiting)
        // Procurar já uma versão nova (o navegador também o faz ao navegar).
        void registo.update().catch(() => {})
        registo.addEventListener('updatefound', () => {
          const nova = registo.installing
          nova?.addEventListener('statechange', () => {
            if (nova.state === 'installed' && navigator.serviceWorker.controller) avisar(nova)
          })
        })
      })
      .catch(() => {
        // Sem service worker a aplicação continua a funcionar online.
      })
  })
}
