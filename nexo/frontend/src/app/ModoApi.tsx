// Ecrã do modo "api" (VITE_NEXO_MODO=api): só a infraestrutura real. Os módulos comerciais e a
// autenticação real chegam nas etapas seguintes; aqui não há dados fictícios nem login simulado.

import { Aviso } from '../components/ui'
import { EstadoSistema } from '../features/sistema/EstadoSistema'

export function ModoApi() {
  return (
    <div className="modo-api">
      <header>
        <span className="marca">Nexo</span>
      </header>
      <Aviso tom="aviso" titulo="Base técnica (Etapa 2)">
        Ainda não há autenticação real nem módulos comerciais neste modo. Para ver os ecrãs do protótipo, use o modo de
        demonstração (VITE_NEXO_MODO=demonstracao).
      </Aviso>
      <EstadoSistema />
    </div>
  )
}
