import { useState } from 'react'
import { navegar } from '../../app/rotas'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio } from '../../components/ui'
import { guardarProduto } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { podeGerir } from '../../demo/regras'
import type { Produto, Unidade } from '../../demo/tipos'
import { formatarValor, lerMzn, lerQuantidade } from '../../lib/dinheiro'
import { novoId } from '../../lib/ids'

const UNIDADES: { valor: Unidade; rotulo: string; fraccionavel: boolean }[] = [
  { valor: 'un', rotulo: 'Unidade (un)', fraccionavel: false },
  { valor: 'kg', rotulo: 'Quilograma (kg)', fraccionavel: true },
  { valor: 'L', rotulo: 'Litro (L)', fraccionavel: true },
  { valor: 'cx', rotulo: 'Caixa (cx)', fraccionavel: false },
  { valor: 'pct', rotulo: 'Pacote (pct)', fraccionavel: false },
]

type Erros = Partial<Record<'nome' | 'categoria' | 'preco' | 'minimo' | 'codigoBarras' | 'geral', string>>

export function FormularioProduto({ produtoId }: { produtoId?: string }) {
  const { estado, utilizador, executar } = useDemo()
  const existente = produtoId ? estado.produtos.find((p) => p.id === produtoId) : undefined
  const [nome, setNome] = useState(existente?.nome ?? '')
  const [categoriaId, setCategoriaId] = useState(existente?.categoriaId ?? '')
  const [unidade, setUnidade] = useState<Unidade>(existente?.unidade ?? 'un')
  const [preco, setPreco] = useState(existente ? formatarValor(existente.precoCentavos) : '')
  const [minimo, setMinimo] = useState(existente ? String(existente.stockMinimo) : '0')
  const [codigoBarras, setCodigoBarras] = useState(existente?.codigoBarras ?? '')
  const [activo, setActivo] = useState(existente?.activo ?? true)
  const [erros, setErros] = useState<Erros>({})

  if (!podeGerir(utilizador)) {
    return <EstadoVazio titulo="Sem permissão">Só gestor e proprietário criam ou alteram produtos.</EstadoVazio>
  }
  if (produtoId && !existente) {
    return <EstadoVazio titulo="Produto não encontrado" accao={<a href="#/produtos">Voltar aos produtos</a>} />
  }

  const fraccionavel = UNIDADES.find((u) => u.valor === unidade)?.fraccionavel ?? false

  const guardar = () => {
    const novos: Erros = {}
    const precoCentavos = lerMzn(preco)
    const stockMinimo = lerQuantidade(minimo, fraccionavel)
    if (nome.trim().length < 2) novos.nome = 'Indique o nome (mínimo 2 caracteres).'
    if (!categoriaId) novos.categoria = 'Escolha uma categoria.'
    if (precoCentavos === null || precoCentavos <= 0) novos.preco = 'Indique um preço maior do que zero, por exemplo 180,00.'
    if (stockMinimo === null) novos.minimo = fraccionavel ? 'Número com até 3 casas decimais.' : 'Número inteiro, 0 ou mais.'
    if (codigoBarras !== '' && !/^\d{8,14}$/.test(codigoBarras)) novos.codigoBarras = 'Entre 8 e 14 dígitos, ou deixe vazio.'
    if (existente && existente.stock !== 0 && existente.activo && !activo) {
      if (!window.confirm(`O produto tem stock ${existente.stock}. Desactivar mesmo assim? (D.2.5)`)) return
    }
    if (Object.keys(novos).length > 0) {
      setErros(novos)
      return
    }
    const produto: Produto = {
      id: existente?.id ?? novoId(),
      nome: nome.trim(),
      categoriaId,
      unidade,
      codigo: existente?.codigo ?? `P${String(estado.produtos.length + 1).padStart(3, '0')}`,
      codigoBarras,
      precoCentavos: precoCentavos ?? 0,
      custoCentavos: existente?.custoCentavos ?? 0,
      stock: existente?.stock ?? 0,
      stockMinimo: stockMinimo ?? 0,
      activo,
    }
    const erro = executar((e) => guardarProduto(e, produto))
    if (erro) setErros({ codigoBarras: erro })
    else navegar('produtos')
  }

  return (
    <>
      <CabecalhoPagina titulo={existente ? 'Editar produto' : 'Novo produto'} descricao="Os campos marcados com * são obrigatórios." />
      <Cartao>
        <form
          className="formulario grelha-formulario"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
        >
          <Campo rotulo="Nome *" erro={erros.nome}>
            {(p) => <input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
          </Campo>
          <Campo rotulo="Categoria *" erro={erros.categoria}>
            {(p) => (
              <select {...p} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">Escolher…</option>
                {estado.categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Unidade *">
            {(p) => (
              <select {...p} value={unidade} onChange={(e) => setUnidade(e.target.value as Unidade)} disabled={Boolean(existente)}>
                {UNIDADES.map((u) => (
                  <option key={u.valor} value={u.valor}>
                    {u.rotulo}
                  </option>
                ))}
              </select>
            )}
          </Campo>
          <Campo rotulo="Preço de venda (MZN) *" erro={erros.preco}>
            {(p) => <input {...p} inputMode="decimal" placeholder="0,00" value={preco} onChange={(e) => setPreco(e.target.value)} />}
          </Campo>
          <Campo rotulo="Stock mínimo *" erro={erros.minimo} ajuda="0 desliga o alerta de stock baixo.">
            {(p) => <input {...p} inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} />}
          </Campo>
          <Campo rotulo="Código de barras" erro={erros.codigoBarras} ajuda="Opcional; único na empresa.">
            {(p) => <input {...p} inputMode="numeric" value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value.trim())} />}
          </Campo>
          <label className="caixa-seleccao">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Produto activo (aparece no balcão)
          </label>
          {existente && (
            <Aviso tom="info">
              O stock não se edita aqui: muda só por movimentos (compras, vendas, ajustes, contagens). Stock actual:{' '}
              {existente.stock} {existente.unidade}.
            </Aviso>
          )}
          <div className="linha-accoes">
            <Botao variante="secundario" onClick={() => navegar('produtos')}>
              Cancelar
            </Botao>
            <Botao type="submit">Guardar</Botao>
          </div>
        </form>
      </Cartao>
    </>
  )
}
