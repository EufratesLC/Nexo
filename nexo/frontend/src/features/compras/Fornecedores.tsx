import { useState } from 'react'
import { navegar } from '../../app/rotas'
import { Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Tabela } from '../../components/ui'
import { guardarFornecedor } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { formatarMzn } from '../../lib/dinheiro'
import { novoId } from '../../lib/ids'
import { pagoCompra, totalCompra } from './calculos'

export function Fornecedores() {
  const { estado, executar } = useDemo()
  const [nome, setNome] = useState('')
  const [nuit, setNuit] = useState('')
  const [telefone, setTelefone] = useState('')
  const [erros, setErros] = useState<{ nome?: string; nuit?: string; telefone?: string }>({})

  const guardar = () => {
    const novos: typeof erros = {}
    if (nome.trim().length < 2) novos.nome = 'Indique o nome.'
    if (nuit !== '' && !/^\d{9}$/.test(nuit)) novos.nuit = 'O NUIT tem 9 dígitos.'
    if (telefone !== '' && !/^\+?[\d\s]{9,15}$/.test(telefone)) novos.telefone = 'Telefone inválido.'
    setErros(novos)
    if (Object.keys(novos).length > 0) return
    executar((e) => guardarFornecedor(e, { id: novoId(), nome: nome.trim(), nuit, telefone: telefone.trim() }))
    setNome('')
    setNuit('')
    setTelefone('')
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Fornecedores"
        accoes={
          <Botao variante="secundario" onClick={() => navegar('compras')}>
            Voltar às compras
          </Botao>
        }
      />
      <div className="grelha-2">
        <Cartao titulo="Lista">
          {estado.fornecedores.length === 0 ? (
            <EstadoVazio titulo="Ainda não há fornecedores" />
          ) : (
            <Tabela>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Contacto</th>
                  <th className="num">Em dívida</th>
                </tr>
              </thead>
              <tbody>
                {estado.fornecedores.map((f) => {
                  const divida = estado.compras
                    .filter((c) => c.fornecedorId === f.id && c.estado === 'recebida')
                    .reduce((s, c) => s + totalCompra(c) - pagoCompra(c), 0)
                  return (
                    <tr key={f.id}>
                      <td>
                        {f.nome}
                        {f.nuit && <div className="texto-secundario">NUIT {f.nuit}</div>}
                      </td>
                      <td>{f.telefone || '—'}</td>
                      <td className="num">{formatarMzn(divida)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </Tabela>
          )}
        </Cartao>
        <Cartao titulo="Novo fornecedor">
          <form
            className="formulario"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              guardar()
            }}
          >
            <Campo rotulo="Nome *" erro={erros.nome}>
              {(p) => <input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
            </Campo>
            <Campo rotulo="NUIT" erro={erros.nuit} ajuda="Opcional, 9 dígitos.">
              {(p) => <input {...p} inputMode="numeric" value={nuit} onChange={(e) => setNuit(e.target.value.trim())} />}
            </Campo>
            <Campo rotulo="Telefone" erro={erros.telefone}>
              {(p) => <input {...p} inputMode="tel" placeholder="+258 84 …" value={telefone} onChange={(e) => setTelefone(e.target.value)} />}
            </Campo>
            <Botao type="submit">Guardar fornecedor</Botao>
          </form>
        </Cartao>
      </div>
    </>
  )
}
