// Esquema da base local (IndexedDB), versão 1 — PREPARAÇÃO da Etapa 2.
//
// Segue a arquitectura (secção 5). Nesta etapa a aplicação NÃO abre esta base: as lojas são só
// definidas e testadas. O uso (referência, fila de operações, credenciais) é da Etapa 7.
//
// Fica de fora, de propósito:
// - a loja "autorias": o seu conteúdo depende da decisão H-23 (assinatura, autoria declarada ou
//   outra), que continua pendente;
// - custos: dependem de H-28 (proposta revista: não guardar custos em dispositivos de operadores).
// As migrações do esquema local são sempre aditivas (arquitectura, secção 11.2).

export interface DefinicaoLoja {
  nome: string
  chave: string
  indices?: { nome: string; caminho: string | string[]; unico?: boolean }[]
  /** Grupo da arquitectura: referência (substituível), operações (preciosas), credenciais, controlo. */
  grupo: 'referencia' | 'operacoes' | 'credenciais' | 'controlo'
}

export interface VersaoEsquema {
  versao: number
  /** Lojas criadas nesta versão. Uma versão nunca apaga nem recria lojas anteriores. */
  novasLojas: DefinicaoLoja[]
}

export const ESQUEMA_LOCAL: VersaoEsquema[] = [
  {
    versao: 1,
    novasLojas: [
      // Referência: chega de /v1/referencia e pode ser descarregada de novo.
      { grupo: 'referencia', nome: 'catalogo', chave: 'id' },
      { grupo: 'referencia', nome: 'precos', chave: 'produtoId' },
      { grupo: 'referencia', nome: 'stock', chave: 'produtoId' },
      { grupo: 'referencia', nome: 'metodos', chave: 'id' },
      { grupo: 'referencia', nome: 'regras', chave: 'chave' },
      { grupo: 'referencia', nome: 'permissoes', chave: 'versao' },
      { grupo: 'referencia', nome: 'membros_locais', chave: 'membroId' },
      { grupo: 'referencia', nome: 'cursor', chave: 'chave' },
      // Operações: nunca apagadas antes de resposta definitiva do servidor.
      { grupo: 'operacoes', nome: 'fila', chave: 'id', indices: [{ nome: 'por_sequencia', caminho: 'sequencia', unico: true }] },
      { grupo: 'operacoes', nome: 'vendas_locais', chave: 'id', indices: [{ nome: 'por_numero', caminho: 'numero', unico: true }] },
      { grupo: 'operacoes', nome: 'sessao_caixa', chave: 'id' },
      { grupo: 'operacoes', nome: 'sequencias', chave: 'nome' },
      // Credenciais: apagadas por utilizador, nunca junto com a fila.
      { grupo: 'credenciais', nome: 'credencial_registo', chave: 'registoId' },
      { grupo: 'credenciais', nome: 'tokens', chave: 'utilizadorId' },
      // Controlo
      { grupo: 'controlo', nome: 'pausa', chave: 'chave' },
      { grupo: 'controlo', nome: 'relogio', chave: 'chave' },
      { grupo: 'controlo', nome: 'app', chave: 'chave' },
    ],
  },
]

export const VERSAO_ACTUAL = ESQUEMA_LOCAL[ESQUEMA_LOCAL.length - 1].versao

/** Nome da base local de um registo de dispositivo (arquitectura, secção 5). */
export function nomeBaseLocal(empresaId: string, codigoRegisto: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(empresaId) || !/^C\d{2,}$/.test(codigoRegisto)) {
    throw new Error('empresa ou código de registo inválidos para a base local')
  }
  return `nexo-${empresaId.toLowerCase()}-${codigoRegisto}`
}
