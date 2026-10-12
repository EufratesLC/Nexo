// /api/v1/empresa, /filiais, /utilizadores, /auditoria — administração da empresa.
//
// H-02: só o proprietário cria contas, atribui a função e as filiais, desactiva e define códigos.
// As rotas verificam a função ANTES de tocar na base; a base volta a verificar (políticas 0006 e
// funções 0007). Ninguém altera a própria conta por estas rotas (sem auto-promoção nem
// auto-desactivação); o próprio código muda-se em /autenticacao/codigo.

import { Router } from 'express'
import { z } from 'zod'
import type { Funcao } from '../base/contexto.js'
import type { Configuracao } from '../config/ambiente.js'
import { ErroApi } from '../http/erros.js'
import { validar } from '../http/validar.js'
import type { ServicoAdministracao } from '../servicos/administracao.js'
import type { ServicoIdentidade } from '../servicos/identidade.js'
import { problemasDoCodigo } from '../autenticacao/codigoSecreto.js'
import { exigirFuncao, exigirSessao, sessaoDe } from '../autenticacao/middleware.js'
import { esquemaCodigoSecreto, esquemaNomeUtilizador } from './autenticacao.js'

const uuid = z.uuid('Identificador inválido.')
const parametrosId = z.strictObject({ id: uuid })
const nome = z.string().trim().min(1, 'Obrigatório.').max(120, 'No máximo 120 caracteres.')
const funcao = z.enum(['proprietario', 'gestor', 'operador'])
const opcional = <T extends z.ZodType>(e: T) => z.union([e, z.null()]).optional()

export function routerAdministracao(deps: { config: Configuracao; identidade: ServicoIdentidade; administracao: ServicoAdministracao }): Router {
  const { config, identidade, administracao } = deps
  const router = Router()
  const sessao = exigirSessao(identidade, config.sessao)
  const proprietario = [sessao, exigirFuncao('proprietario')]

  // Empresa e filial ---------------------------------------------------------------------------
  router.get('/empresa', sessao, async (req, res) => {
    const r = await administracao.resumoSessao(sessaoDe(req))
    res.json({ empresa: r.empresa, filiais: r.filiais })
  })

  router.patch(
    '/empresa',
    ...proprietario,
    validar({
      corpo: z
        .strictObject({
          nome: z.string().trim().min(1, 'Obrigatório.').max(200).optional(),
          nuit: opcional(z.string().trim().regex(/^[0-9]{9}$/, 'O NUIT tem 9 algarismos.')),
          telefone: opcional(z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Telefone inválido.')),
          endereco: opcional(z.string().trim().min(1).max(300)),
        })
        .refine((v) => Object.keys(v).length > 0, 'Indique pelo menos um campo.'),
    }),
    async (req, res) => {
      res.json({ empresa: await administracao.alterarEmpresa(sessaoDe(req), res.locals.validado.corpo) })
    },
  )

  router.patch('/filiais/:id', ...proprietario, validar({ parametros: parametrosId, corpo: z.strictObject({ nome: z.string().trim().min(1).max(200) }) }), async (req, res) => {
    const { id } = res.locals.validado.parametros as { id: string }
    res.json({ filial: await administracao.alterarFilial(sessaoDe(req), id, (res.locals.validado.corpo as { nome: string }).nome) })
  })

  // Utilizadores ---------------------------------------------------------------------------------
  router.get('/utilizadores', ...proprietario, async (req, res) => {
    res.json({ utilizadores: await administracao.listarUtilizadores(sessaoDe(req)) })
  })

  router.post(
    '/utilizadores',
    ...proprietario,
    validar({
      corpo: z.strictObject({
        nome,
        nomeUtilizador: esquemaNomeUtilizador,
        funcao,
        filiais: z.array(uuid).max(50).default([]),
        codigoSecreto: esquemaCodigoSecreto,
      }),
    }),
    async (req, res) => {
      const s = sessaoDe(req)
      const dados = res.locals.validado.corpo as { nome: string; nomeUtilizador: string; funcao: Funcao; filiais: string[]; codigoSecreto: string }
      const empresa = (await administracao.resumoSessao(s)).empresa.codigo
      const problemas = problemasDoCodigo(dados.codigoSecreto, { nomeUtilizador: dados.nomeUtilizador, codigoEmpresa: empresa })
      if (problemas.length) throw new ErroApi(400, 'validacao', 'O código secreto não cumpre as regras.', { campos: { 'corpo.codigoSecreto': problemas } })
      if (dados.funcao !== 'proprietario' && dados.filiais.length === 0) {
        throw new ErroApi(400, 'validacao', 'Escolha pelo menos uma filial.', { campos: { 'corpo.filiais': ['Escolha pelo menos uma filial.'] } })
      }
      res.status(201).json({ utilizador: await administracao.criarUtilizador(s, dados) })
    },
  )

  router.get('/utilizadores/:id', ...proprietario, validar({ parametros: parametrosId }), async (req, res) => {
    res.json({ utilizador: await administracao.obterUtilizador(sessaoDe(req), (res.locals.validado.parametros as { id: string }).id) })
  })

  router.patch(
    '/utilizadores/:id',
    ...proprietario,
    validar({
      parametros: parametrosId,
      corpo: z
        .strictObject({ nome: nome.optional(), funcao: funcao.optional(), filiais: z.array(uuid).max(50).optional() })
        .refine((v) => Object.keys(v).length > 0, 'Indique pelo menos um campo.'),
    }),
    async (req, res) => {
      const { id } = res.locals.validado.parametros as { id: string }
      res.json({ utilizador: await administracao.alterarUtilizador(sessaoDe(req), id, res.locals.validado.corpo) })
    },
  )

  router.post('/utilizadores/:id/desactivar', ...proprietario, validar({ parametros: parametrosId }), async (req, res) => {
    res.json({ utilizador: await administracao.desactivarUtilizador(sessaoDe(req), (res.locals.validado.parametros as { id: string }).id) })
  })

  router.post('/utilizadores/:id/reactivar', ...proprietario, validar({ parametros: parametrosId }), async (req, res) => {
    res.json({ utilizador: await administracao.reactivarUtilizador(sessaoDe(req), (res.locals.validado.parametros as { id: string }).id) })
  })

  router.put(
    '/utilizadores/:id/codigo',
    ...proprietario,
    validar({ parametros: parametrosId, corpo: z.strictObject({ codigoSecreto: esquemaCodigoSecreto }) }),
    async (req, res) => {
      const s = sessaoDe(req)
      const { id } = res.locals.validado.parametros as { id: string }
      const { codigoSecreto } = res.locals.validado.corpo as { codigoSecreto: string }
      const alvo = await administracao.obterUtilizador(s, id)
      const problemas = problemasDoCodigo(codigoSecreto, { nomeUtilizador: alvo.nomeUtilizador })
      if (problemas.length) throw new ErroApi(400, 'validacao', 'O código secreto não cumpre as regras.', { campos: { 'corpo.codigoSecreto': problemas } })
      await administracao.definirCodigo(s, id, codigoSecreto)
      // Nunca se devolve o código (nem o novo): o proprietário já o conhece, porque o escreveu.
      res.json({ redefinido: true, sessoesTerminadas: true })
    },
  )

  // Auditoria ------------------------------------------------------------------------------------
  router.get(
    '/auditoria',
    ...proprietario,
    validar({ consulta: z.strictObject({ limite: z.coerce.number().int().min(1).max(200).default(50), antes: z.iso.datetime({ offset: true }).optional() }) }),
    async (req, res) => {
      res.json({ entradas: await administracao.listarAuditoria(sessaoDe(req), res.locals.validado.consulta as { limite: number; antes?: string }) })
    },
  )

  return router
}
