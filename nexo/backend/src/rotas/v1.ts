// Rotas da versão 1 da API (/api/v1): saúde (Etapa 2), autenticação e administração (Etapa 3).

import { Router } from 'express'
import type { AcessoBase } from '../base/acesso.js'
import type { Configuracao } from '../config/ambiente.js'
import type { ServicoAdministracao } from '../servicos/administracao.js'
import type { ServicoIdentidade } from '../servicos/identidade.js'
import { exigirClienteConfiavel } from '../autenticacao/middleware.js'
import { routerAdministracao } from './administracao.js'
import { routerAutenticacao } from './autenticacao.js'

export function routerV1(config: Configuracao, base: AcessoBase, servicos: { identidade: ServicoIdentidade; administracao: ServicoAdministracao }): Router {
  const router = Router()
  // Pedidos que alteram dados: só da aplicação (cabeçalho X-Nexo-Cliente; protecção contra CSRF).
  router.use(exigirClienteConfiavel)

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

  router.use('/autenticacao', routerAutenticacao({ config, ...servicos }))
  router.use(routerAdministracao({ config, ...servicos }))

  return router
}
