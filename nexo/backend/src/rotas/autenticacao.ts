// /api/v1/autenticacao — entrar, sair, sessão actual, registo da empresa, e-mail de recuperação do
// proprietário, recuperação do acesso e alteração do próprio código.
//
// - Mensagens de login iguais para empresa inexistente, conta inexistente e código errado.
//   "Conta desactivada" só aparece depois de o código estar certo.
// - Limites de tentativas por IP e por conta (para todas as contas, existam ou não).
// - O pedido de recuperação responde sempre o mesmo (202), exista ou não a conta.
// - Nenhuma resposta devolve códigos, resumos, tokens de e-mail ou o token da sessão (que só vai no
//   cabeçalho Set-Cookie, HttpOnly).

import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { SessaoValidada } from '../base/contexto.js'
import type { Configuracao } from '../config/ambiente.js'
import { ErroApi } from '../http/erros.js'
import { validar } from '../http/validar.js'
import type { ServicoAdministracao } from '../servicos/administracao.js'
import type { ServicoIdentidade } from '../servicos/identidade.js'
import { problemasDoCodigo } from '../autenticacao/codigoSecreto.js'
import { cookieApagado, cookieSessao } from '../autenticacao/cookies.js'
import { chaveIdentificador, LIMITES, Limitador } from '../autenticacao/limitador.js'
import { exigirFuncao, exigirSessao, sessaoDe, tokenDoPedido } from '../autenticacao/middleware.js'

export const CODIGO_EMPRESA = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/
export const NOME_UTILIZADOR = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/

const texto = (max: number) => z.string().trim().min(1, 'Obrigatório.').max(max, `No máximo ${max} caracteres.`)
const minusculas = (re: RegExp, mensagem: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.toLowerCase())
    .pipe(z.string().regex(re, mensagem))
export const esquemaCodigoEmpresa = minusculas(CODIGO_EMPRESA, '3 a 20 caracteres: letras, algarismos e hífen (sem começar nem acabar em hífen).')
export const esquemaNomeUtilizador = minusculas(NOME_UTILIZADOR, '3 a 32 caracteres: letras, algarismos, ponto, hífen e sublinhado.')
// O código secreto não se corta nem se altera (só a normalização Unicode, no cálculo do resumo).
export const esquemaCodigoSecreto = z.string().min(1, 'Obrigatório.').max(256)
export const esquemaEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'E-mail inválido.')

const MENSAGEM_LOGIN_INVALIDO = 'Código da empresa, nome de utilizador ou código secreto incorrectos.'
const MENSAGEM_REENVIO =
  'Se existir um registo à espera de confirmação com esses dados, enviámos um novo link para o e-mail indicado no registo. Os links anteriores deixam de valer.'
const MENSAGEM_RECUPERACAO =
  'Se existir uma conta de proprietário com esses dados e um e-mail de recuperação confirmado, enviámos um link para esse e-mail. O link expira em 30 minutos.'

function erroCodigo(campo: string, problemas: string[]): ErroApi {
  return new ErroApi(400, 'validacao', 'O código secreto não cumpre as regras.', { campos: { [`corpo.${campo}`]: problemas } })
}

function limitar(res: Response, ...esperas: number[]): void {
  const ms = Math.max(0, ...esperas)
  if (ms > 0) {
    res.setHeader('Retry-After', String(Math.ceil(ms / 1000)))
    throw new ErroApi(429, 'demasiadas_tentativas', 'Demasiadas tentativas. Aguarde alguns minutos e tente de novo.')
  }
}

export interface DependenciasAutenticacao {
  config: Configuracao
  identidade: ServicoIdentidade
  administracao: ServicoAdministracao
}

export function routerAutenticacao({ config, identidade, administracao }: DependenciasAutenticacao): Router {
  const router = Router()
  const sessao = exigirSessao(identidade, config.sessao)
  const limites = {
    entrarConta: new Limitador(LIMITES.entrarPorConta),
    entrarIp: new Limitador(LIMITES.entrarPorIp),
    registoIp: new Limitador(LIMITES.registoPorIp),
    recuperacaoConta: new Limitador(LIMITES.recuperacaoPorConta),
    recuperacaoIp: new Limitador(LIMITES.recuperacaoPorIp),
    tokensIp: new Limitador(LIMITES.tokensPorIp),
    codigoProprio: new Limitador(LIMITES.codigoProprioPorConta),
  }
  const ipDe = (req: Request) => req.ip ?? 'desconhecido'

  async function responderSessao(res: Response, s: SessaoValidada, estado = 200) {
    const resumo = await administracao.resumoSessao(s)
    res.status(estado).json({
      utilizador: { id: s.utilizadorId, nome: s.nome, nomeUtilizador: s.nomeUtilizador, funcao: s.funcao },
      empresa: resumo.empresa,
      filiais: resumo.filiais,
      filialActual: resumo.filiais[0] ?? null,
      expiraEm: s.expiraEm.toISOString(),
      emailRecuperacao: resumo.emailRecuperacao,
    })
  }

  router.post(
    '/entrar',
    validar({
      corpo: z.strictObject({ codigoEmpresa: z.string().trim().min(1).max(40), nomeUtilizador: z.string().trim().min(1).max(64), codigoSecreto: esquemaCodigoSecreto }),
    }),
    async (req, res) => {
      const dados = res.locals.validado.corpo as { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string }
      const ip = ipDe(req)
      const conta = chaveIdentificador(dados.codigoEmpresa, dados.nomeUtilizador)
      limitar(res, limites.entrarIp.esperaMs(ip), limites.entrarConta.esperaMs(conta))
      const r = await identidade.entrar(dados)
      if (r.tipo === 'invalido') {
        limites.entrarIp.registarFalha(ip)
        limites.entrarConta.registarFalha(conta)
        req.log?.info({ evento: 'login_falhado' }, 'login recusado')
        throw new ErroApi(401, 'credenciais_invalidas', MENSAGEM_LOGIN_INVALIDO)
      }
      if (r.tipo === 'desactivado') throw new ErroApi(403, 'conta_desactivada', 'Esta conta está desactivada. Fale com o proprietário da empresa.')
      if (r.tipo === 'pendente') {
        throw new ErroApi(403, 'activacao_pendente', 'A conta ainda não está activa: confirme o e-mail pelo link que enviámos. Pode pedir um novo link.')
      }
      limites.entrarConta.limpar(conta)
      res.setHeader('Set-Cookie', cookieSessao(config.sessao, r.token, r.sessao.expiraEm.getTime() - Date.now()))
      await responderSessao(res, r.sessao)
    },
  )

  router.post('/sair', async (req, res) => {
    const token = tokenDoPedido(req.headers.cookie, config.sessao)
    if (token) await identidade.terminarSessao(token)
    res.setHeader('Set-Cookie', cookieApagado(config.sessao))
    res.status(204).end()
  })

  router.get('/sessao', sessao, async (req, res) => {
    await responderSessao(res, sessaoDe(req))
  })

  router.post(
    '/registo',
    validar({
      corpo: z.strictObject({
        codigoEmpresa: esquemaCodigoEmpresa,
        nomeEmpresa: texto(200),
        nuit: z.string().trim().regex(/^[0-9]{9}$/, 'O NUIT tem 9 algarismos.').optional(),
        telefone: z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, 'Telefone inválido.').optional(),
        nome: texto(120),
        nomeUtilizador: esquemaNomeUtilizador,
        email: esquemaEmail,
        codigoSecreto: esquemaCodigoSecreto,
      }),
    }),
    async (req, res) => {
      const dados = res.locals.validado.corpo as Parameters<ServicoIdentidade['registar']>[0]
      const ip = ipDe(req)
      limitar(res, limites.registoIp.esperaMs(ip))
      limites.registoIp.registarFalha(ip) // conta todos os registos, não só os falhados
      const problemas = problemasDoCodigo(dados.codigoSecreto, { nomeUtilizador: dados.nomeUtilizador, codigoEmpresa: dados.codigoEmpresa })
      if (problemas.length) throw erroCodigo('codigoSecreto', problemas)
      await identidade.registar(dados)
      // Sem sessão: a conta fica pendente até o e-mail ser confirmado (migração 0008).
      res.status(201).json({
        activacaoPendente: true,
        codigoEmpresa: dados.codigoEmpresa,
        nomeUtilizador: dados.nomeUtilizador,
        mensagem: `Enviámos um link de confirmação para ${dados.email}. A conta fica activa quando o abrir; o link expira em 48 horas.`,
      })
    },
  )

  // Reenviar o link de um registo pendente. Resposta sempre igual (não revela contas nem estados).
  router.post(
    '/activacao/reenviar',
    validar({ corpo: z.strictObject({ codigoEmpresa: z.string().trim().min(1).max(40), nomeUtilizador: z.string().trim().min(1).max(64) }) }),
    async (req, res) => {
      const dados = res.locals.validado.corpo as { codigoEmpresa: string; nomeUtilizador: string }
      const ip = ipDe(req)
      const conta = `activacao:${chaveIdentificador(dados.codigoEmpresa, dados.nomeUtilizador)}`
      limitar(res, limites.recuperacaoIp.esperaMs(ip), limites.recuperacaoConta.esperaMs(conta))
      limites.recuperacaoIp.registarFalha(ip)
      limites.recuperacaoConta.registarFalha(conta)
      await identidade.reenviarActivacao(dados)
      res.status(202).json({ mensagem: MENSAGEM_REENVIO })
    },
  )

  // Corrigir o e-mail de um registo pendente (exige o código secreto; conta como tentativa de login).
  router.post(
    '/activacao/email',
    validar({
      corpo: z.strictObject({ codigoEmpresa: z.string().trim().min(1).max(40), nomeUtilizador: z.string().trim().min(1).max(64), codigoSecreto: esquemaCodigoSecreto, email: esquemaEmail }),
    }),
    async (req, res) => {
      const dados = res.locals.validado.corpo as { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string; email: string }
      const ip = ipDe(req)
      const conta = chaveIdentificador(dados.codigoEmpresa, dados.nomeUtilizador)
      limitar(res, limites.entrarIp.esperaMs(ip), limites.entrarConta.esperaMs(conta))
      if (!(await identidade.corrigirEmailActivacao(dados))) {
        limites.entrarIp.registarFalha(ip)
        limites.entrarConta.registarFalha(conta)
        throw new ErroApi(400, 'correccao_recusada', 'Não foi possível alterar: confirme os dados e o código, ou a conta já está activa.')
      }
      res.status(202).json({ mensagem: `Enviámos um novo link de confirmação para ${dados.email}.` })
    },
  )

  router.post('/email/confirmar', validar({ corpo: z.strictObject({ token: z.string().max(100) }) }), async (req, res) => {
    const ip = ipDe(req)
    limitar(res, limites.tokensIp.esperaMs(ip))
    const r = await identidade.confirmarEmail((res.locals.validado.corpo as { token: string }).token)
    if (r === 'invalido') {
      limites.tokensIp.registarFalha(ip)
      throw new ErroApi(400, 'link_invalido', 'O link é inválido, já foi usado ou expirou. Peça um novo.')
    }
    res.json({ confirmado: true, contaActivada: r === 'activada' })
  })

  router.post(
    '/recuperacao',
    validar({ corpo: z.strictObject({ codigoEmpresa: z.string().trim().min(1).max(40), nomeUtilizador: z.string().trim().min(1).max(64) }) }),
    async (req, res) => {
      const dados = res.locals.validado.corpo as { codigoEmpresa: string; nomeUtilizador: string }
      const ip = ipDe(req)
      const conta = chaveIdentificador(dados.codigoEmpresa, dados.nomeUtilizador)
      limitar(res, limites.recuperacaoIp.esperaMs(ip), limites.recuperacaoConta.esperaMs(conta))
      limites.recuperacaoIp.registarFalha(ip)
      limites.recuperacaoConta.registarFalha(conta)
      await identidade.pedirRecuperacao(dados)
      res.status(202).json({ mensagem: MENSAGEM_RECUPERACAO })
    },
  )

  router.post(
    '/recuperacao/concluir',
    validar({ corpo: z.strictObject({ token: z.string().max(100), codigoNovo: esquemaCodigoSecreto }) }),
    async (req, res) => {
      const { token, codigoNovo } = res.locals.validado.corpo as { token: string; codigoNovo: string }
      const ip = ipDe(req)
      limitar(res, limites.tokensIp.esperaMs(ip))
      const problemas = problemasDoCodigo(codigoNovo)
      if (problemas.length) throw erroCodigo('codigoNovo', problemas)
      const ok = await identidade.concluirRecuperacao(token, codigoNovo)
      if (!ok) {
        limites.tokensIp.registarFalha(ip)
        throw new ErroApi(400, 'link_invalido', 'O link é inválido, já foi usado ou expirou. Peça um novo.')
      }
      res.json({ redefinido: true })
    },
  )

  router.post(
    '/codigo',
    sessao,
    validar({ corpo: z.strictObject({ codigoActual: esquemaCodigoSecreto, codigoNovo: esquemaCodigoSecreto }) }),
    async (req, res) => {
      const s = sessaoDe(req)
      const { codigoActual, codigoNovo } = res.locals.validado.corpo as { codigoActual: string; codigoNovo: string }
      limitar(res, limites.codigoProprio.esperaMs(s.utilizadorId))
      const problemas = problemasDoCodigo(codigoNovo, { nomeUtilizador: s.nomeUtilizador })
      if (codigoNovo === codigoActual) problemas.push('O código novo tem de ser diferente do actual.')
      if (problemas.length) throw erroCodigo('codigoNovo', problemas)
      if (!(await identidade.alterarCodigoProprio(s, codigoActual, codigoNovo))) {
        limites.codigoProprio.registarFalha(s.utilizadorId)
        throw new ErroApi(400, 'codigo_actual_incorrecto', 'O código actual está incorrecto.')
      }
      res.json({ alterado: true, outrasSessoesTerminadas: true })
    },
  )

  router.post(
    '/email',
    sessao,
    exigirFuncao('proprietario'),
    validar({ corpo: z.strictObject({ codigoActual: esquemaCodigoSecreto, email: esquemaEmail }) }),
    async (req, res) => {
      const s = sessaoDe(req)
      const { codigoActual, email } = res.locals.validado.corpo as { codigoActual: string; email: string }
      limitar(res, limites.codigoProprio.esperaMs(s.utilizadorId))
      if (!(await identidade.definirEmailRecuperacao(s, codigoActual, email))) {
        limites.codigoProprio.registarFalha(s.utilizadorId)
        throw new ErroApi(400, 'codigo_actual_incorrecto', 'O código actual está incorrecto.')
      }
      res.status(202).json({ mensagem: 'Enviámos um link de confirmação para o novo e-mail. Até o confirmar, vale o anterior (se existir).' })
    },
  )

  router.post('/email/reenviar', sessao, exigirFuncao('proprietario'), async (req, res) => {
    const s = sessaoDe(req)
    limitar(res, limites.recuperacaoConta.esperaMs(`reenvio:${s.utilizadorId}`))
    limites.recuperacaoConta.registarFalha(`reenvio:${s.utilizadorId}`)
    if (!(await identidade.reenviarConfirmacao(s))) throw new ErroApi(409, 'sem_email_pendente', 'Não há nenhum e-mail à espera de confirmação.')
    res.status(202).json({ mensagem: 'Enviámos de novo o link de confirmação.' })
  })

  return router
}
