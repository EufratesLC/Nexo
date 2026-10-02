import { useMemo, useState } from 'react'
import { navegar } from '../../app/rotas'
import { AutorizacaoModal } from '../../components/AutorizacaoModal'
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, EstadoVazio, Etiqueta } from '../../components/ui'
import { concluirVenda } from '../../demo/accoes'
import { useDemo } from '../../demo/contexto'
import { calcularVenda, limitePermite, podeGerir, sessaoAberta, type Desconto, type ItemCarrinho } from '../../demo/regras'
import type { Pagamento, Produto, Utilizador } from '../../demo/tipos'
import { formatarMzn, formatarQuantidade, lerMzn, lerQuantidade } from '../../lib/dinheiro'
import { novoId } from '../../lib/ids'
import { Pagamentos } from './Pagamentos'

interface Linha {
  produtoId: string
  quantidadeTexto: string
}

export function Balcao() {
  const { estado, utilizador, executar } = useDemo()
  const [pesquisa, setPesquisa] = useState('')
  const [categoria, setCategoria] = useState('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [tipoDesconto, setTipoDesconto] = useState<Desconto['tipo']>('percentagem')
  const [descontoTexto, setDescontoTexto] = useState('')
  const [aPagar, setAPagar] = useState(false)
  const [pagamentosProntos, setPagamentosProntos] = useState<Pagamento[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const sessao = sessaoAberta(estado)
  const produtosActivos = estado.produtos.filter((p) => p.activo)
  const termo = pesquisa.trim().toLowerCase()
  const resultados = produtosActivos.filter(
    (p) =>
      (categoria === '' || p.categoriaId === categoria) &&
      (termo === '' || p.nome.toLowerCase().includes(termo) || p.codigo.toLowerCase() === termo || p.codigoBarras === termo),
  )

  const carrinho: ItemCarrinho[] = useMemo(
    () =>
      linhas.flatMap((l) => {
        const produto = estado.produtos.find((p) => p.id === l.produtoId)
        const quantidade = produto ? lerQuantidade(l.quantidadeTexto, produto.unidade === 'kg' || produto.unidade === 'L') : null
        return produto && quantidade && quantidade > 0 ? [{ produto, quantidade }] : []
      }),
    [linhas, estado.produtos],
  )
  const quantidadesInvalidas = linhas.length !== carrinho.length

  const descontoValor = descontoTexto.trim() === '' ? 0 : tipoDesconto === 'percentagem' ? Number(descontoTexto.replace(',', '.')) : lerMzn(descontoTexto)
  const descontoInvalido =
    descontoValor === null || Number.isNaN(descontoValor) || descontoValor < 0 || (tipoDesconto === 'percentagem' && descontoValor > 100)
  const desconto: Desconto = { tipo: tipoDesconto, valor: descontoInvalido ? 0 : (descontoValor ?? 0) }
  const calculo = calcularVenda(carrinho, desconto)
  const precisaAutorizacaoDesconto = utilizador ? !limitePermite(utilizador, calculo.percentagemDesconto) : false
  const semStock = carrinho.filter((i) => i.quantidade > i.produto.stock)
  const precisaAutorizacaoStock = utilizador?.papel === 'operador' && semStock.length > 0

  if (estado.simulacao.pausaContagem === 'em_pausa') {
    return (
      <EstadoVazio titulo="Vendas em pausa" accao={<a href="#/sincronizacao">Ver estado</a>}>
        Contagem física em curso (simulada). Este dispositivo só volta a vender quando receber a retoma do servidor.
      </EstadoVazio>
    )
  }
  if (!sessao) {
    return (
      <EstadoVazio titulo="A caixa está fechada" accao={<Botao onClick={() => navegar('caixa')}>Abrir caixa</Botao>}>
        Não há vendas sem sessão de caixa aberta neste dispositivo (D.8.5.1).
      </EstadoVazio>
    )
  }
  if (utilizador?.papel === 'operador' && sessao.responsavelId !== utilizador.id) {
    const responsavel = estado.utilizadores.find((u) => u.id === sessao.responsavelId)
    return (
      <EstadoVazio titulo="Sessão de outro responsável">
        A caixa foi aberta por {responsavel?.nome}. No modo "caixa pessoal" (proposta H-13) outro operador tem de fazer
        passagem de turno. A passagem de turno não está incluída no protótipo.
      </EstadoVazio>
    )
  }

  const adicionar = (produto: Produto) => {
    setErro(null)
    setLinhas((actuais) => {
      const existente = actuais.find((l) => l.produtoId === produto.id)
      if (existente && produto.unidade !== 'kg' && produto.unidade !== 'L') {
        const somar = (texto: string) => {
          const n = Number(texto)
          return String(Number.isInteger(n) && n > 0 ? n + 1 : 1)
        }
        return actuais.map((l) => (l.produtoId === produto.id ? { ...l, quantidadeTexto: somar(l.quantidadeTexto) } : l))
      }
      if (existente) return actuais
      return [...actuais, { produtoId: produto.id, quantidadeTexto: '1' }]
    })
  }

  const finalizar = (pagamentos: Pagamento[], autorizador?: Utilizador, motivo?: string) => {
    const id = novoId()
    const falha = executar((e) =>
      concluirVenda(e, { id, carrinho, desconto, pagamentos, autorizadorId: autorizador?.id, motivoAutorizacao: motivo }),
    )
    if (falha) {
      setErro(falha)
      setPagamentosProntos(null)
      return
    }
    navegar(`vendas/${id}`)
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Balcão"
        descricao={`Sessão de caixa aberta · ${estado.simulacao.ligacao === 'online' ? 'online (simulado)' : 'offline (simulado): a venda fica pendente'}`}
      />
      {erro && <Aviso tom="perigo">{erro}</Aviso>}
      <div className="balcao">
        <section className="balcao-catalogo" aria-label="Catálogo">
          <div className="filtros">
            <Campo rotulo="Pesquisar ou ler código de barras">
              {(p) => (
                <input
                  {...p}
                  type="search"
                  autoFocus
                  placeholder="Ex.: arroz, P002, 6001234000011"
                  value={pesquisa}
                  onChange={(e) => setPesquisa(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && resultados.length === 1) {
                      adicionar(resultados[0])
                      setPesquisa('')
                    }
                  }}
                />
              )}
            </Campo>
          </div>
          <div className="chips" role="group" aria-label="Categorias">
            <button type="button" className={categoria === '' ? 'chip activo' : 'chip'} onClick={() => setCategoria('')}>
              Todas
            </button>
            {estado.categorias.map((c) => (
              <button key={c.id} type="button" className={categoria === c.id ? 'chip activo' : 'chip'} onClick={() => setCategoria(c.id)}>
                {c.nome}
              </button>
            ))}
          </div>
          {resultados.length === 0 ? (
            <EstadoVazio titulo="Nenhum produto encontrado" />
          ) : (
            <ul className="grelha-produtos">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button type="button" className="produto-botao" onClick={() => adicionar(p)}>
                    <span className="produto-nome">{p.nome}</span>
                    <strong>{formatarMzn(p.precoCentavos)}</strong>
                    <span className={p.stock <= 0 ? 'texto-perigo' : 'texto-secundario'}>
                      Stock local {formatarQuantidade(p.stock, p.unidade)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Cartao titulo="Carrinho" className="balcao-carrinho">
          {linhas.length === 0 ? (
            <EstadoVazio titulo="Carrinho vazio">Toque num produto ou leia um código de barras.</EstadoVazio>
          ) : (
            <ul className="carrinho">
              {linhas.map((l) => {
                const produto = estado.produtos.find((p) => p.id === l.produtoId)
                if (!produto) return null
                const fraccionavel = produto.unidade === 'kg' || produto.unidade === 'L'
                const quantidade = lerQuantidade(l.quantidadeTexto, fraccionavel)
                const invalida = quantidade === null || quantidade <= 0
                return (
                  <li key={l.produtoId} className="carrinho-linha">
                    <div>
                      <strong>{produto.nome}</strong>
                      <div className="texto-secundario">
                        {formatarMzn(produto.precoCentavos)} / {produto.unidade}
                      </div>
                      {!invalida && quantidade > produto.stock && (
                        <Etiqueta tom="aviso">Acima do stock local ({formatarQuantidade(produto.stock, produto.unidade)})</Etiqueta>
                      )}
                    </div>
                    <label className="carrinho-quantidade">
                      <span className="so-leitor">Quantidade de {produto.nome}</span>
                      <input
                        inputMode={fraccionavel ? 'decimal' : 'numeric'}
                        aria-invalid={invalida}
                        value={l.quantidadeTexto}
                        onChange={(e) =>
                          setLinhas((a) => a.map((x) => (x.produtoId === l.produtoId ? { ...x, quantidadeTexto: e.target.value } : x)))
                        }
                      />
                      <span>{produto.unidade}</span>
                    </label>
                    <span className="num">{invalida ? '—' : formatarMzn(Math.round(produto.precoCentavos * quantidade))}</span>
                    <button
                      type="button"
                      className="botao-icone"
                      aria-label={`Remover ${produto.nome}`}
                      onClick={() => setLinhas((a) => a.filter((x) => x.produtoId !== l.produtoId))}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {quantidadesInvalidas && <p className="campo-mensagem">Corrija as quantidades inválidas (kg aceita até 3 casas decimais).</p>}

          <div className="desconto">
            <Campo
              rotulo={`Desconto sobre o total (${tipoDesconto === 'percentagem' ? '%' : 'MZN'})`}
              erro={descontoInvalido ? 'Valor de desconto inválido.' : undefined}
              ajuda={`O seu limite: ${utilizador?.limiteDesconto === null ? 'sem limite' : `${utilizador?.limiteDesconto ?? 0}%`}.`}
            >
              {(p) => (
                <div className="grupo-entrada">
                  <input {...p} inputMode="decimal" placeholder="0" value={descontoTexto} onChange={(e) => setDescontoTexto(e.target.value)} />
                  <select
                    aria-label="Tipo de desconto"
                    value={tipoDesconto}
                    onChange={(e) => setTipoDesconto(e.target.value as Desconto['tipo'])}
                  >
                    <option value="percentagem">%</option>
                    <option value="valor">MZN</option>
                  </select>
                </div>
              )}
            </Campo>
            {precisaAutorizacaoDesconto && <Etiqueta tom="aviso">Acima do seu limite: vai pedir autorização</Etiqueta>}
          </div>

          <dl className="totais">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatarMzn(calculo.subtotalCentavos)}</dd>
            </div>
            <div>
              <dt>Desconto</dt>
              <dd>−{formatarMzn(calculo.descontoCentavos)}</dd>
            </div>
            <div className="totais-total">
              <dt>Total</dt>
              <dd>{formatarMzn(calculo.totalCentavos)}</dd>
            </div>
          </dl>
          {precisaAutorizacaoStock && (
            <Aviso tom="aviso">Há produtos acima do stock local. A política proposta (H-06) pede autorização do gestor.</Aviso>
          )}
          <Botao
            className="botao-largo"
            disabled={carrinho.length === 0 || quantidadesInvalidas || descontoInvalido || calculo.totalCentavos <= 0}
            onClick={() => setAPagar(true)}
          >
            Pagamento
          </Botao>
          {linhas.length > 0 && (
            <Botao variante="discreto" className="botao-largo" onClick={() => setLinhas([])}>
              Esvaziar carrinho
            </Botao>
          )}
        </Cartao>
      </div>

      {aPagar && (
        <Pagamentos
          totalCentavos={calculo.totalCentavos}
          aoFechar={() => setAPagar(false)}
          aoConfirmar={(pagamentos) => {
            setAPagar(false)
            if (precisaAutorizacaoDesconto || precisaAutorizacaoStock) setPagamentosProntos(pagamentos)
            else finalizar(pagamentos)
          }}
        />
      )}
      {pagamentosProntos && (
        <AutorizacaoModal
          titulo="Autorização necessária"
          explicacao={[
            precisaAutorizacaoDesconto && `Desconto de ${calculo.percentagemDesconto.toFixed(1).replace('.', ',')}% acima do seu limite.`,
            precisaAutorizacaoStock && `Venda acima do stock local: ${semStock.map((i) => i.produto.nome).join(', ')}.`,
          ]
            .filter(Boolean)
            .join(' ')}
          podeAutorizar={(u) => podeGerir(u) && limitePermite(u, calculo.percentagemDesconto)}
          aoFechar={() => setPagamentosProntos(null)}
          aoAutorizar={(autorizador, motivo) => finalizar(pagamentosProntos, autorizador, motivo)}
        />
      )}
    </>
  )
}
