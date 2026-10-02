export interface ItemMenu {
  rota: string
  rotulo: string
  /** Só proprietário e gestor (matriz de permissões B). */
  gestao?: boolean
}

export const MENU: ItemMenu[] = [
  { rota: 'painel', rotulo: 'Painel' },
  { rota: 'balcao', rotulo: 'Balcão' },
  { rota: 'vendas', rotulo: 'Vendas' },
  { rota: 'caixa', rotulo: 'Caixa' },
  { rota: 'produtos', rotulo: 'Produtos' },
  { rota: 'compras', rotulo: 'Compras', gestao: true },
  { rota: 'despesas', rotulo: 'Despesas', gestao: true },
  { rota: 'relatorios', rotulo: 'Relatórios', gestao: true },
  { rota: 'sincronizacao', rotulo: 'Sincronização' },
]
