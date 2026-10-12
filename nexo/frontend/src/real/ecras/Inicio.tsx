// Início da aplicação real. Sem dados comerciais: vendas, stock e relatórios reais chegam nas
// etapas seguintes. Nenhum dado fictício é mostrado como dado da empresa.

import { Aviso, CabecalhoPagina, Cartao } from '../../components/ui'
import { NOMES_FUNCAO } from '../../servicos/autenticacao'
import { useSessaoActiva } from '../useSessao'

export function Inicio() {
  const s = useSessaoActiva()
  const dono = s.utilizador.funcao === 'proprietario'
  const email = s.emailRecuperacao
  return (
    <>
      <CabecalhoPagina titulo={`Olá, ${s.utilizador.nome}`} descricao={`${NOMES_FUNCAO[s.utilizador.funcao]} · ${s.empresa.nome}`} />
      {dono && !email?.email && (
        <Aviso tom="aviso" titulo="Confirme o e-mail de recuperação">
          {email?.emailPendente
            ? `Enviámos um link para ${email.emailPendente}. Sem e-mail confirmado não é possível recuperar o acesso se perder o código.`
            : 'Ainda não tem e-mail de recuperação. Sem ele não é possível recuperar o acesso se perder o código.'}{' '}
          <a href="#/meu-acesso">Tratar em "O meu acesso"</a>.
        </Aviso>
      )}
      <div className="grelha-2">
        <Cartao titulo="A sua conta">
          <ul className="lista-estado">
            <li>
              <span>Empresa</span>
              <strong>{s.empresa.nome}</strong>
            </li>
            <li>
              <span>Código da empresa</span>
              <code>{s.empresa.codigo}</code>
            </li>
            <li>
              <span>Filial</span>
              <span>{s.filialActual ? `${s.filialActual.codigo} · ${s.filialActual.nome}` : '—'}</span>
            </li>
            <li>
              <span>Nome de utilizador</span>
              <code>{s.utilizador.nomeUtilizador}</code>
            </li>
            <li>
              <span>Função</span>
              <span>{NOMES_FUNCAO[s.utilizador.funcao]}</span>
            </li>
          </ul>
        </Cartao>
        <Cartao titulo="Nesta versão">
          <ul className="lista-simples">
            {dono && (
              <li>
                <a href="#/funcionarios">Criar e gerir as contas dos funcionários</a>
              </li>
            )}
            <li>
              <a href="#/empresa">{dono ? 'Dados da empresa e da filial' : 'Ver os dados da empresa'}</a>
            </li>
            <li>
              <a href="#/meu-acesso">Alterar o meu código de acesso</a>
            </li>
            {dono && (
              <li>
                <a href="#/auditoria">Registo de alterações administrativas</a>
              </li>
            )}
          </ul>
          <p className="nota">Vendas, stock, caixa e relatórios reais chegam nas próximas etapas. Até lá, não há dados comerciais nesta aplicação.</p>
        </Cartao>
      </div>
    </>
  )
}
