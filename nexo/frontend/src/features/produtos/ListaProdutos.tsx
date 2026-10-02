import { useState } from 'react'
import { navegar } from '../../app/rotas'
import { Botao, CabecalhoPagina, Campo, EstadoVazio, Etiqueta, Tabela } from '../../components/ui'
import { useDemo } from '../../demo/contexto'
import { podeGerir } from '../../demo/regras'
import { formatarMzn, formatarQuantidade } from '../../lib/dinheiro'

export function ListaProdutos() {
  const { estado, utilizador } = useDemo()
  const [pesquisa, setPesquisa] = useState('')
  const [categoria, setCategoria] = useState('')
  const [soBaixo, setSoBaixo] = useState(false)
  const gestor = podeGerir(utilizador)

  const termo = pesquisa.trim().toLowerCase()
  const lista = estado.produtos.filter(
    (p) =>
      (termo === '' || p.nome.toLowerCase().includes(termo) || p.codigo.toLowerCase().includes(termo) || p.codigoBarras.includes(termo)) &&
      (categoria === '' || p.categoriaId === categoria) &&
      (!soBaixo || (p.stockMinimo > 0 && p.stock <= p.stockMinimo)),
  )

  return (
    <>
      <CabecalhoPagina
        titulo="Produtos"
        descricao={gestor ? 'Catálogo, preços e stock da filial.' : 'Consulta do catálogo. Só gestor e proprietário alteram produtos.'}
        accoes={gestor && <Botao onClick={() => navegar('produtos/novo')}>Novo produto</Botao>}
      />
      <div className="filtros">
        <Campo rotulo="Pesquisar">
          {(p) => (
            <input {...p} type="search" placeholder="Nome, código ou código de barras" value={pesquisa} onChange={(e) => setPesquisa(e.target.value)} />
          )}
        </Campo>
        <Campo rotulo="Categoria">
          {(p) => (
            <select {...p} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas</option>
              {estado.categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <label className="caixa-seleccao">
          <input type="checkbox" checked={soBaixo} onChange={(e) => setSoBaixo(e.target.checked)} /> Só stock baixo
        </label>
      </div>
      {lista.length === 0 ? (
        <EstadoVazio titulo="Nenhum produto encontrado">Altere a pesquisa ou os filtros.</EstadoVazio>
      ) : (
        <Tabela>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria</th>
              <th className="num">Preço</th>
              {gestor && <th className="num">Custo (fictício)</th>}
              <th className="num">Stock</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const baixo = p.stockMinimo > 0 && p.stock <= p.stockMinimo
              return (
                <tr key={p.id}>
                  <td>
                    {gestor ? <a href={`#/produtos/${p.id}`}>{p.nome}</a> : p.nome}
                    <div className="texto-secundario">{p.codigo}</div>
                  </td>
                  <td>{estado.categorias.find((c) => c.id === p.categoriaId)?.nome}</td>
                  <td className="num">{formatarMzn(p.precoCentavos)}</td>
                  {gestor && <td className="num">{formatarMzn(p.custoCentavos)}</td>}
                  <td className="num">{formatarQuantidade(p.stock, p.unidade)}</td>
                  <td>
                    {!p.activo ? (
                      <Etiqueta>Inactivo</Etiqueta>
                    ) : p.stock < 0 ? (
                      <Etiqueta tom="perigo">Stock negativo</Etiqueta>
                    ) : baixo ? (
                      <Etiqueta tom="aviso">Stock baixo</Etiqueta>
                    ) : (
                      <Etiqueta tom="sucesso">OK</Etiqueta>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Tabela>
      )}
    </>
  )
}
