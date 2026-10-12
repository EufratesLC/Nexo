// Administração da empresa: dados da empresa e da filial, contas de funcionários, filiais
// permitidas, desactivação, códigos de acesso e consulta da auditoria.
//
// As permissões verificam-se nas rotas (antes de tocar na base) E na base: os privilégios do papel
// e as políticas (0006) exigem o proprietário no contexto, a mesma empresa e outra conta que não a
// própria. Cada alteração e o seu registo de auditoria gravam-se na MESMA transacção.

import type { AcessoBase, ClienteTransaccao } from '../base/acesso.js'
import { contextoDaSessao, papelDaFuncao, type Funcao, type SessaoValidada } from '../base/contexto.js'
import { ErroApi } from '../http/erros.js'
import { comErrosDaBase } from '../http/errosBase.js'
import { novoResumo } from '../autenticacao/codigoSecreto.js'

export interface Empresa {
  id: string
  codigo: string
  nome: string
  nuit: string | null
  telefone: string | null
  endereco: string | null
}

export interface Filial {
  id: string
  codigo: string
  nome: string
}

export interface ContaUtilizador {
  id: string
  nomeUtilizador: string
  nome: string
  funcao: Funcao
  estado: 'activo' | 'desactivado'
  filiais: string[]
  criadoEm: string
  desactivadoEm: string | null
}

export interface EstadoEmailRecuperacao {
  email: string | null
  confirmadoEm: string | null
  emailPendente: string | null
}

export interface ResumoSessao {
  empresa: Empresa
  filiais: Filial[]
  /** Só para proprietários. */
  emailRecuperacao: EstadoEmailRecuperacao | null
}

export interface EntradaAuditoria {
  id: string
  criadoEm: string
  accao: string
  origem: string
  entidade: string
  entidadeId: string | null
  autor: { id: string; nome: string; nomeUtilizador: string } | null
  alvo: string | null
  antes: unknown
  depois: unknown
}

export interface ServicoAdministracao {
  resumoSessao(sessao: SessaoValidada): Promise<ResumoSessao>
  alterarEmpresa(sessao: SessaoValidada, dados: Partial<Pick<Empresa, 'nome' | 'nuit' | 'telefone' | 'endereco'>>): Promise<Empresa>
  alterarFilial(sessao: SessaoValidada, filialId: string, nome: string): Promise<Filial>
  listarUtilizadores(sessao: SessaoValidada): Promise<ContaUtilizador[]>
  obterUtilizador(sessao: SessaoValidada, id: string): Promise<ContaUtilizador>
  criarUtilizador(
    sessao: SessaoValidada,
    dados: { nome: string; nomeUtilizador: string; funcao: Funcao; filiais: string[]; codigoSecreto: string },
  ): Promise<ContaUtilizador>
  alterarUtilizador(sessao: SessaoValidada, id: string, dados: { nome?: string; funcao?: Funcao; filiais?: string[] }): Promise<ContaUtilizador>
  desactivarUtilizador(sessao: SessaoValidada, id: string): Promise<ContaUtilizador>
  reactivarUtilizador(sessao: SessaoValidada, id: string): Promise<ContaUtilizador>
  definirCodigo(sessao: SessaoValidada, id: string, codigoSecreto: string): Promise<void>
  listarAuditoria(sessao: SessaoValidada, opcoes: { limite: number; antes?: string }): Promise<EntradaAuditoria[]>
}

const SQL_UTILIZADORES = `
  SELECT u.id, u.nome_utilizador, u.nome, u.funcao, u.estado, u.criado_em, u.desactivado_em,
         coalesce(array_agg(uf.filial_id ORDER BY uf.filial_id) FILTER (WHERE uf.filial_id IS NOT NULL), '{}') AS filiais
    FROM nexo.utilizadores u
    LEFT JOIN nexo.utilizador_filiais uf ON uf.empresa_id = u.empresa_id AND uf.utilizador_id = u.id`

interface LinhaUtilizador {
  id: string
  nome_utilizador: string
  nome: string
  funcao: Funcao
  estado: 'activo' | 'desactivado'
  criado_em: Date
  desactivado_em: Date | null
  filiais: string[]
}

const conta = (l: LinhaUtilizador): ContaUtilizador => ({
  id: l.id,
  nomeUtilizador: l.nome_utilizador,
  nome: l.nome,
  funcao: l.funcao,
  estado: l.estado,
  filiais: l.filiais,
  criadoEm: new Date(l.criado_em).toISOString(),
  desactivadoEm: l.desactivado_em ? new Date(l.desactivado_em).toISOString() : null,
})

async function lerConta(c: ClienteTransaccao, id: string): Promise<ContaUtilizador> {
  const r = await c.query<LinhaUtilizador>(`${SQL_UTILIZADORES} WHERE u.id = $1 GROUP BY u.id`, [id])
  if (!r.rows[0]) throw new ErroApi(404, 'nao_encontrado', 'A conta indicada não existe nesta empresa.')
  return conta(r.rows[0])
}

async function auditar(
  c: ClienteTransaccao,
  sessao: SessaoValidada,
  accao: string,
  entidade: 'empresa' | 'filial' | 'utilizador',
  entidadeId: string,
  antes?: Record<string, unknown>,
  depois?: Record<string, unknown>,
): Promise<void> {
  await c.query(
    `INSERT INTO nexo.registo_auditoria (empresa_id, autor_id, origem, accao, entidade, entidade_id, antes, depois)
     VALUES ($1, $2, 'api', $3, $4, $5, $6, $7)`,
    [sessao.empresaId, sessao.utilizadorId, accao, entidade, entidadeId, antes ?? null, depois ?? null],
  )
}

function naoPropria(sessao: SessaoValidada, id: string): void {
  if (id === sessao.utilizadorId) {
    throw new ErroApi(403, 'propria_conta', 'Não pode alterar o perfil, as filiais, o estado nem o código da sua própria conta por aqui.')
  }
}

export function criarServicoAdministracao(base: AcessoBase): ServicoAdministracao {
  const transaccao = <T>(sessao: SessaoValidada, trabalho: (c: ClienteTransaccao) => Promise<T>) =>
    comErrosDaBase(() => base.executarTransaccao({ papel: papelDaFuncao(sessao.funcao), contexto: contextoDaSessao(sessao) }, trabalho))

  async function filiaisDaEmpresa(c: ClienteTransaccao, ids: string[]): Promise<void> {
    if (!ids.length) return
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM nexo.filiais WHERE id = ANY($1::uuid[])', [ids])
    if (r.rows[0].n !== new Set(ids).size) throw new ErroApi(422, 'filial_invalida', 'Uma das filiais indicadas não existe nesta empresa.')
  }

  return {
    resumoSessao: (sessao) =>
      transaccao(sessao, async (c) => {
        const e = await c.query<Empresa>('SELECT id, codigo, nome, nuit, telefone, endereco FROM nexo.empresas')
        if (!e.rows[0]) throw new Error('a empresa da sessão não é visível no contexto')
        const f = await c.query<Filial>('SELECT id, codigo, nome FROM nexo.filiais WHERE id = ANY($1::uuid[]) ORDER BY codigo', [[...sessao.filiais]])
        let emailRecuperacao: EstadoEmailRecuperacao | null = null
        if (sessao.funcao === 'proprietario') {
          const r = await c.query<{ email: string | null; confirmado_em: Date | null; email_pendente: string | null }>(
            'SELECT email, confirmado_em, email_pendente FROM nexo.contactos_recuperacao WHERE utilizador_id = $1',
            [sessao.utilizadorId],
          )
          const l = r.rows[0]
          emailRecuperacao = {
            email: l?.email ?? null,
            confirmadoEm: l?.confirmado_em ? new Date(l.confirmado_em).toISOString() : null,
            emailPendente: l?.email_pendente ?? null,
          }
        }
        return { empresa: e.rows[0], filiais: f.rows, emailRecuperacao }
      }),

    alterarEmpresa: (sessao, dados) =>
      transaccao(sessao, async (c) => {
        const antes = (await c.query<Empresa>('SELECT id, codigo, nome, nuit, telefone, endereco FROM nexo.empresas WHERE id = $1', [sessao.empresaId])).rows[0]
        if (!antes) throw new ErroApi(404, 'nao_encontrado', 'Empresa não encontrada.')
        const campos = (['nome', 'nuit', 'telefone', 'endereco'] as const).filter((k) => dados[k] !== undefined && dados[k] !== antes[k])
        if (!campos.length) return antes
        const r = await c.query<Empresa>(
          `UPDATE nexo.empresas SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')}
            WHERE id = $1 RETURNING id, codigo, nome, nuit, telefone, endereco`,
          [sessao.empresaId, ...campos.map((k) => dados[k])],
        )
        if (!r.rows[0]) throw new ErroApi(403, 'permissao_negada', 'A sua conta não tem permissão para alterar a empresa.')
        await auditar(
          c,
          sessao,
          'empresa.alterada',
          'empresa',
          sessao.empresaId,
          Object.fromEntries(campos.map((k) => [k, antes[k]])),
          Object.fromEntries(campos.map((k) => [k, dados[k]])),
        )
        return r.rows[0]
      }),

    alterarFilial: (sessao, filialId, nome) =>
      transaccao(sessao, async (c) => {
        const antes = (await c.query<Filial>('SELECT id, codigo, nome FROM nexo.filiais WHERE id = $1', [filialId])).rows[0]
        if (!antes) throw new ErroApi(404, 'nao_encontrado', 'A filial indicada não existe nesta empresa.')
        if (antes.nome === nome) return antes
        const r = await c.query<Filial>('UPDATE nexo.filiais SET nome = $2 WHERE id = $1 RETURNING id, codigo, nome', [filialId, nome])
        if (!r.rows[0]) throw new ErroApi(403, 'permissao_negada', 'A sua conta não tem permissão para alterar a filial.')
        await auditar(c, sessao, 'filial.alterada', 'filial', filialId, { nome: antes.nome }, { nome })
        return r.rows[0]
      }),

    listarUtilizadores: (sessao) =>
      transaccao(sessao, async (c) => {
        const r = await c.query<LinhaUtilizador>(`${SQL_UTILIZADORES} GROUP BY u.id ORDER BY u.estado, lower(u.nome), u.nome_utilizador`)
        return r.rows.map(conta)
      }),

    obterUtilizador: (sessao, id) => transaccao(sessao, (c) => lerConta(c, id)),

    async criarUtilizador(sessao, dados) {
      // O resumo calcula-se antes de abrir a transacção (não prende uma ligação durante o scrypt).
      const codigo = await novoResumo(dados.codigoSecreto)
      const filiais = dados.funcao === 'proprietario' ? [] : [...new Set(dados.filiais)]
      return transaccao(sessao, async (c) => {
        await filiaisDaEmpresa(c, filiais)
        const r = await c.query<{ id: string }>(
          `INSERT INTO nexo.utilizadores (empresa_id, nome_utilizador, nome, funcao, criado_por)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [sessao.empresaId, dados.nomeUtilizador, dados.nome, dados.funcao, sessao.utilizadorId],
        )
        const id = r.rows[0].id
        for (const filial of filiais) {
          await c.query('INSERT INTO nexo.utilizador_filiais (empresa_id, utilizador_id, filial_id) VALUES ($1, $2, $3)', [sessao.empresaId, id, filial])
        }
        await c.query('SELECT nexo.definir_codigo($1, $2, $3, $4)', [id, codigo.parametros, codigo.sal, codigo.resumo])
        await auditar(c, sessao, 'utilizador.criado', 'utilizador', id, undefined, {
          nome_utilizador: dados.nomeUtilizador,
          nome: dados.nome,
          funcao: dados.funcao,
          filiais,
        })
        return lerConta(c, id)
      })
    },

    async alterarUtilizador(sessao, id, dados) {
      naoPropria(sessao, id)
      return transaccao(sessao, async (c) => {
        const antes = await lerConta(c, id)
        if (dados.nome !== undefined && dados.nome !== antes.nome) {
          await c.query('UPDATE nexo.utilizadores SET nome = $2, actualizado_em = now() WHERE id = $1', [id, dados.nome])
          await auditar(c, sessao, 'utilizador.nome_alterado', 'utilizador', id, { nome: antes.nome }, { nome: dados.nome })
        }
        if (dados.funcao !== undefined && dados.funcao !== antes.funcao) {
          await c.query('UPDATE nexo.utilizadores SET funcao = $2, actualizado_em = now() WHERE id = $1', [id, dados.funcao])
          await auditar(c, sessao, 'utilizador.funcao_alterada', 'utilizador', id, { funcao: antes.funcao }, { funcao: dados.funcao })
        }
        const funcaoFinal = dados.funcao ?? antes.funcao
        // O proprietário tem todas as filiais: as linhas deixam de ser precisas.
        const filiaisNovas = funcaoFinal === 'proprietario' ? [] : dados.filiais !== undefined ? [...new Set(dados.filiais)].sort() : antes.filiais
        if (funcaoFinal !== 'proprietario' && filiaisNovas.length === 0) {
          throw new ErroApi(400, 'validacao', 'Um gestor ou operador precisa de pelo menos uma filial.', { campos: { 'corpo.filiais': ['Escolha pelo menos uma filial.'] } })
        }
        if (JSON.stringify(filiaisNovas) !== JSON.stringify([...antes.filiais].sort())) {
          await filiaisDaEmpresa(c, filiaisNovas)
          await c.query('DELETE FROM nexo.utilizador_filiais WHERE utilizador_id = $1', [id])
          for (const filial of filiaisNovas) {
            await c.query('INSERT INTO nexo.utilizador_filiais (empresa_id, utilizador_id, filial_id) VALUES ($1, $2, $3)', [sessao.empresaId, id, filial])
          }
          await auditar(c, sessao, 'utilizador.filiais_alteradas', 'utilizador', id, { filiais: antes.filiais }, { filiais: filiaisNovas })
        }
        return lerConta(c, id)
      })
    },

    async desactivarUtilizador(sessao, id) {
      naoPropria(sessao, id)
      return transaccao(sessao, async (c) => {
        const antes = await lerConta(c, id)
        if (antes.estado === 'desactivado') throw new ErroApi(409, 'estado_invalido', 'A conta já está desactivada.')
        await c.query("UPDATE nexo.utilizadores SET estado = 'desactivado', desactivado_em = now(), actualizado_em = now() WHERE id = $1", [id])
        const revogadas = (await c.query<{ n: number }>("SELECT nexo.revogar_sessoes($1, 'desactivacao') AS n", [id])).rows[0].n
        await auditar(c, sessao, 'utilizador.desactivado', 'utilizador', id, { estado: 'activo' }, { estado: 'desactivado', sessoes_revogadas: revogadas })
        return lerConta(c, id)
      })
    },

    async reactivarUtilizador(sessao, id) {
      naoPropria(sessao, id)
      return transaccao(sessao, async (c) => {
        const antes = await lerConta(c, id)
        if (antes.estado === 'activo') throw new ErroApi(409, 'estado_invalido', 'A conta já está activa.')
        await c.query("UPDATE nexo.utilizadores SET estado = 'activo', desactivado_em = NULL, actualizado_em = now() WHERE id = $1", [id])
        await auditar(c, sessao, 'utilizador.reactivado', 'utilizador', id, { estado: 'desactivado' }, { estado: 'activo' })
        return lerConta(c, id)
      })
    },

    async definirCodigo(sessao, id, codigoSecreto) {
      naoPropria(sessao, id)
      const codigo = await novoResumo(codigoSecreto)
      await transaccao(sessao, async (c) => {
        const alvo = await lerConta(c, id)
        if (alvo.funcao === 'proprietario') {
          throw new ErroApi(403, 'codigo_de_proprietario', 'O código de um proprietário recupera-se pelo e-mail confirmado ou pelo suporte.')
        }
        await c.query('SELECT nexo.definir_codigo($1, $2, $3, $4)', [id, codigo.parametros, codigo.sal, codigo.resumo])
      })
    },

    listarAuditoria: (sessao, opcoes) =>
      transaccao(sessao, async (c) => {
        const r = await c.query<{
          id: string
          criado_em: Date
          accao: string
          origem: string
          entidade: string
          entidade_id: string | null
          antes: unknown
          depois: unknown
          autor_id: string | null
          autor_nome: string | null
          autor_utilizador: string | null
          alvo: string | null
        }>(
          `SELECT a.id, a.criado_em, a.accao, a.origem, a.entidade, a.entidade_id, a.antes, a.depois,
                  a.autor_id, autor.nome AS autor_nome, autor.nome_utilizador AS autor_utilizador,
                  CASE a.entidade WHEN 'utilizador' THEN alvo.nome || ' (' || alvo.nome_utilizador || ')'
                                  WHEN 'filial' THEN f.codigo || ' ' || f.nome
                                  ELSE e.nome END AS alvo
             FROM nexo.registo_auditoria a
             LEFT JOIN nexo.utilizadores autor ON autor.empresa_id = a.empresa_id AND autor.id = a.autor_id
             LEFT JOIN nexo.utilizadores alvo ON a.entidade = 'utilizador' AND alvo.empresa_id = a.empresa_id AND alvo.id = a.entidade_id
             LEFT JOIN nexo.filiais f ON a.entidade = 'filial' AND f.empresa_id = a.empresa_id AND f.id = a.entidade_id
             LEFT JOIN nexo.empresas e ON e.id = a.empresa_id
            WHERE ($1::timestamptz IS NULL OR a.criado_em < $1)
            ORDER BY a.criado_em DESC, a.id DESC
            LIMIT $2`,
          [opcoes.antes ?? null, opcoes.limite],
        )
        return r.rows.map((l) => ({
          id: l.id,
          criadoEm: new Date(l.criado_em).toISOString(),
          accao: l.accao,
          origem: l.origem,
          entidade: l.entidade,
          entidadeId: l.entidade_id,
          autor: l.autor_id ? { id: l.autor_id, nome: l.autor_nome ?? '', nomeUtilizador: l.autor_utilizador ?? '' } : null,
          alvo: l.alvo,
          antes: l.antes,
          depois: l.depois,
        }))
      }),
  }
}
