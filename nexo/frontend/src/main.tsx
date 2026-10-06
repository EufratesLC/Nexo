import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registarServiceWorker } from './pwa/registar'

// Versão desta build, legível pelos testes e pelo estado do sistema.
document.documentElement.dataset.nexoVersao = __NEXO_VERSAO_APP__

registarServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
