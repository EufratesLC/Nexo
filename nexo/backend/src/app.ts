// Aplicação Express, sem arranque. O servidor (server.ts) e os testes criam-na com as suas
// dependências, o que permite testar as rotas sem abrir portas nem ligar à base.

import cors from 'cors'
import express, { type Express } from 'express'
import type { AcessoBase } from './base/acesso.js'
import type { Configuracao } from './config/ambiente.js'
import { ErroApi, naoEncontrado, tratarErros } from './http/erros.js'
import { identificarPedidos } from './http/pedido.js'
import { routerProvaAssinatura } from './prova/assinatura.js'
import type { Logger } from './registo/logger.js'
import { routerV1 } from './rotas/v1.js'

export interface Dependencias {
  config: Configuracao
  logger: Logger
  base: AcessoBase
}

export function criarApp({ config, logger, base }: Dependencias): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', false)

  app.use(identificarPedidos(logger))
  app.use(
    cors({
      origin: (origem, callback) => {
        // Pedidos sem Origin (curl, o próprio servidor) não são pedidos de navegador entre origens.
        if (!origem || config.origensCors.includes(origem)) callback(null, true)
        else callback(new ErroApi(403, 'origem_nao_permitida', 'Origem não permitida.'))
      },
      exposedHeaders: ['X-Nexo-Pedido'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Nexo-Pedido', 'X-Nexo-Empresa', 'Idempotency-Key'],
      maxAge: 600,
    }),
  )
  app.use(express.json({ limit: '256kb' }))

  app.use('/api/v1', routerV1(config, base))

  // Prova técnica isolada da Etapa 1 (H-23). Só em desenvolvimento. NÃO é autenticação do Nexo.
  if (config.provaAssinaturaActiva) {
    app.use(
      '/api/prova-assinatura',
      (_req, res, next) => {
        res.setHeader('X-Nexo-Aviso', 'prova-tecnica; nao-e-autenticacao')
        next()
      },
      routerProvaAssinatura(),
    )
  }

  app.use(naoEncontrado)
  app.use(tratarErros)
  return app
}
