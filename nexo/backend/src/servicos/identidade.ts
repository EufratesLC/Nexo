// Serviço de identidade: login, sessão, registo da empresa, e-mail de recuperação do proprietário,
// recuperação do acesso e alteração do próprio código. Fala com a base só pelas funções de
// nexo_autenticacao (0007) e pelas transacções com contexto.
//
// Registo (revisão de 08/10/2026, migração 0008): cria a empresa e o proprietário com a activação
// PENDENTE e não emite sessão. A conta só fica activa quando o e-mail é confirmado pelo link; até
// lá, o login responde "pendente" (a base não cria a sessão).
//
// É o ÚNICO sítio que cria uma SessaoValidada, e só com o que a base devolveu (verificado em
// testes/unidade/estatico.test.ts).

import type { AcessoBase } from '../base/acesso.js'
import { contextoDaSessao, FUNCOES, MARCA_SESSAO, papelDaFuncao, type Funcao, type SessaoValidada } from '../base/contexto.js'
import type { Configuracao } from '../config/ambiente.js'
import { dominioDe, type EnvioEmail, type MensagemEmail } from '../email/envio.js'
import { linkConfirmacao, linkRecuperacao, mensagemCodigoAlterado, mensagemConfirmacao, mensagemRecuperacao } from '../email/mensagens.js'
import { comErrosDaBase } from '../http/errosBase.js'
import type { Logger } from '../registo/logger.js'
import { calcularResumo, novoResumo, resumoFicticio } from '../autenticacao/codigoSecreto.js'
import { gerarToken, resumoToken, tokenValido } from '../autenticacao/tokens.js'

export const VALIDADE_CONFIRMACAO_HORAS = 48
export const VALIDADE_RECUPERACAO_MINUTOS = 30

export type ResultadoEntrada =
  | { tipo: 'ok'; token: string; sessao: SessaoValidada }
  | { tipo: 'invalido' }
  | { tipo: 'pendente' }
  | { tipo: 'desactivado' }

export type ResultadoConfirmacao = 'invalido' | 'confirmado' | 'activada'

export interface DadosRegisto {
  codigoEmpresa: string
  nomeEmpresa: string
  nuit?: string
  telefone?: string
  nome: string
  nomeUtilizador: string
  email: string
  codigoSecreto: string
}

export interface ServicoIdentidade {
  entrar(dados: { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string }): Promise<ResultadoEntrada>
  validarSessao(token: string): Promise<SessaoValidada | null>
  terminarSessao(token: string): Promise<void>
  /** Cria empresa, filial e proprietário (pendente) e envia o link de confirmação. Sem sessão. */
  registar(dados: DadosRegisto): Promise<void>
  confirmarEmail(token: string): Promise<ResultadoConfirmacao>
  /** Reenvia o link de um registo pendente (nada se a conta não estiver pendente). */
  reenviarActivacao(dados: { codigoEmpresa: string; nomeUtilizador: string }): Promise<void>
  /** Corrige o e-mail de um registo pendente; exige o código secreto. */
  corrigirEmailActivacao(dados: { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string; email: string }): Promise<boolean>
  pedirRecuperacao(dados: { codigoEmpresa: string; nomeUtilizador: string }): Promise<void>
  concluirRecuperacao(token: string, codigoNovo: string): Promise<boolean>
  alterarCodigoProprio(sessao: SessaoValidada, codigoActual: string, codigoNovo: string): Promise<boolean>
  definirEmailRecuperacao(sessao: SessaoValidada, codigoActual: string, email: string): Promise<boolean>
  reenviarConfirmacao(sessao: SessaoValidada): Promise<boolean>
}

const intervalo = (ms: number) => `${Math.round(ms)} milliseconds`

interface LinhaSessao {
  sessao_id: string
  empresa_id: string
  utilizador_id: string
  funcao: string
  nome: string
  nome_utilizador: string
  filiais: string[]
  expira_em: Date
}

function sessaoDaBase(l: LinhaSessao): SessaoValidada {
  if (!FUNCOES.includes(l.funcao as Funcao)) throw new Error('função desconhecida devolvida pela base')
  return Object.freeze({
    [MARCA_SESSAO]: true as const,
    sessaoId: l.sessao_id,
    empresaId: l.empresa_id,
    utilizadorId: l.utilizador_id,
    funcao: l.funcao as Funcao,
    nome: l.nome,
    nomeUtilizador: l.nome_utilizador,
    filiais: Object.freeze([...l.filiais]),
    expiraEm: new Date(l.expira_em),
  })
}

export function criarServicoIdentidade(deps: { base: AcessoBase; config: Configuracao; email: EnvioEmail; logger: Logger }): ServicoIdentidade {
  const { base, config, email, logger } = deps

  /** Envio em segundo plano: a resposta HTTP não espera nem revela se houve envio. */
  function enviarDepois(mensagem: MensagemEmail): void {
    email.enviar(mensagem).then(
      () => logger.info({ finalidade: mensagem.finalidade, destino: dominioDe(mensagem.para), transporte: email.transporte }, 'e-mail entregue ao transporte'),
      (erro: unknown) => logger.warn({ err: erro, finalidade: mensagem.finalidade, transporte: email.transporte }, 'falha no envio de e-mail'),
    )
  }

  async function validarSessao(token: string): Promise<SessaoValidada | null> {
    if (!tokenValido('sessao', token)) return null
    const linhas = await base.chamarIdentidade<LinhaSessao>('validar_sessao', [resumoToken(token)])
    return linhas[0] ? sessaoDaBase(linhas[0]) : null
  }

  async function entrar(dados: { codigoEmpresa: string; nomeUtilizador: string; codigoSecreto: string }): Promise<ResultadoEntrada> {
    const parametros = await base.chamarIdentidade<{ parametros: string; sal: Buffer }>('parametros_acesso', [dados.codigoEmpresa, dados.nomeUtilizador])
    // Conta inexistente: o mesmo cálculo e as mesmas chamadas, para o tempo não a revelar.
    const resumo = parametros[0]
      ? await calcularResumo(dados.codigoSecreto, parametros[0].sal, parametros[0].parametros)
      : await resumoFicticio(dados.codigoSecreto)
    const { token, resumo: resumoSessao } = gerarToken('sessao')
    const [r] = await base.chamarIdentidade<{ resultado: string }>('iniciar_sessao', [
      dados.codigoEmpresa,
      dados.nomeUtilizador,
      resumo,
      resumoSessao,
      intervalo(config.sessao.duracaoMs),
      intervalo(config.sessao.inactividadeMs),
    ])
    if (r?.resultado === 'desactivado') return { tipo: 'desactivado' }
    if (r?.resultado === 'pendente') return { tipo: 'pendente' }
    if (r?.resultado !== 'ok') return { tipo: 'invalido' }
    const sessao = await validarSessao(token)
    if (!sessao) return { tipo: 'invalido' }
    return { tipo: 'ok', token, sessao }
  }

  async function parametrosProprios(sessao: SessaoValidada): Promise<{ parametros: string; sal: Buffer }> {
    const [p] = await base.executarTransaccao({ papel: papelDaFuncao(sessao.funcao), contexto: contextoDaSessao(sessao) }, async (c) =>
      (await c.query<{ parametros: string; sal: Buffer }>('SELECT parametros, sal FROM nexo.parametros_acesso_proprios()')).rows,
    )
    if (!p) throw new Error('conta sem código de acesso')
    return p
  }

  return {
    entrar,
    validarSessao,

    async terminarSessao(token) {
      if (!tokenValido('sessao', token)) return
      await base.chamarIdentidade('terminar_sessao', [resumoToken(token)])
    },

    async registar(dados) {
      const codigo = await novoResumo(dados.codigoSecreto)
      const { token: tokenEmail, resumo: resumoEmail } = gerarToken('email')
      await comErrosDaBase(() =>
        base.chamarIdentidade('registar_empresa', [
          dados.codigoEmpresa,
          dados.nomeEmpresa,
          dados.nuit ?? null,
          dados.telefone ?? null,
          dados.nome,
          dados.nomeUtilizador,
          dados.email,
          codigo.parametros,
          codigo.sal,
          codigo.resumo,
          resumoEmail,
          intervalo(VALIDADE_CONFIRMACAO_HORAS * 3_600_000),
        ]),
      )
      // Sem sessão: a conta fica pendente até o e-mail ser confirmado.
      enviarDepois(mensagemConfirmacao(dados.email.trim().toLowerCase(), linkConfirmacao(config.urlAplicacao, tokenEmail), VALIDADE_CONFIRMACAO_HORAS))
    },

    async confirmarEmail(token) {
      if (!tokenValido('email', token)) return 'invalido'
      const [r] = await base.chamarIdentidade<{ resultado: string }>('confirmar_email', [resumoToken(token)])
      return r?.resultado === 'activada' ? 'activada' : r?.resultado === 'ok' ? 'confirmado' : 'invalido'
    },

    async reenviarActivacao(dados) {
      const { token, resumo } = gerarToken('email')
      const linhas = await base.chamarIdentidade<{ email: string }>('reenviar_activacao', [
        dados.codigoEmpresa,
        dados.nomeUtilizador,
        resumo,
        intervalo(VALIDADE_CONFIRMACAO_HORAS * 3_600_000),
      ])
      if (linhas[0]) enviarDepois(mensagemConfirmacao(linhas[0].email, linkConfirmacao(config.urlAplicacao, token), VALIDADE_CONFIRMACAO_HORAS))
    },

    async corrigirEmailActivacao(dados) {
      const parametros = await base.chamarIdentidade<{ parametros: string; sal: Buffer }>('parametros_acesso', [dados.codigoEmpresa, dados.nomeUtilizador])
      const resumo = parametros[0]
        ? await calcularResumo(dados.codigoSecreto, parametros[0].sal, parametros[0].parametros)
        : await resumoFicticio(dados.codigoSecreto)
      const { token, resumo: resumoEmail } = gerarToken('email')
      const linhas = await base.chamarIdentidade<{ email: string }>('corrigir_email_activacao', [
        dados.codigoEmpresa,
        dados.nomeUtilizador,
        resumo,
        dados.email,
        resumoEmail,
        intervalo(VALIDADE_CONFIRMACAO_HORAS * 3_600_000),
      ])
      if (!linhas[0]) return false
      enviarDepois(mensagemConfirmacao(linhas[0].email, linkConfirmacao(config.urlAplicacao, token), VALIDADE_CONFIRMACAO_HORAS))
      return true
    },

    async pedirRecuperacao(dados) {
      const { token, resumo } = gerarToken('email')
      const linhas = await base.chamarIdentidade<{ email: string }>('pedir_recuperacao', [
        dados.codigoEmpresa,
        dados.nomeUtilizador,
        resumo,
        intervalo(VALIDADE_RECUPERACAO_MINUTOS * 60_000),
      ])
      if (linhas[0]) enviarDepois(mensagemRecuperacao(linhas[0].email, linkRecuperacao(config.urlAplicacao, token), VALIDADE_RECUPERACAO_MINUTOS))
    },

    async concluirRecuperacao(token, codigoNovo) {
      if (!tokenValido('email', token)) return false
      const codigo = await novoResumo(codigoNovo)
      const [r] = await base.chamarIdentidade<{ resultado: string; email: string | null }>('concluir_recuperacao', [
        resumoToken(token),
        codigo.parametros,
        codigo.sal,
        codigo.resumo,
      ])
      if (r?.resultado !== 'ok') return false
      if (r.email) enviarDepois(mensagemCodigoAlterado(r.email, new Date()))
      return true
    },

    async alterarCodigoProprio(sessao, codigoActual, codigoNovo) {
      const p = await parametrosProprios(sessao)
      const actual = await calcularResumo(codigoActual, p.sal, p.parametros)
      const novo = await novoResumo(codigoNovo)
      return base.executarTransaccao({ papel: papelDaFuncao(sessao.funcao), contexto: contextoDaSessao(sessao) }, async (c) =>
        (
          await c.query<{ ok: boolean }>('SELECT nexo.alterar_codigo_proprio($1, $2, $3, $4, $5) AS ok', [
            sessao.sessaoId,
            actual,
            novo.parametros,
            novo.sal,
            novo.resumo,
          ])
        ).rows[0]?.ok === true,
      )
    },

    async definirEmailRecuperacao(sessao, codigoActual, endereco) {
      const p = await parametrosProprios(sessao)
      const actual = await calcularResumo(codigoActual, p.sal, p.parametros)
      const { token, resumo } = gerarToken('email')
      const ok = await base.executarTransaccao({ papel: papelDaFuncao(sessao.funcao), contexto: contextoDaSessao(sessao) }, async (c) =>
        (
          await c.query<{ ok: boolean }>('SELECT nexo.definir_email_recuperacao($1, $2, $3, $4::interval) AS ok', [
            actual,
            endereco,
            resumo,
            intervalo(VALIDADE_CONFIRMACAO_HORAS * 3_600_000),
          ])
        ).rows[0]?.ok === true,
      )
      if (ok) enviarDepois(mensagemConfirmacao(endereco.trim().toLowerCase(), linkConfirmacao(config.urlAplicacao, token), VALIDADE_CONFIRMACAO_HORAS))
      return ok
    },

    async reenviarConfirmacao(sessao) {
      const { token, resumo } = gerarToken('email')
      const linhas = await base.executarTransaccao({ papel: papelDaFuncao(sessao.funcao), contexto: contextoDaSessao(sessao) }, async (c) =>
        (
          await c.query<{ email: string }>('SELECT email FROM nexo.reenviar_confirmacao_email($1, $2::interval)', [
            resumo,
            intervalo(VALIDADE_CONFIRMACAO_HORAS * 3_600_000),
          ])
        ).rows,
      )
      if (!linhas[0]) return false
      enviarDepois(mensagemConfirmacao(linhas[0].email, linkConfirmacao(config.urlAplicacao, token), VALIDADE_CONFIRMACAO_HORAS))
      return true
    },
  }
}
