// Modo "api" (VITE_NEXO_MODO=api): a aplicação real. Desde a Etapa 3 tem autenticação online,
// empresa, filial, funcionários e auditoria; os módulos comerciais chegam nas etapas seguintes.
// Não há dados fictícios nem login simulado neste modo.

import { AppReal } from '../real/AppReal'

export function ModoApi() {
  return <AppReal />
}
