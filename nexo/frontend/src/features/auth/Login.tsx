import { navegar } from '../../app/rotas'
import { Aviso } from '../../components/ui'
import { entrar } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { NOMES_PAPEL } from '../../demo/regras'

export function Login() {
  const { estado, executar } = useDemo()

  return (
    <main className="login">
      <div className="login-caixa">
        <span className="marca marca-grande">Nexo</span>
        <h1>Entrar na demonstração</h1>
        <Aviso tom="aviso" titulo="Login demonstrativo">
          Não é autenticação real: não há palavra-passe nem servidor. Escolha um perfil fictício para ver o que cada
          função pode fazer.
        </Aviso>
        <ul className="login-perfis">
          {estado.utilizadores.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="login-perfil"
                onClick={() => {
                  executar((e) => entrar(e, u.id))
                  navegar('painel')
                }}
              >
                <strong>{u.nome}</strong>
                <span>{NOMES_PAPEL[u.papel]}</span>
                <small>
                  {u.papel === 'operador'
                    ? 'Balcão, caixa e consulta de produtos. Precisa de autorização para excepções.'
                    : u.papel === 'gestor'
                      ? 'Gestão de stock, compras, despesas e relatórios. Desconto até 20%.'
                      : 'Acesso completo. Desconto sem limite.'}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <p className="nota">
          {estado.empresa.nome} · {estado.empresa.filial} · dispositivo {estado.empresa.codigoDispositivo}
        </p>
      </div>
    </main>
  )
}
