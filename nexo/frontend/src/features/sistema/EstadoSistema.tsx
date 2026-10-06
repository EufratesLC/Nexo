// Estado da infraestrutura REAL (API e base de dados de desenvolvimento). Só leitura.
// Não usa nem altera os dados fictícios da demonstração.

import { CabecalhoPagina, Cartao, Etiqueta, Aviso } from '../../components/ui'
import { Carregando, EstadoErro } from '../../components/estados'
import { configuracao } from '../../config/ambiente'
import { useRecurso } from '../../lib/useRecurso'
import { obterSaudeApi, obterSaudeBase, type SaudeBase } from '../../servicos/saude'

const MOTIVOS: Record<NonNullable<SaudeBase['base']['motivo']>, string> = {
  nao_configurada: 'A API não tem DATABASE_URL definida (normal no desenvolvimento local sem Supabase).',
  sem_ligacao: 'A API não conseguiu ligar à base de dados.',
  papel_inseguro: 'A ligação da API usa um papel que ignora as políticas. A API não deve ser usada assim.',
  migracoes_em_falta: 'A base responde, mas as migrações ainda não foram aplicadas.',
}

export function EstadoSistema() {
  const [api, repetirApi] = useRecurso(obterSaudeApi)
  const [base, repetirBase] = useRecurso(obterSaudeBase)

  return (
    <>
      <CabecalhoPagina
        titulo="Estado do sistema"
        descricao="Infraestrutura real de desenvolvimento: API e base de dados. Não faz parte da demonstração."
      />
      {configuracao.modo === 'demonstracao' && (
        <Aviso tom="info" titulo="Fora da demonstração">
          Esta página contacta a API real, só para leitura. Os ecrãs de demonstração continuam a usar dados fictícios
          guardados neste navegador e nunca escrevem na base de desenvolvimento.
        </Aviso>
      )}
      <div className="grelha-2">
        <Cartao titulo="API">
          {api.tipo === 'a_carregar' && <Carregando texto="A contactar a API…" />}
          {api.tipo === 'erro' && <EstadoErro erro={api.erro} titulo="API indisponível" aoRepetir={repetirApi} />}
          {api.tipo === 'pronto' && (
            <ul className="lista-estado">
              <li>
                <span>Estado</span>
                <Etiqueta tom="sucesso">A responder</Etiqueta>
              </li>
              <li>
                <span>Ambiente</span>
                <strong>{api.dados.ambiente}</strong>
              </li>
              <li>
                <span>Endereço</span>
                <code>{configuracao.apiUrl}</code>
              </li>
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Base de dados">
          {base.tipo === 'a_carregar' && <Carregando texto="A verificar a base…" />}
          {base.tipo === 'erro' && <EstadoErro erro={base.erro} titulo="Sem resposta" aoRepetir={repetirBase} />}
          {base.tipo === 'pronto' && (
            <ul className="lista-estado">
              <li>
                <span>Estado</span>
                {base.dados.estado === 'ok' ? <Etiqueta tom="sucesso">Pronta</Etiqueta> : <Etiqueta tom="aviso">Indisponível</Etiqueta>}
              </li>
              <li>
                <span>Papel da ligação</span>
                <span>
                  {base.dados.base.papelSeguro === null ? '—' : base.dados.base.papelSeguro ? 'sem BYPASSRLS' : 'INSEGURO'}
                </span>
              </li>
              <li>
                <span>Última migração</span>
                <span>{base.dados.base.versaoMigracao ?? '—'}</span>
              </li>
              {base.dados.base.motivo && (
                <li>
                  <span className="texto-secundario">{MOTIVOS[base.dados.base.motivo]}</span>
                </li>
              )}
            </ul>
          )}
        </Cartao>
      </div>
      <Cartao titulo="Aplicação">
        <ul className="lista-estado">
          <li>
            <span>Modo</span>
            <strong>{configuracao.modo === 'demonstracao' ? 'Demonstração (dados fictícios)' : 'API'}</strong>
          </li>
          <li>
            <span>Versão da aplicação</span>
            <code>{__NEXO_VERSAO_APP__}</code>
          </li>
          <li>
            <span>Funcionamento sem rede</span>
            <span>Preparado (PWA e base local); vendas offline só na Etapa 7</span>
          </li>
        </ul>
      </Cartao>
    </>
  )
}
