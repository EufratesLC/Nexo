// Rotas da versão 1 da API (/api/v1). Na Etapa 2 só existem as verificações de saúde.

import { Router } from 'express'
import type { AcessoBase } from '../base/acesso.js'
import type { Configuracao } from '../config/ambiente.js'

export function routerV1(config: Configuracao, base: AcessoBase): Router {
  const router = Router()

  // Saúde do processo: não toca na base. Serve para saber se a API está a responder.
  router.get('/saude', (_req, res) => {
    res.json({ estado: 'ok', servico: 'nexo-api', ambiente: config.ambiente })
  })

  // Disponibilidade da base: liga como nexo_api, confirma que o papel não ignora políticas e
  // lê a versão das migrações. Não devolve servidor, utilizador nem mensagens do driver.
  router.get('/saude/base', async (_req, res) => {
    const estado = await base.diagnosticar()
    const pronta = estado.disponivel && estado.papelSeguro === true && estado.versaoMigracao !== null
    res.status(pronta ? 200 : 503).json({
      estado: pronta ? 'ok' : 'indisponivel',
      base: {
        disponivel: estado.disponivel,
        papelSeguro: estado.papelSeguro,
        versaoMigracao: estado.versaoMigracao,
        ...(estado.motivo ? { motivo: estado.motivo } : {}),
      },
    })
  })

  return router
}
