// Arranque do servidor: lê e valida a configuração, liga o logger e a base, abre a porta e
// trata o encerramento (SIGINT/SIGTERM) fechando primeiro o HTTP e depois as ligações à base.

import 'dotenv/config'
import type { Server } from 'node:http'
import { criarApp } from './app.js'
import { criarAcessoBase } from './base/acesso.js'
import { criarEncerramento } from './encerramento.js'
import { ErroConfiguracao, lerConfiguracao } from './config/ambiente.js'
import { criarLogger } from './registo/logger.js'

const TEMPO_ENCERRAMENTO_MS = 10_000

async function arrancar(): Promise<void> {
  let config
  try {
    config = lerConfiguracao()
  } catch (erro) {
    // A mensagem só tem nomes de variáveis e motivos, nunca valores.
    console.error(erro instanceof ErroConfiguracao ? erro.message : 'Configuração inválida.')
    process.exit(1)
  }
  const logger = criarLogger(config.nivelLog)
  const base = criarAcessoBase(config.base, logger)

  if (config.base) {
    const estado = await base.diagnosticar()
    if (estado.papelSeguro === false) {
      // H-01, R3: a API recusa arrancar com um papel que ignore as políticas.
      logger.fatal({ base: config.base.descricao }, 'o papel da ligação é superutilizador, ignora as políticas ou herda privilégios')
      await base.encerrar()
      process.exit(1)
    }
    logger.info({ base: config.base.descricao, disponivel: estado.disponivel, versaoMigracao: estado.versaoMigracao }, 'base de dados')
  } else {
    logger.warn('DATABASE_URL não definida: a API arranca sem base de dados (só em desenvolvimento ou teste)')
  }

  const app = criarApp({ config, logger, base })
  const servidor: Server = app.listen(config.porta, () => {
    logger.info({ porta: config.porta, ambiente: config.ambiente, provaAssinatura: config.provaAssinaturaActiva }, 'Nexo API a escutar')
  })

  const encerrar = criarEncerramento({ servidor, base, logger, sair: (c) => process.exit(c), tempoLimiteMs: TEMPO_ENCERRAMENTO_MS })
  process.on('SIGINT', () => void encerrar('SIGINT'))
  process.on('SIGTERM', () => void encerrar('SIGTERM'))
}

void arrancar()
