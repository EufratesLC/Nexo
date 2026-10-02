// Transições do estado de demonstração. Funções puras: recebem o estado e
// devolvem um novo estado, ou lançam ErroDemo com uma mensagem para o ecrã.
// Tudo acontece no navegador; nada é enviado a um servidor.

import { agoraIso } from '../lib/datas'
import { novoId } from '../lib/ids'
import { calcularVenda, esperadoCaixa, sessaoAberta, type Desconto, type ItemCarrinho } from './regras'
import type {
  Compra,
  Despesa,
  EstadoDemo,
  Fornecedor,
  Operacao,
  Pagamento,
  Produto,
  TipoMovimentoCaixa,
  TipoOperacao,
} from './tipos'

export class ErroDemo extends Error {}

function exigirUtilizador(estado: EstadoDemo) {
  const u = estado.utilizadores.find((x) => x.id === estado.utilizadorActivoId)
  if (!u) throw new ErroDemo('Entre com um perfil de demonstração.')
  return u
}

function registarOperacao(
  estado: EstadoDemo,
  tipo: TipoOperacao,
  referenciaId: string,
  descricao: string,
  valorCentavos?: number,
): EstadoDemo {
  const operacao: Operacao = {
    id: novoId(),
    sequencia: estado.proximaSequencia,
    tipo,
    referenciaId,
    descricao,
    valorCentavos,
    autorId: estado.utilizadorActivoId ?? '',
    criadaEm: agoraIso(),
    estado: 'pendente',
  }
  return { ...estado, operacoes: [...estado.operacoes, operacao], proximaSequencia: estado.proximaSequencia + 1 }
}

function exigirSemPausa(estado: EstadoDemo) {
  if (estado.simulacao.pausaContagem === 'em_pausa') {
    throw new ErroDemo('Vendas em pausa: contagem física em curso. A retoma chega do servidor.')
  }
}

export function entrar(estado: EstadoDemo, utilizadorId: string): EstadoDemo {
  return { ...estado, utilizadorActivoId: utilizadorId }
}

export function sair(estado: EstadoDemo): EstadoDemo {
  // As operações pendentes nunca são apagadas ao terminar sessão (D.11.4).
  return { ...estado, utilizadorActivoId: null }
}

export function abrirCaixa(estado: EstadoDemo, fundoCentavos: number): EstadoDemo {
  const u = exigirUtilizador(estado)
  if (sessaoAberta(estado)) throw new ErroDemo('Já existe uma sessão de caixa aberta neste dispositivo.')
  if (fundoCentavos < 0) throw new ErroDemo('O fundo de abertura não pode ser negativo.')
  const id = novoId()
  const novo: EstadoDemo = {
    ...estado,
    sessoes: [
      ...estado.sessoes,
      { id, responsavelId: u.id, abertaEm: agoraIso(), fundoCentavos, estado: 'aberta' },
    ],
  }
  return registarOperacao(novo, 'abertura_caixa', id, 'Abertura de caixa', fundoCentavos)
}

export function registarMovimentoCaixa(
  estado: EstadoDemo,
  tipo: TipoMovimentoCaixa,
  valorCentavos: number,
  descricao: string,
  autorizadorId?: string,
  categoriaDespesa?: string,
): EstadoDemo {
  const u = exigirUtilizador(estado)
  const sessao = sessaoAberta(estado)
  if (!sessao) throw new ErroDemo('Abra a caixa primeiro.')
  if (valorCentavos <= 0) throw new ErroDemo('O valor tem de ser maior do que zero.')
  if (descricao.trim() === '') throw new ErroDemo('Indique o motivo ou destino.')
  if (tipo !== 'reforco' && valorCentavos > esperadoCaixa(estado, sessao.id)) {
    // A mensagem do operador não revela o esperado (contagem cega, proposta H-15).
    throw new ErroDemo(
      u.papel === 'operador'
        ? 'Valor não aceite para esta sessão. Peça ao gestor para verificar.'
        : 'O valor é superior ao numerário esperado na gaveta.',
    )
  }
  const id = novoId()
  let novo: EstadoDemo = {
    ...estado,
    movimentos: [
      ...estado.movimentos,
      { id, sessaoId: sessao.id, tipo, valorCentavos, descricao, autorId: u.id, autorizadorId, dataHora: agoraIso() },
    ],
  }
  if (tipo === 'despesa') {
    const despesa: Despesa = {
      id: novoId(),
      data: agoraIso(),
      categoria: categoriaDespesa ?? 'Outros',
      descricao,
      valorCentavos,
      conta: 'caixa',
      sessaoId: sessao.id,
      autorId: u.id,
      estado: 'activa',
    }
    novo = { ...novo, despesas: [...novo.despesas, despesa] }
  }
  const nomes = { reforco: 'Reforço de caixa', retirada: 'Retirada de caixa', despesa: 'Despesa pelo caixa' }
  return registarOperacao(novo, 'movimento_caixa', id, nomes[tipo], valorCentavos)
}

/**
 * Regista o numerário contado no fecho, antes de o esperado ser mostrado (contagem cega, proposta H-15).
 * Cada contagem fica guardada; uma recontagem não apaga a anterior.
 */
export function registarContagemFecho(estado: EstadoDemo, contadoCentavos: number): EstadoDemo {
  const u = exigirUtilizador(estado)
  const sessao = sessaoAberta(estado)
  if (!sessao) throw new ErroDemo('Não há sessão de caixa aberta.')
  if (!Number.isInteger(contadoCentavos) || contadoCentavos < 0) throw new ErroDemo('Indique o numerário contado.')
  const contagem = { contadoCentavos, autorId: u.id, em: agoraIso() }
  return {
    ...estado,
    sessoes: estado.sessoes.map((s) => (s.id === sessao.id ? { ...s, contagens: [...(s.contagens ?? []), contagem] } : s)),
  }
}

/** Fecha a sessão com a última contagem registada. */
export function fecharCaixa(estado: EstadoDemo, justificacao: string): EstadoDemo {
  exigirUtilizador(estado)
  const sessao = sessaoAberta(estado)
  if (!sessao) throw new ErroDemo('Não há sessão de caixa aberta.')
  const ultima = sessao.contagens?.at(-1)
  if (!ultima) throw new ErroDemo('Conte o numerário antes de fechar.')
  const contadoCentavos = ultima.contadoCentavos
  const esperado = esperadoCaixa(estado, sessao.id)
  const diferenca = contadoCentavos - esperado
  if (diferenca !== 0 && justificacao.trim() === '') {
    throw new ErroDemo('Há diferença entre o contado e o esperado: a justificação é obrigatória.')
  }
  const novo: EstadoDemo = {
    ...estado,
    sessoes: estado.sessoes.map((s) =>
      s.id === sessao.id
        ? {
            ...s,
            estado: 'fechada',
            fechadaEm: agoraIso(),
            esperadoCentavos: esperado,
            contadoCentavos,
            diferencaCentavos: diferenca,
            justificacao: justificacao.trim() || undefined,
          }
        : s,
    ),
  }
  return registarOperacao(novo, 'fecho_caixa', sessao.id, 'Fecho de caixa', contadoCentavos)
}

export interface PedidoVenda {
  id: string
  carrinho: ItemCarrinho[]
  desconto: Desconto
  pagamentos: Pagamento[]
  autorizadorId?: string
  motivoAutorizacao?: string
}

export function concluirVenda(estado: EstadoDemo, pedido: PedidoVenda): EstadoDemo {
  const u = exigirUtilizador(estado)
  exigirSemPausa(estado)
  const sessao = sessaoAberta(estado)
  if (!sessao) throw new ErroDemo('Abra a caixa antes de vender.')
  if (pedido.carrinho.length === 0) throw new ErroDemo('O carrinho está vazio.')
  const calculo = calcularVenda(pedido.carrinho, pedido.desconto)
  const pago = pedido.pagamentos.reduce((soma, p) => soma + p.valorCentavos, 0)
  if (pago !== calculo.totalCentavos) throw new ErroDemo('A soma dos pagamentos tem de ser igual ao total.')

  const ano = new Date().getFullYear()
  const numero = `${estado.empresa.codigoFilial}-${estado.empresa.codigoDispositivo}-${ano}-${String(estado.proximoComprovativo).padStart(6, '0')}`
  const quantidades = new Map<string, number>()
  for (const item of pedido.carrinho) {
    quantidades.set(item.produto.id, (quantidades.get(item.produto.id) ?? 0) + item.quantidade)
  }
  const novo: EstadoDemo = {
    ...estado,
    produtos: estado.produtos.map((p) =>
      quantidades.has(p.id) ? { ...p, stock: Math.round((p.stock - (quantidades.get(p.id) ?? 0)) * 1000) / 1000 } : p,
    ),
    vendas: [
      ...estado.vendas,
      {
        id: pedido.id,
        numero,
        sessaoId: sessao.id,
        autorId: u.id,
        autorizadorId: pedido.autorizadorId,
        motivoAutorizacao: pedido.motivoAutorizacao,
        dataHora: agoraIso(),
        linhas: calculo.linhas,
        subtotalCentavos: calculo.subtotalCentavos,
        descontoCentavos: calculo.descontoCentavos,
        totalCentavos: calculo.totalCentavos,
        pagamentos: pedido.pagamentos,
        estado: 'concluida',
        vendidaForaDaSessao: sessao.responsavelId !== u.id,
      },
    ],
    proximoComprovativo: estado.proximoComprovativo + 1,
  }
  return registarOperacao(novo, 'venda', pedido.id, `Venda ${numero}`, calculo.totalCentavos)
}

export function cancelarVenda(estado: EstadoDemo, vendaId: string, motivo: string, autorizadorId?: string): EstadoDemo {
  const u = exigirUtilizador(estado)
  exigirSemPausa(estado)
  const venda = estado.vendas.find((v) => v.id === vendaId)
  if (!venda) throw new ErroDemo('Venda não encontrada.')
  if (venda.estado === 'cancelada') throw new ErroDemo('Esta venda já foi cancelada.')
  const sessao = sessaoAberta(estado)
  if (!sessao || sessao.id !== venda.sessaoId) {
    throw new ErroDemo('Só se cancela na sessão de caixa aberta em que a venda foi feita (D.6.1.2).')
  }
  if (motivo.trim() === '') throw new ErroDemo('O motivo é obrigatório.')
  const repor = new Map<string, number>()
  for (const l of venda.linhas) repor.set(l.produtoId, (repor.get(l.produtoId) ?? 0) + l.quantidade)
  const novo: EstadoDemo = {
    ...estado,
    produtos: estado.produtos.map((p) =>
      repor.has(p.id) ? { ...p, stock: Math.round((p.stock + (repor.get(p.id) ?? 0)) * 1000) / 1000 } : p,
    ),
    vendas: estado.vendas.map((v) =>
      v.id === vendaId
        ? { ...v, estado: 'cancelada', cancelamento: { motivo, autorId: u.id, autorizadorId, dataHora: agoraIso() } }
        : v,
    ),
  }
  return registarOperacao(novo, 'cancelamento', vendaId, `Cancelamento da venda ${venda.numero}`, venda.totalCentavos)
}

export function guardarProduto(estado: EstadoDemo, produto: Produto): EstadoDemo {
  exigirUtilizador(estado)
  const duplicado = estado.produtos.find(
    (p) => p.id !== produto.id && produto.codigoBarras !== '' && p.codigoBarras === produto.codigoBarras,
  )
  if (duplicado) throw new ErroDemo(`O código de barras já pertence a "${duplicado.nome}".`)
  const existe = estado.produtos.some((p) => p.id === produto.id)
  return {
    ...estado,
    produtos: existe ? estado.produtos.map((p) => (p.id === produto.id ? produto : p)) : [...estado.produtos, produto],
  }
}

export function guardarFornecedor(estado: EstadoDemo, fornecedor: Fornecedor): EstadoDemo {
  exigirUtilizador(estado)
  const existe = estado.fornecedores.some((f) => f.id === fornecedor.id)
  return {
    ...estado,
    fornecedores: existe
      ? estado.fornecedores.map((f) => (f.id === fornecedor.id ? fornecedor : f))
      : [...estado.fornecedores, fornecedor],
  }
}

export function guardarCompra(estado: EstadoDemo, compra: Compra): EstadoDemo {
  exigirUtilizador(estado)
  const actual = estado.compras.find((c) => c.id === compra.id)
  if (actual && actual.estado !== 'rascunho') throw new ErroDemo('Só se edita uma compra em rascunho.')
  return {
    ...estado,
    compras: actual ? estado.compras.map((c) => (c.id === compra.id ? compra : c)) : [...estado.compras, compra],
  }
}

/** A recepção confirmada aumenta o stock uma única vez (D.5.4): uma segunda chamada não faz nada. */
export function receberCompra(estado: EstadoDemo, compraId: string): EstadoDemo {
  const u = exigirUtilizador(estado)
  exigirSemPausa(estado)
  const compra = estado.compras.find((c) => c.id === compraId)
  if (!compra) throw new ErroDemo('Compra não encontrada.')
  if (compra.estado === 'recebida') return estado
  if (compra.estado === 'cancelada') throw new ErroDemo('A compra está cancelada.')
  const entradas = new Map(compra.linhas.map((l) => [l.produtoId, l]))
  return {
    ...estado,
    produtos: estado.produtos.map((p) => {
      const linha = entradas.get(p.id)
      if (!linha) return p
      const stockNovo = p.stock + linha.quantidade
      const custo =
        p.stock > 0
          ? Math.round((p.stock * p.custoCentavos + linha.quantidade * linha.custoCentavos) / stockNovo)
          : linha.custoCentavos
      return { ...p, stock: stockNovo, custoCentavos: custo }
    }),
    compras: estado.compras.map((c) =>
      c.id === compraId ? { ...c, estado: 'recebida', recebidaEm: agoraIso(), recebidaPor: u.id } : c,
    ),
  }
}

export function cancelarCompra(estado: EstadoDemo, compraId: string): EstadoDemo {
  const compra = estado.compras.find((c) => c.id === compraId)
  if (!compra || compra.estado !== 'rascunho') throw new ErroDemo('Só se cancela uma compra sem recepção confirmada.')
  return { ...estado, compras: estado.compras.map((c) => (c.id === compraId ? { ...c, estado: 'cancelada' } : c)) }
}

export function registarPagamentoCompra(estado: EstadoDemo, compraId: string, valorCentavos: number, conta: string): EstadoDemo {
  exigirUtilizador(estado)
  const compra = estado.compras.find((c) => c.id === compraId)
  if (!compra) throw new ErroDemo('Compra não encontrada.')
  const total = compra.linhas.reduce((s, l) => s + Math.round(l.quantidade * l.custoCentavos), 0)
  const pago = compra.pagamentos.reduce((s, p) => s + p.valorCentavos, 0)
  if (valorCentavos <= 0) throw new ErroDemo('O valor tem de ser maior do que zero.')
  if (valorCentavos > total - pago) throw new ErroDemo('O valor é superior ao que falta pagar.')
  return {
    ...estado,
    compras: estado.compras.map((c) =>
      c.id === compraId
        ? { ...c, pagamentos: [...c.pagamentos, { id: novoId(), data: agoraIso(), valorCentavos, conta }] }
        : c,
    ),
  }
}

export function registarDespesa(estado: EstadoDemo, despesa: Omit<Despesa, 'id' | 'autorId' | 'estado'>): EstadoDemo {
  const u = exigirUtilizador(estado)
  if (despesa.conta === 'caixa') throw new ErroDemo('Despesas pagas pelo caixa registam-se no ecrã Caixa.')
  return { ...estado, despesas: [...estado.despesas, { ...despesa, id: novoId(), autorId: u.id, estado: 'activa' }] }
}

export function anularDespesa(estado: EstadoDemo, despesaId: string, motivo: string): EstadoDemo {
  exigirUtilizador(estado)
  if (motivo.trim() === '') throw new ErroDemo('O motivo da anulação é obrigatório.')
  return {
    ...estado,
    despesas: estado.despesas.map((d) =>
      d.id === despesaId ? { ...d, estado: 'anulada', motivoAnulacao: motivo.trim() } : d,
    ),
  }
}

// --- Simulação de sincronização (não há servidor nesta demonstração) ---

export function definirLigacao(estado: EstadoDemo, ligacao: 'online' | 'offline'): EstadoDemo {
  return {
    ...estado,
    simulacao: {
      ...estado.simulacao,
      ligacao,
      ultimoContacto: ligacao === 'online' ? agoraIso() : estado.simulacao.ultimoContacto,
    },
  }
}

export function simularEnvio(estado: EstadoDemo): EstadoDemo {
  if (estado.simulacao.ligacao === 'offline') throw new ErroDemo('Sem ligação simulada: as operações ficam pendentes.')
  return {
    ...estado,
    operacoes: estado.operacoes.map((o) => (o.estado === 'pendente' ? { ...o, estado: 'confirmado' } : o)),
    simulacao: { ...estado.simulacao, ultimoContacto: agoraIso() },
  }
}

export function simularConflito(estado: EstadoDemo, operacaoId: string, motivo: string): EstadoDemo {
  return {
    ...estado,
    operacoes: estado.operacoes.map((o) =>
      o.id === operacaoId && o.estado === 'pendente' ? { ...o, estado: 'conflito', motivoConflito: motivo } : o,
    ),
  }
}

export function resolverConflito(estado: EstadoDemo, operacaoId: string, decisao: 'aceitar' | 'anular', nota: string): EstadoDemo {
  const u = exigirUtilizador(estado)
  if (u.papel === 'operador') throw new ErroDemo('Só gestor ou proprietário resolve conflitos.')
  if (nota.trim() === '') throw new ErroDemo('Escreva uma nota para a auditoria.')
  return {
    ...estado,
    operacoes: estado.operacoes.map((o) =>
      o.id === operacaoId && o.estado === 'conflito'
        ? { ...o, estado: decisao === 'aceitar' ? 'confirmado' : 'anulada', resolucao: `${decisao === 'aceitar' ? 'Aceite' : 'Anulada'} por ${u.nome}: ${nota.trim()}` }
        : o,
    ),
  }
}

// Pausa de contagem (D.7). No MVP a retoma depende sempre do servidor: não há retoma local por PIN.
// A confirmação da pausa e a confirmação da retoma são operações do dispositivo, para que o servidor
// saiba entre que sequências o dispositivo esteve em pausa (D.7.5).

export function simularPausa(estado: EstadoDemo): EstadoDemo {
  if (estado.simulacao.ligacao === 'offline') throw new ErroDemo('O aviso de pausa só chega com ligação.')
  if (estado.simulacao.pausaContagem === 'em_pausa') throw new ErroDemo('O dispositivo já está em pausa.')
  if (estado.operacoes.some((o) => o.estado === 'pendente')) {
    throw new ErroDemo('O dispositivo tem de enviar as operações pendentes antes de confirmar a pausa (D.7.2).')
  }
  const novo: EstadoDemo = { ...estado, simulacao: { ...estado.simulacao, pausaContagem: 'em_pausa' } }
  return registarOperacao(novo, 'confirmacao_pausa', 'pausa-demo', 'Confirmação de pausa (contagem)')
}

export function simularRetoma(estado: EstadoDemo): EstadoDemo {
  if (estado.simulacao.pausaContagem !== 'em_pausa') throw new ErroDemo('O dispositivo não está em pausa.')
  if (estado.simulacao.ligacao === 'offline') {
    throw new ErroDemo('Sem ligação o dispositivo continua em pausa até receber a retoma do servidor.')
  }
  const novo: EstadoDemo = { ...estado, simulacao: { ...estado.simulacao, pausaContagem: 'nenhuma' } }
  return registarOperacao(novo, 'confirmacao_retoma', 'pausa-demo', 'Confirmação de retoma recebida do servidor')
}
