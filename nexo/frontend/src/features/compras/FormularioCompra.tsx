import { useState } from 'react'
import { navegar } from '../../app/rotas'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao } from '../../components/ui'
import { guardarCompra } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { agoraIso } from '../../lib/datas'
import { formatarMzn, lerMzn, lerQuantidade } from '../../lib/dinheiro'
import { novoId } from '../../lib/ids'

interface LinhaTexto {
  chave: string
  produtoId: string
  quantidade: string
  custo: string
}

const linhaVazia = (): LinhaTexto => ({ chave: novoId(), produtoId: '', quantidade: '', custo: '' })

export function FormularioCompra() {
  const { estado, executar } = useDemo()
  const [fornecedorId, setFornecedorId] = useState('')
  const [documento, setDocumento] = useState('')
  const [linhas, setLinhas] = useState<LinhaTexto[]>([linhaVazia()])
  const [erros, setErros] = useState<string[]>([])

  const alterar = (chave: string, campo: keyof Omit<LinhaTexto, 'chave'>, valor: string) =>
    setLinhas((a) => a.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)))

  const guardar = () => {
    const problemas: string[] = []
    if (!fornecedorId) problemas.push('Escolha o fornecedor.')
    const convertidas = linhas.map((l, i) => {
      const produto = estado.produtos.find((p) => p.id === l.produtoId)
      const quantidade = produto ? lerQuantidade(l.quantidade, produto.unidade === 'kg' || produto.unidade === 'L') : null
      const custo = lerMzn(l.custo)
      if (!produto) problemas.push(`Linha ${i + 1}: escolha o produto.`)
      else if (quantidade === null || quantidade <= 0) problemas.push(`Linha ${i + 1}: quantidade inválida.`)
      if (custo === null || custo <= 0) problemas.push(`Linha ${i + 1}: custo unitário inválido.`)
      return { produtoId: l.produtoId, quantidade: quantidade ?? 0, custoCentavos: custo ?? 0 }
    })
    if (new Set(linhas.map((l) => l.produtoId)).size !== linhas.length) problemas.push('Há produtos repetidos: junte as quantidades.')
    setErros(problemas)
    if (problemas.length > 0) return
    const id = novoId()
    const falha = executar((e) =>
      guardarCompra(e, { id, fornecedorId, data: agoraIso(), documento: documento.trim(), linhas: convertidas, estado: 'rascunho', pagamentos: [] }),
    )
    if (falha) setErros([falha])
    else navegar(`compras/${id}`)
  }

  const total = linhas.reduce((s, l) => {
    const q = Number(l.quantidade.replace(',', '.'))
    const c = lerMzn(l.custo)
    return s + (Number.isFinite(q) && c ? Math.round(q * c) : 0)
  }, 0)

  return (
    <>
      <CabecalhoPagina titulo="Nova compra" descricao="Fica em rascunho. O stock só aumenta ao confirmar a recepção." />
      <Cartao>
        <form
          className="formulario"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
        >
          <div className="grelha-formulario">
            <Campo rotulo="Fornecedor *">
              {(p) => (
                <select {...p} value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                  <option value="">Escolher…</option>
                  {estado.fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo rotulo="N.º do documento do fornecedor" ajuda="Opcional.">
              {(p) => <input {...p} value={documento} onChange={(e) => setDocumento(e.target.value)} />}
            </Campo>
          </div>
          <fieldset className="linhas-compra">
            <legend>Linhas</legend>
            {linhas.map((l, i) => (
              <div key={l.chave} className="linha-compra">
                <Campo rotulo={`Produto ${i + 1}`}>
                  {(p) => (
                    <select {...p} value={l.produtoId} onChange={(e) => alterar(l.chave, 'produtoId', e.target.value)}>
                      <option value="">Escolher…</option>
                      {estado.produtos.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.nome}
                        </option>
                      ))}
                    </select>
                  )}
                </Campo>
                <Campo rotulo="Quantidade">
                  {(p) => <input {...p} inputMode="decimal" value={l.quantidade} onChange={(e) => alterar(l.chave, 'quantidade', e.target.value)} />}
                </Campo>
                <Campo rotulo="Custo unitário (MZN)">
                  {(p) => <input {...p} inputMode="decimal" value={l.custo} onChange={(e) => alterar(l.chave, 'custo', e.target.value)} />}
                </Campo>
                <Botao
                  variante="discreto"
                  aria-label={`Remover linha ${i + 1}`}
                  disabled={linhas.length === 1}
                  onClick={() => setLinhas((a) => a.filter((x) => x.chave !== l.chave))}
                >
                  Remover
                </Botao>
              </div>
            ))}
            <Botao variante="secundario" onClick={() => setLinhas((a) => [...a, linhaVazia()])}>
              Adicionar linha
            </Botao>
          </fieldset>
          <p>
            Total estimado: <strong>{formatarMzn(total)}</strong>
          </p>
          {erros.length > 0 && (
            <Aviso tom="perigo" titulo="Corrija antes de guardar">
              <ul>
                {erros.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Aviso>
          )}
          <div className="linha-accoes">
            <Botao variante="secundario" onClick={() => navegar('compras')}>
              Cancelar
            </Botao>
            <Botao type="submit">Guardar rascunho</Botao>
          </div>
        </form>
      </Cartao>
    </>
  )
}
