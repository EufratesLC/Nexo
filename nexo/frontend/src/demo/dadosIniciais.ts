// Dados fictícios coerentes para o protótipo. Nomes de pessoas, empresa e
// fornecedores são inventados.

import { calcularVenda } from './regras'
import type {
  Categoria,
  Compra,
  Despesa,
  EstadoDemo,
  Fornecedor,
  MetodoPagamento,
  Operacao,
  Produto,
  SessaoCaixa,
  Utilizador,
  Venda,
} from './tipos'

export const VERSAO_DADOS = 3

const utilizadores: Utilizador[] = [
  { id: 'u-marta', nome: 'Marta Sitoe', papel: 'proprietario', pinDemo: '4321', limiteDesconto: null },
  { id: 'u-carlos', nome: 'Carlos Mabunda', papel: 'gestor', pinDemo: '1234', limiteDesconto: 20 },
  { id: 'u-ana', nome: 'Ana Chissano', papel: 'operador', pinDemo: '1111', limiteDesconto: 0 },
]

const categorias: Categoria[] = [
  { id: 'c-mercearia', nome: 'Mercearia' },
  { id: 'c-bebidas', nome: 'Bebidas' },
  { id: 'c-higiene', nome: 'Higiene e limpeza' },
  { id: 'c-frescos', nome: 'Frescos' },
  { id: 'c-diversos', nome: 'Diversos' },
]

type SementeProduto = [string, string, Produto['unidade'], number, number, number, number]

// [nome, categoria, unidade, preço MZN, custo MZN, stock, stock mínimo]
const sementes: SementeProduto[] = [
  ['Arroz 5 kg', 'c-mercearia', 'un', 450, 380, 24, 10],
  ['Óleo alimentar 1 L', 'c-mercearia', 'un', 180, 150, 30, 12],
  ['Açúcar castanho 1 kg', 'c-mercearia', 'un', 95, 78, 40, 15],
  ['Farinha de milho 5 kg', 'c-mercearia', 'un', 320, 265, 8, 10],
  ['Feijão manteiga 1 kg', 'c-mercearia', 'un', 150, 120, 18, 8],
  ['Massa esparguete 500 g', 'c-mercearia', 'un', 65, 50, 50, 20],
  ['Sal 1 kg', 'c-mercearia', 'un', 40, 28, 35, 10],
  ['Leite UHT 1 L', 'c-bebidas', 'un', 110, 90, 3, 12],
  ['Água mineral 1,5 L', 'c-bebidas', 'un', 45, 32, 60, 24],
  ['Refresco 2 L', 'c-bebidas', 'un', 120, 95, 22, 10],
  ['Sabão em barra', 'c-higiene', 'un', 60, 45, 40, 15],
  ['Detergente em pó 500 g', 'c-higiene', 'un', 140, 110, 12, 6],
  ['Tomate', 'c-frescos', 'kg', 90, 60, 14.5, 5],
  ['Cebola', 'c-frescos', 'kg', 80, 55, 9.25, 5],
  ['Pão', 'c-frescos', 'un', 10, 7, 40, 20],
  ['Vela', 'c-diversos', 'un', 15, 10, 100, 30],
  ['Fósforos (caixa)', 'c-diversos', 'un', 5, 3, 200, 50],
]

const produtos: Produto[] = sementes.map(([nome, categoriaId, unidade, preco, custo, stock, minimo], i) => ({
  id: `p-${String(i + 1).padStart(2, '0')}`,
  nome,
  categoriaId,
  unidade,
  codigo: `P${String(i + 1).padStart(3, '0')}`,
  codigoBarras: `600123400${String(i + 1).padStart(4, '0')}`,
  precoCentavos: preco * 100,
  custoCentavos: custo * 100,
  stock,
  stockMinimo: minimo,
  activo: true,
}))

const fornecedores: Fornecedor[] = [
  { id: 'f-1', nome: 'Distribuidora Central (fictícia)', nuit: '400000001', telefone: '+258 84 000 0001' },
  { id: 'f-2', nome: 'Grossista do Bairro (fictício)', nuit: '400000002', telefone: '+258 85 000 0002' },
  { id: 'f-3', nome: 'Hortícolas do Vale (fictício)', nuit: '', telefone: '+258 86 000 0003' },
]

// Gerador pseudo-aleatório determinístico, para que os dados sejam sempre iguais.
function gerador(semente: number) {
  let s = semente
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function diasAtras(dias: number, hora: number, minuto: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - dias)
  // Maputo = UTC+2
  d.setUTCHours(hora - 2, minuto, 0, 0)
  return d.toISOString()
}

export function criarEstadoInicial(): EstadoDemo {
  const aleatorio = gerador(20261001)
  const ano = new Date().getFullYear()
  const vendas: Venda[] = []
  const sessoes: SessaoCaixa[] = []
  const operacoes: Operacao[] = []
  let comprovativo = 1
  let sequencia = 1
  const metodos: MetodoPagamento[] = ['numerario', 'numerario', 'numerario', 'mpesa', 'mpesa', 'emola', 'cartao']

  for (let dia = 6; dia >= 1; dia--) {
    const sessaoId = `s-hist-${dia}`
    let numerarioDia = 0
    const nVendas = 6 + Math.floor(aleatorio() * 5)
    for (let v = 0; v < nVendas; v++) {
      const nLinhas = 1 + Math.floor(aleatorio() * 3)
      const carrinho = Array.from({ length: nLinhas }, () => {
        const produto = produtos[Math.floor(aleatorio() * produtos.length)]
        const quantidade = produto.unidade === 'kg' ? 1 : 1 + Math.floor(aleatorio() * 3)
        return { produto, quantidade }
      })
      const calculo = calcularVenda(carrinho, { tipo: 'percentagem', valor: 0 })
      const metodo = metodos[Math.floor(aleatorio() * metodos.length)]
      if (metodo === 'numerario') numerarioDia += calculo.totalCentavos
      const id = `v-hist-${dia}-${v}`
      vendas.push({
        id,
        numero: `F01-C01-${ano}-${String(comprovativo++).padStart(6, '0')}`,
        sessaoId,
        autorId: v % 3 === 0 ? 'u-carlos' : 'u-ana',
        dataHora: diasAtras(dia, 8 + Math.floor((v * 10) / nVendas), Math.floor(aleatorio() * 59)),
        linhas: calculo.linhas,
        subtotalCentavos: calculo.subtotalCentavos,
        descontoCentavos: 0,
        totalCentavos: calculo.totalCentavos,
        pagamentos: [{ metodo, valorCentavos: calculo.totalCentavos }],
        estado: 'concluida',
        vendidaForaDaSessao: false,
      })
      operacoes.push({
        id: `o-hist-${dia}-${v}`,
        sequencia: sequencia++,
        tipo: 'venda',
        referenciaId: id,
        descricao: `Venda ${vendas[vendas.length - 1].numero}`,
        valorCentavos: calculo.totalCentavos,
        autorId: vendas[vendas.length - 1].autorId,
        criadaEm: vendas[vendas.length - 1].dataHora,
        estado: 'confirmado',
      })
    }
    const fundo = 200000
    const esperado = fundo + numerarioDia
    const diferenca = dia === 3 ? -5000 : 0
    sessoes.push({
      id: sessaoId,
      responsavelId: 'u-ana',
      abertaEm: diasAtras(dia, 7, 45),
      fundoCentavos: fundo,
      estado: 'fechada',
      fechadaEm: diasAtras(dia, 18, 30),
      esperadoCentavos: esperado,
      contadoCentavos: esperado + diferenca,
      diferencaCentavos: diferenca,
      justificacao: diferenca !== 0 ? 'Troco dado a mais (fictício)' : undefined,
    })
  }

  const compras: Compra[] = [
    {
      id: 'cp-1',
      fornecedorId: 'f-1',
      data: diasAtras(5, 10, 0),
      documento: 'FT 2026/0412',
      linhas: [
        { produtoId: 'p-01', quantidade: 20, custoCentavos: 38000 },
        { produtoId: 'p-02', quantidade: 24, custoCentavos: 15000 },
      ],
      estado: 'recebida',
      recebidaEm: diasAtras(5, 11, 0),
      recebidaPor: 'u-carlos',
      pagamentos: [{ id: 'pg-1', data: diasAtras(5, 11, 30), valorCentavos: 400000, conta: 'Banco' }],
    },
    {
      id: 'cp-2',
      fornecedorId: 'f-2',
      data: diasAtras(1, 9, 0),
      documento: '',
      linhas: [
        { produtoId: 'p-04', quantidade: 15, custoCentavos: 26500 },
        { produtoId: 'p-08', quantidade: 24, custoCentavos: 9000 },
      ],
      estado: 'rascunho',
      pagamentos: [],
    },
  ]

  const despesas: Despesa[] = [
    { id: 'd-1', data: diasAtras(6, 9, 0), categoria: 'Renda', descricao: 'Renda do mês (fictícia)', valorCentavos: 800000, conta: 'banco', autorId: 'u-marta', estado: 'activa' },
    { id: 'd-2', data: diasAtras(4, 12, 0), categoria: 'Energia e água', descricao: 'Recarga de energia', valorCentavos: 120000, conta: 'mpesa', autorId: 'u-carlos', estado: 'activa' },
    { id: 'd-3', data: diasAtras(2, 15, 0), categoria: 'Transporte', descricao: 'Chapa para buscar mercadoria', valorCentavos: 30000, conta: 'caixa', sessaoId: 's-hist-2', autorId: 'u-ana', estado: 'activa' },
  ]

  return {
    versao: VERSAO_DADOS,
    empresa: {
      nome: 'Loja Esperança (dados fictícios)',
      filial: 'Filial principal',
      codigoFilial: 'F01',
      dispositivo: 'Balcão 1',
      codigoDispositivo: 'C01',
    },
    utilizadores,
    utilizadorActivoId: null,
    categorias,
    produtos,
    fornecedores,
    compras,
    vendas,
    sessoes,
    movimentos: [],
    despesas,
    operacoes,
    simulacao: { ligacao: 'online', pausaContagem: 'nenhuma', ultimoContacto: new Date().toISOString() },
    proximoComprovativo: comprovativo,
    proximaSequencia: sequencia,
  }
}
