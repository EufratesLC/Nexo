export interface ItemMenu {
  rota: string
  rotulo: string
  /** Só proprietário e gestor (matriz de permissões B). */
  gestao?: boolean
  /** "demonstracao": ecrã do protótipo com dados fictícios; "sistema": infraestrutura real (só leitura). */
  area: 'demonstracao' | 'sistema'
}

export const MENU: ItemMenu[] = [
  { rota: 'painel', rotulo: 'Painel', area: 'demonstracao' },
  { rota: 'balcao', rotulo: 'Balcão', area: 'demonstracao' },
  { rota: 'vendas', rotulo: 'Vendas', area: 'demonstracao' },
  { rota: 'caixa', rotulo: 'Caixa', area: 'demonstracao' },
  { rota: 'produtos', rotulo: 'Produtos', area: 'demonstracao' },
  { rota: 'compras', rotulo: 'Compras', gestao: true, area: 'demonstracao' },
  { rota: 'despesas', rotulo: 'Despesas', gestao: true, area: 'demonstracao' },
  { rota: 'relatorios', rotulo: 'Relatórios', gestao: true, area: 'demonstracao' },
  { rota: 'sincronizacao', rotulo: 'Sincronização', area: 'demonstracao' },
  { rota: 'sistema', rotulo: 'Estado do sistema', area: 'sistema' },
]
