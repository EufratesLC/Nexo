import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        // Protótipo navegável (Etapa 1).
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // Prova técnica isolada de assinatura (hipótese H-23).
        prova: fileURLToPath(new URL('./prova-assinatura.html', import.meta.url)),
      },
    },
  },
  server: {
    // A página da prova chama /api/prova-assinatura; o proxy evita CORS e
    // permite testar a partir de outro aparelho na mesma rede (npm run dev -- --host).
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
